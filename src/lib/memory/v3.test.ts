import { describe, it, expect, vi } from 'vitest';
import { buildExtractionPrompt, extractMaterial, hasCausalCue, hasCausalLink, parseExtraction, supportingWindow } from './extract';
import { runMemoryBuild, withoutTitleConcept } from './build';
import { mergeGraphs } from './merge';
import { readGraph } from './graphRead';
import { materialTitle, normalizeKey } from './text';
import { CONCEPT_KINDS, KIND_LABEL, MEMORY_LIMITS, type Concept, type Edge } from './types';

const group = (text: string) => ({ section: null, text, chunkIndexes: [0] });
const c = (name: string, over: Partial<Concept> = {}): Concept => ({ key: normalizeKey(name), name, kind: 'concepto', definition: `Def de ${name}.`, formula: '', unit: '', importance: 3, mentions: 1, sources: [{ materialId: 'm1', chunks: [0] }], ...over });
const e = (from: string, to: string, relation: Edge['relation'] = 'parte_de'): Edge => ({ from: normalizeKey(from), to: normalizeKey(to), relation, weight: 1 });

const HISTORY = 'Mesopotamia es la región entre los ríos Tigris y Éufrates. En Mesopotamia surgieron las ciudades-estado sumerias como Ur y Uruk. El Código de Hammurabi fue escrito por el rey Hammurabi en Babilonia.';

// Una base en memoria con la parte de la API de Supabase que usa la construccion.
type Row = Record<string, any>;
function fakeAdmin(db: Record<string, Row[]>) {
  return {
    from(table: string) {
      db[table] = db[table] ?? [];
      const filters: [string, any][] = [];
      let mode: 'select' | 'update' = 'select';
      let payload: Row = {};
      const matches = () => db[table].filter((r) => filters.every(([col, v]) => r[col] === v));
      const api: any = {
        select: () => api,
        order: () => api,
        limit: () => api,
        eq: (col: string, v: any) => (filters.push([col, v]), api),
        update: (p: Row) => ((mode = 'update'), (payload = p), api),
        maybeSingle: async () => ({ data: matches()[0] ?? null }),
        insert: async (p: Row) => (db[table].push({ version: 0, ...p }), { error: null }),
        upsert: async (p: Row) => {
          const i = db[table].findIndex((r) => r.material_id === p.material_id);
          if (i >= 0) db[table][i] = { ...db[table][i], ...p };
          else db[table].push(p);
          return { error: null };
        },
        then: (resolve: (v: any) => void) => {
          const rows = matches();
          if (mode === 'update') rows.forEach((r) => Object.assign(r, payload));
          resolve({ data: rows.map((r) => ({ ...r })), error: null });
        },
      };
      return api;
    },
  };
}

// ─────────────────────────── topes holgados ───────────────────────────
describe('v3: topes holgados', () => {
  it('los topes anteriores (120 por material, 400 por clase) recortaban una clase real: ahora son 250 / 800 / 2400', () => {
    expect(MEMORY_LIMITS.conceptsPerMaterial).toBe(250);
    expect(MEMORY_LIMITS.conceptsPerClass).toBe(800);
    expect(MEMORY_LIMITS.edgesPerClass).toBe(2400);
  });

  it('una clase de 600 conceptos se conserva completa (antes se descartaban 200)', () => {
    const many = Array.from({ length: 600 }, (_, i) => c(`tema ${'abcdefghij'[i % 10]}${i} xq${i}`, { importance: 3 }));
    const { graph, stats } = mergeGraphs([{ materialId: 'm1', graph: { concepts: many, edges: [] } }]);
    expect(graph.concepts).toHaveLength(600);
    expect(stats.dropped).toBe(0);
  });

  it('un material con muchos conceptos ya no se corta a 120', async () => {
    // 8 bloques de ~30 conceptos distintos cada uno = 240 conceptos
    const chunks: { chunk_index: number; content: string }[] = [];
    const answers: string[] = [];
    for (let g = 0; g < 8; g++) {
      const names = Array.from({ length: 30 }, (_, i) => `Tema g${g}n${i}`);
      chunks.push({ chunk_index: g, content: names.join('. ') + '. ' + 'x'.repeat(5600) });
      answers.push(JSON.stringify({ conceptos: names.map((n) => ({ nombre: n, tipo: 'concepto', definicion: 'd', importancia: 3 })) }));
    }
    const call = vi.fn().mockImplementation(async (prompt: string) => {
      const m = prompt.match(/Tema g(\d)n0/);
      return answers[m ? Number(m[1]) : 0];
    });
    const r = await extractMaterial(chunks, 'm1', 'Doc', call, { profile: 'narrativo' });
    expect(r.extraction.concepts.length).toBeGreaterThan(120);
    expect(r.extraction.concepts.length).toBeLessThanOrEqual(MEMORY_LIMITS.conceptsPerMaterial);
  });
});

// ─────────────────────────── importancia por percentiles ───────────────────────────
describe('v3: importancia por percentiles', () => {
  const build = (n: number) => {
    const cs = Array.from({ length: n }, (_, i) => c(`concepto ${String.fromCharCode(97 + (i % 26))}${i} zq${i}`, { importance: (i % 5) + 1 }));
    const es: Edge[] = [];
    for (let i = 1; i < n; i++) es.push({ from: cs[i].key, to: cs[i % 10].key, relation: 'parte_de', weight: 1 });
    return mergeGraphs([{ materialId: 'm1', graph: { concepts: cs, edges: es } }]).graph.concepts;
  };
  const dist = (cs: Concept[]) => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    cs.forEach((x) => counts[x.importance]++);
    return counts;
  };

  it('reparte 5 % / 15 % / 35 % / 30 % / 15 % (importancia 5, 4, 3, 2, 1) en una memoria de 100 conceptos', () => {
    expect(dist(build(100))).toEqual({ 5: 5, 4: 15, 3: 35, 2: 30, 1: 15 });
  });

  it('es relativo a la clase: 400 conceptos tambien dan 5 % de cincos y 15 % de cuatros', () => {
    const d = dist(build(400));
    expect(d[5]).toBe(20);
    expect(d[4]).toBe(60);
  });

  it('el orden se respeta: los conceptos mas centrales (con mas relaciones) quedan arriba', () => {
    const cs = build(100);
    const hubKeys = Array.from({ length: 10 }, (_, i) => cs.find((x) => x.name.includes(`zq${i}`))!);
    const avgHub = hubKeys.reduce((s, x) => s + x.importance, 0) / hubKeys.length;
    const rest = cs.filter((x) => !hubKeys.includes(x));
    const avgRest = rest.reduce((s, x) => s + x.importance, 0) / rest.length;
    expect(avgHub).toBeGreaterThan(avgRest);
  });

  it('con pocos conceptos (< 20) no se fuerza el reparto; con blend:false no se toca nada', () => {
    expect(Math.max(...build(10).map((x) => x.importance))).toBeLessThanOrEqual(5);
    expect(dist(build(10))[5]).toBeLessThan(10);
    const raw = mergeGraphs([{ materialId: 'm1', graph: { concepts: Array.from({ length: 50 }, (_, i) => c(`dato ${i} qz${i}`, { importance: 3 })), edges: [] } }], { blend: false }).graph;
    expect(raw.concepts.every((x) => x.importance === 3)).toBe(true);
  });

  it('es determinista y siempre entre 1 y 5', () => {
    const a = build(60);
    expect(JSON.stringify(a)).toBe(JSON.stringify(build(60)));
    expect(a.every((x) => x.importance >= 1 && x.importance <= 5)).toBe(true);
  });
});

// ─────────────────────────── titulo del documento ───────────────────────────
describe('v3: titulo del documento', () => {
  it('materialTitle quita extension, numeracion y sufijo de sitio', () => {
    expect(materialTitle('Doc1_Mesopotamia_y_Egipto.docx')).toBe('Mesopotamia y Egipto');
    expect(materialTitle('Antiguo Egipto - Wikipedia, la enciclopedia libre')).toBe('Antiguo Egipto');
    expect(materialTitle('Unidad 2 - Oferta y demanda.pdf')).toBe('Oferta y demanda');
    expect(materialTitle('tema_3_Fotosíntesis.docx')).toBe('Fotosíntesis');
    expect(materialTitle('Notas.txt')).toBe('Notas');
  });

  it('se quita el concepto que es solo el titulo (y sus relaciones); el articulo cuyo titulo ES el tema, muy mencionado, se conserva', () => {
    const g = { concepts: [c('Mesopotamia y Egipto', { mentions: 1 }), c('Mesopotamia'), c('Egipto')], edges: [e('Mesopotamia', 'Mesopotamia y Egipto'), e('Egipto', 'Mesopotamia y Egipto'), e('Egipto', 'Mesopotamia', 'relacionado')] };
    const out = withoutTitleConcept(g, 'Doc1_Mesopotamia_y_Egipto.docx');
    expect(out.concepts.map((x) => x.name)).toEqual(['Mesopotamia', 'Egipto']);
    expect(out.edges).toHaveLength(1);
    const wiki = { concepts: [c('Antiguo Egipto', { mentions: 9 }), c('Faraón')], edges: [e('Faraón', 'Antiguo Egipto')] };
    expect(withoutTitleConcept(wiki, 'Antiguo Egipto - Wikipedia, la enciclopedia libre')).toBe(wiki);
    expect(withoutTitleConcept(wiki, '')).toBe(wiki);
  });

  it('en la construccion de la clase el titulo no llega al grafo', async () => {
    const db: Record<string, Row[]> = {
      class_memory: [{ classroom_id: 'c1', status: 'building', started_at: '2026-10-29T10:00:00Z', version: 0 }],
      class_memory_material: [],
      teaching_materials: [{ id: 'm1', classroom_id: 'c1', processing_status: 'completed', display_name: 'Doc1_Mesopotamia_y_Egipto.docx' }],
      material_chunks: [{ material_id: 'm1', chunk_index: 0, content: HISTORY + ' Egipto es otra civilización. ' + 'x'.repeat(300) }],
    };
    const resp = JSON.stringify({
      conceptos: [{ nombre: 'Mesopotamia y Egipto', tipo: 'concepto', definicion: 'Título', importancia: 5 }, { nombre: 'Mesopotamia', tipo: 'lugar', definicion: 'Región.', importancia: 4 }],
      relaciones: [{ de: 'Mesopotamia', a: 'Mesopotamia y Egipto', tipo: 'parte_de' }],
    });
    await runMemoryBuild(fakeAdmin(db), 'c1', vi.fn().mockResolvedValue(resp));
    const names = (db.class_memory[0].graph.concepts as Concept[]).map((x) => x.name);
    expect(names).toContain('Mesopotamia');
    expect(names).not.toContain('Mesopotamia y Egipto');
  });
});

// ─────────────────────────── "causa" solo con expresion causal ───────────────────────────
describe('v3: "causa" solo con una expresion causal', () => {
  it('hasCausalCue reconoce expresiones causales (con o sin tildes) y no una mera mencion', () => {
    for (const t of ['Por eso la agricultura prosperó.', 'El limo se debía a la crecida.', 'Provocó una guerra.', 'La sequía llevó a la migración.', 'Debido a las lluvias.', 'Gracias a los canales hubo cosechas.']) expect(hasCausalCue(t), t).toBe(true);
    for (const t of ['El natrón se usaba en la momificación.', 'Champollion descifró los jeroglíficos.', 'Hammurabi reinó en Babilonia.']) expect(hasCausalCue(t), t).toBe(false);
  });

  const TEXTO = 'Cada año el Nilo se desbordaba y dejaba un limo fértil, por eso la agricultura prosperó en Egipto. Para la momificación se usaba natrón y lino.';
  const resp = (de: string, a: string) =>
    JSON.stringify({ conceptos: [{ nombre: 'Nilo', tipo: 'lugar' }, { nombre: 'Agricultura', tipo: 'concepto' }, { nombre: 'Natrón', tipo: 'concepto' }, { nombre: 'Momificación', tipo: 'concepto' }], relaciones: [{ de, a, tipo: 'causa' }] });
  const rel = (r: ReturnType<typeof parseExtraction>) => r!.extraction.edges[0]?.relation;

  it('con una señal causal en la frase se conserva como causa', () => {
    expect(rel(parseExtraction(resp('Nilo', 'Agricultura'), group(TEXTO), 'm1', 'narrativo'))).toBe('causa');
  });

  it('sin señal causal ("el natrón se usaba en la momificación") pasa a conexion neutra', () => {
    expect(rel(parseExtraction(resp('Natrón', 'Momificación'), group(TEXTO), 'm1', 'narrativo'))).toBe('relacionado');
  });

  it('la señal causal de una frase VECINA no cuenta: debe estar en una frase que mencione alguno de los conceptos', () => {
    expect(hasCausalLink(TEXTO, 'Nilo', 'Agricultura')).toBe(true);
    expect(hasCausalLink(TEXTO, 'Natrón', 'Momificación')).toBe(false);
    expect(hasCausalLink('', 'A', 'B')).toBe(false);
  });

  it('supportingWindow devuelve la frase donde estan los dos conceptos (o null)', () => {
    expect(supportingWindow(TEXTO, 'Natrón', 'Momificación')).toContain('natrón y lino');
    expect(supportingWindow(TEXTO, 'Natrón', 'Fantasma')).toBeNull();
  });

  it('el prompt narrativo pide la expresion causal', () => {
    expect(buildExtractionPrompt(group(HISTORY), 'Doc', 'narrativo')).toContain('expresión causal');
  });
});

// ─────────────────────────── tipo "grupo" ───────────────────────────
describe('v3: tipo "grupo"', () => {
  it('existe, tiene etiqueta y se conserva (pueblos y civilizaciones ya no son "persona")', () => {
    expect(CONCEPT_KINDS as readonly string[]).toContain('grupo');
    expect(KIND_LABEL.grupo).toBe('Pueblo o grupo');
    const a = JSON.stringify({ conceptos: [{ nombre: 'Mesopotamia', tipo: 'lugar' }, { nombre: 'Sumerios', tipo: 'grupo', definicion: 'Pueblo.' }, { nombre: 'Ur', tipo: 'lugar' }] });
    const r = parseExtraction(a, group('Los Sumerios habitaron Mesopotamia y fundaron Ur.'), 'm1', 'narrativo')!;
    expect(r.extraction.concepts.find((x) => x.name === 'Sumerios')?.kind).toBe('grupo');
  });

  it('el prompt narrativo distingue persona (un individuo), grupo y obra (una concreta; un sistema de escritura es un concepto)', () => {
    const p = buildExtractionPrompt(group(HISTORY), 'Doc', 'narrativo');
    expect(p).toContain('persona (un individuo)');
    expect(p).toContain('grupo (pueblos, civilizaciones, dinastías, instituciones');
    expect(p).toContain('un sistema de escritura es un concepto');
  });

  it('readGraph lo acepta y la fusion lo prefiere sobre "concepto"', () => {
    expect(readGraph({ concepts: [{ key: 'a', name: 'A', kind: 'grupo' }], edges: [] }).concepts[0].kind).toBe('grupo');
    const m = mergeGraphs([{ materialId: 'm1', graph: { concepts: [c('Aztecas', { kind: 'concepto' })], edges: [] } }, { materialId: 'm2', graph: { concepts: [c('Aztecas', { kind: 'grupo' })], edges: [] } }]);
    expect(m.graph.concepts[0].kind).toBe('grupo');
  });
});
