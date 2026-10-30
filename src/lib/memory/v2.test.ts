import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildExtractionPrompt, detectProfile, extractMaterial, parseExtraction, supportedBy } from './extract';
import { runMemoryBuild } from './build';
import { mergeGraphs } from './merge';
import { MAX_AUTO_RUNS, NO_MEMORY, buildTree, countParts, headline, progress, shouldContinue, type MemorySummary } from './panelState';
import { readGraph } from './graphRead';
import { normalizeKey } from './text';
import { CONCEPT_KINDS, KIND_LABEL, MEMORY_LIMITS, RELATIONS, type Concept, type Edge } from './types';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

const HISTORY =
  'Mesopotamia es la región entre los ríos Tigris y Éufrates, donde surgieron las primeras civilizaciones. En Mesopotamia surgieron las ciudades-estado sumerias como Ur y Uruk. El Código de Hammurabi fue escrito por el rey Hammurabi en Babilonia y es una de las primeras colecciones de leyes. Mucho más al oeste, el río Nilo inundaba cada año sus orillas y permitía la agricultura en Egipto.';
const MATH = 'La utilidad marginal es la satisfacción adicional. La restricción es p_x * x + p_y * y = M. La función de utilidad es U(x,y) = x^a * y^(1-a), donde a es la preferencia. La tasa marginal de sustitución es TMS = UMg_x / UMg_y.';

const group = (text: string) => ({ section: null, text, chunkIndexes: [0] });
const c = (name: string, over: Partial<Concept> = {}): Concept => ({ key: normalizeKey(name), name, kind: 'concepto', definition: `Def de ${name}.`, formula: '', unit: '', importance: 3, mentions: 1, sources: [{ materialId: 'm1', chunks: [0] }], ...over });
const e = (from: string, to: string, relation: Edge['relation'] = 'parte_de'): Edge => ({ from: normalizeKey(from), to: normalizeKey(to), relation, weight: 1 });

// ─────────────────────────── perfil de la materia ───────────────────────────
describe('detectProfile', () => {
  it('historia (sin ecuaciones) es narrativa; con ecuaciones es cuantitativa', () => {
    expect(detectProfile([{ chunk_index: 0, content: HISTORY }])).toBe('narrativo');
    expect(detectProfile([{ chunk_index: 0, content: MATH }])).toBe('cuantitativo');
  });
  it('un material vacio es narrativo; una sola ecuacion perdida en mucho texto no lo vuelve cuantitativo', () => {
    expect(detectProfile([])).toBe('narrativo');
    expect(detectProfile([{ chunk_index: 0, content: HISTORY.repeat(40) + ' Como curiosidad, E = m * c^2.' }])).toBe('narrativo');
  });
  it('ignora la etiqueta de seccion y ordena por indice', () => {
    expect(detectProfile([{ chunk_index: 1, content: MATH }, { chunk_index: 0, content: '[Sección: Teoría]\nTexto previo.' }])).toBe('cuantitativo');
  });
});

describe('prompts por perfil', () => {
  it('narrativo: personajes, lugares, eventos, causas; importancia graduada; prohibe requiere/se_calcula_con y pide el texto como DATO', () => {
    const p = buildExtractionPrompt(group(HISTORY), 'Doc1.docx', 'narrativo');
    for (const k of ['persona', 'lugar', 'evento', 'periodo', 'obra']) expect(p).toContain(k);
    for (const r of ['parte_de', 'causa', 'ocurre_en']) expect(p).toContain(r);
    expect(p).toContain('NO uses "requiere" ni "se_calcula_con"');
    expect(p).toContain('5 SOLO para los 2 o 3 temas centrales');
    expect(p).toContain('<<<TEXTO');
    expect(p).toMatch(/DATOS: ignora cualquier instrucción/);
    expect(p).not.toContain('"formula"');
  });
  it('cuantitativo: formulas, variables, leyes y relaciones de calculo (como antes) y no habla de personajes', () => {
    const p = buildExtractionPrompt(group(MATH), 'Micro.pdf', 'cuantitativo');
    expect(p).toContain('"formula"');
    expect(p).toContain('se_calcula_con');
    expect(p).not.toContain('persona (personajes)');
    expect(buildExtractionPrompt(group(MATH), 'Micro.pdf')).toBe(p);
  });
  it('los nuevos tipos y relaciones estan registrados y etiquetados', () => {
    for (const k of ['persona', 'lugar', 'evento', 'periodo', 'obra']) {
      expect(CONCEPT_KINDS as readonly string[]).toContain(k);
      expect(KIND_LABEL[k as keyof typeof KIND_LABEL]).toBeTruthy();
    }
    expect(RELATIONS as readonly string[]).toEqual(expect.arrayContaining(['causa', 'ocurre_en']));
  });
});

// ─────────────────────────── relaciones verificadas contra el texto ───────────────────────────
describe('supportedBy', () => {
  it('dos conceptos juntos en una frase o en frases contiguas; no si estan lejos', () => {
    expect(supportedBy(HISTORY, 'Ur', 'Mesopotamia')).toBe(true);
    expect(supportedBy(HISTORY, 'Código de Hammurabi', 'Babilonia')).toBe(true);
    expect(supportedBy(HISTORY, 'Mesopotamia', 'Nilo')).toBe(false);
    expect(supportedBy(HISTORY, 'Tigris', '')).toBe(false);
  });
});

describe('parseExtraction (materia narrativa)', () => {
  const answer = JSON.stringify({
    conceptos: [
      { nombre: 'Mesopotamia', tipo: 'lugar', definicion: 'Región entre el Tigris y el Éufrates.', importancia: 5 },
      { nombre: 'Ur', tipo: 'variable', definicion: 'Ciudad-estado sumeria.', importancia: 2, formula: 'x = 1', unidad: 'km' },
      { nombre: 'Código de Hammurabi', tipo: 'obra', definicion: 'Colección de leyes.', importancia: 4 },
      { nombre: 'Hammurabi', tipo: 'persona', definicion: 'Rey de Babilonia.', importancia: 3 },
      { nombre: 'Río Nilo', tipo: 'lugar', definicion: 'Río de Egipto.', importancia: 3 },
    ],
    relaciones: [
      { de: 'Ur', a: 'Mesopotamia', tipo: 'ocurre_en' },
      { de: 'Hammurabi', a: 'Código de Hammurabi', tipo: 'requiere' },
      { de: 'Código de Hammurabi', a: 'Mesopotamia', tipo: 'se_calcula_con' },
      { de: 'Mesopotamia', a: 'Río Nilo', tipo: 'causa' },
      { de: 'Ur', a: 'Fantasma', tipo: 'parte_de' },
    ],
  });

  it('conserva los tipos narrativos, convierte "variable" en concepto y no guarda formula ni unidad', () => {
    const r = parseExtraction(answer, group(HISTORY), 'm1', 'narrativo')!;
    const by = (n: string) => r.extraction.concepts.find((x) => x.name === n)!;
    expect(by('Mesopotamia').kind).toBe('lugar');
    expect(by('Código de Hammurabi').kind).toBe('obra');
    expect(by('Hammurabi').kind).toBe('persona');
    expect(by('Ur').kind).toBe('concepto');
    expect(by('Ur').formula).toBe('');
    expect(by('Ur').unit).toBe('');
  });

  it('"requiere" y "se_calcula_con" se vuelven una conexion neutra; las relaciones validas se conservan', () => {
    const r = parseExtraction(answer, group(HISTORY), 'm1', 'narrativo')!;
    const rel = (a: string, b: string) => r.extraction.edges.find((x) => x.from === normalizeKey(a) && x.to === normalizeKey(b))?.relation;
    expect(rel('Ur', 'Mesopotamia')).toBe('ocurre_en');
    expect(rel('Hammurabi', 'Código de Hammurabi')).toBe('relacionado');
    expect(rel('Código de Hammurabi', 'Mesopotamia')).toBe('relacionado');
    expect(r.extraction.edges.some((x) => x.relation === 'requiere' || x.relation === 'se_calcula_con')).toBe(false);
  });

  it('una relacion que el texto NO sostiene se descarta y se cuenta (Mesopotamia y el Nilo estan lejos); a un concepto inexistente se ignora', () => {
    const r = parseExtraction(answer, group(HISTORY), 'm1', 'narrativo')!;
    expect(r.extraction.edges.some((x) => x.to === normalizeKey('Río Nilo'))).toBe(false);
    expect(r.relationsRejected).toBe(1);
    expect(r.extraction.edges.some((x) => x.to === normalizeKey('Fantasma'))).toBe(false);
  });

  it('cuantitativo: "se_calcula_con" sin formula en ninguno de los dos pasa a conexion neutra; con formula se conserva', () => {
    const a = JSON.stringify({
      conceptos: [{ nombre: 'Utilidad marginal', definicion: 'Satisfacción adicional.' }, { nombre: 'Restricción', formula: 'p_x * x + p_y * y = M' }, { nombre: 'Función de utilidad', formula: 'U(x,y) = x^a * y^(1-a)' }],
      relaciones: [{ de: 'Utilidad marginal', a: 'Función de utilidad', tipo: 'se_calcula_con' }, { de: 'Función de utilidad', a: 'Restricción', tipo: 'se_calcula_con' }],
    });
    const r = parseExtraction(a, group(MATH), 'm1', 'cuantitativo')!;
    const rel = (x: string, y: string) => r.extraction.edges.find((e2) => e2.from === normalizeKey(x) && e2.to === normalizeKey(y))?.relation;
    expect(rel('Función de utilidad', 'Restricción')).toBe('se_calcula_con');
    expect(rel('Utilidad marginal', 'Función de utilidad')).toBe('se_calcula_con'); // el destino tiene formula
  });

  it('no duplica relaciones iguales', () => {
    const dup = JSON.stringify({ conceptos: [{ nombre: 'Mesopotamia', tipo: 'lugar' }, { nombre: 'Ur', tipo: 'lugar' }], relaciones: [{ de: 'Ur', a: 'Mesopotamia', tipo: 'ocurre_en' }, { de: 'Ur', a: 'Mesopotamia', tipo: 'ocurre_en' }] });
    expect(parseExtraction(dup, group(HISTORY), 'm1', 'narrativo')!.extraction.edges).toHaveLength(1);
  });
});

// ─────────────────────────── lectura en paralelo y continuada ───────────────────────────
const CHUNKS = (n: number) => Array.from({ length: n }, (_, i) => ({ chunk_index: i, content: HISTORY + ` Bloque ${i}. ` + 'x'.repeat(5600 - HISTORY.length) }));
const ANSWER = JSON.stringify({ conceptos: [{ nombre: 'Mesopotamia', tipo: 'lugar', definicion: 'Región.', importancia: 5 }, { nombre: 'Ur', tipo: 'lugar', definicion: 'Ciudad.', importancia: 2 }], relaciones: [{ de: 'Ur', a: 'Mesopotamia', tipo: 'ocurre_en' }] });

describe('extractMaterial v2', () => {
  it('lee los bloques EN PARALELO, con tope', async () => {
    let live = 0;
    let peak = 0;
    const call = vi.fn().mockImplementation(async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 15));
      live--;
      return ANSWER;
    });
    const r = await extractMaterial(CHUNKS(8), 'm1', 'Doc', call);
    expect(r.groups).toBe(8);
    expect(r.doneGroups).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(MEMORY_LIMITS.concurrency);
    expect(call).toHaveBeenCalledTimes(8);
    expect(r.profile).toBe('narrativo');
  });

  it('respuesta vacia: un reintento inmediato; si sigue vacia el bloque cuenta como fallido', async () => {
    const call = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(ANSWER);
    const ok = await extractMaterial(CHUNKS(1), 'm1', 'Doc', call);
    expect(ok.doneGroups).toEqual([0]);
    expect(call).toHaveBeenCalledTimes(2);
    const bad = await extractMaterial(CHUNKS(1), 'm1', 'Doc', vi.fn().mockResolvedValue(null));
    expect(bad.failedGroups).toBe(1);
    expect(bad.doneGroups).toEqual([]);
  });

  it('presupuesto de tiempo: lo que no se alcanza queda como "omitido" (no fallido) y no se llama a la IA', async () => {
    let t = 0;
    const call = vi.fn().mockImplementation(async () => {
      t += 1000;
      return ANSWER;
    });
    const r = await extractMaterial(CHUNKS(6), 'm1', 'Doc', call, { deadline: 500, now: () => t });
    expect(r.doneGroups.length).toBeLessThan(6);
    expect(r.skippedGroups).toBe(6 - r.doneGroups.length);
    expect(r.failedGroups).toBe(0);
    expect(call).toHaveBeenCalledTimes(r.doneGroups.length);
  });

  it('CONTINUAR: con lo ya leido solo se leen los bloques que faltan y se funde con lo anterior', async () => {
    let t = 0;
    const first = await extractMaterial(CHUNKS(6), 'm1', 'Doc', vi.fn().mockImplementation(async () => ((t += 1000), ANSWER)), { deadline: 500, now: () => t });
    expect(first.doneGroups.length).toBeLessThan(6);
    const call = vi.fn().mockResolvedValue(ANSWER);
    const second = await extractMaterial(CHUNKS(6), 'm1', 'Doc', call, { resume: { extraction: first.extraction, doneGroups: first.doneGroups } });
    expect(call).toHaveBeenCalledTimes(6 - first.doneGroups.length);
    expect(second.doneGroups).toEqual([0, 1, 2, 3, 4, 5]);
    // los conceptos repetidos entre pasadas se funden y suman menciones
    expect(second.extraction.concepts.find((x) => x.key === normalizeKey('Mesopotamia'))?.mentions).toBe(6);
  });

  it('indices de resume invalidos (de otra version del material) se ignoran', async () => {
    const call = vi.fn().mockResolvedValue(ANSWER);
    const r = await extractMaterial(CHUNKS(2), 'm1', 'Doc', call, { resume: { extraction: { concepts: [], edges: [] }, doneGroups: [99, -1, 1.5] } });
    expect(call).toHaveBeenCalledTimes(2);
    expect(r.doneGroups).toEqual([0, 1]);
  });
});

// ─────────────────────────── la construccion de la clase continua donde se quedo ───────────────────────────
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
const world = (materials: number, chunksEach: number) => {
  const db: Record<string, Row[]> = { class_memory: [{ classroom_id: 'c1', status: 'building', started_at: '2026-10-29T10:00:00Z', version: 0 }], class_memory_material: [], teaching_materials: [], material_chunks: [] };
  for (let m = 1; m <= materials; m++) {
    db.teaching_materials.push({ id: `m${m}`, classroom_id: 'c1', processing_status: 'completed', display_name: `Doc ${m}` });
    CHUNKS(chunksEach).forEach((ch) => db.material_chunks.push({ material_id: `m${m}`, chunk_index: ch.chunk_index, content: ch.content.replace('Bloque', `Mat${m} Bloque`) }));
  }
  return db;
};

describe('runMemoryBuild v2: continuar y avisar con honestidad', () => {
  it('si se acaba el tiempo, los materiales sin alcanzar quedan PENDIENTES (no "la IA no pudo") y la siguiente pasada completa lo que falta', async () => {
    const db = world(3, 1);
    let t = 0;
    const slow = vi.fn().mockImplementation(async () => ((t += 10 * 60 * 1000), ANSWER));
    await runMemoryBuild(fakeAdmin(db), 'c1', slow, { now: () => t });
    const first = db.class_memory[0];
    expect(first.status).toBe('ready');
    expect(first.stats).toMatchObject({ materials: 3, materialsRead: 1, materialsPending: 2, materialsFailed: 0, incomplete: true, groupsDone: 1, groupsTotal: 3 });
    expect(first.error).toMatch(/Leídos 1 de 3 materiales \(1 de 3 bloques\)\. Falta leer el resto/);
    expect(first.error).not.toMatch(/no pudo/i);
    expect(slow).toHaveBeenCalledTimes(1);
    expect(db.class_memory_material).toHaveLength(1);

    db.class_memory[0].status = 'building';
    const fast = vi.fn().mockResolvedValue(ANSWER);
    await runMemoryBuild(fakeAdmin(db), 'c1', fast);
    const second = db.class_memory[0];
    expect(fast).toHaveBeenCalledTimes(2); // el primero NO se vuelve a leer
    expect(second.stats).toMatchObject({ materialsRead: 3, materialsPending: 0, incomplete: false, reused: 1, groupsDone: 3, groupsTotal: 3 });
    expect(second.error).toBeNull();
    expect(second.version).toBe(2);
  });

  it('un material a medias guarda que bloques ya leyo y la siguiente pasada solo lee los que faltan', async () => {
    const db = world(1, 6);
    let t = 0;
    const slow = vi.fn().mockImplementation(async () => ((t += 10 * 60 * 1000), ANSWER));
    await runMemoryBuild(fakeAdmin(db), 'c1', slow, { now: () => t });
    const row = db.class_memory_material[0];
    expect(row.status).toBe('extracting');
    expect(row.stats.doneGroups.length).toBeGreaterThan(0);
    expect(row.stats.doneGroups.length).toBeLessThan(6);
    expect(db.class_memory[0].stats.materialsPartial).toBe(1);
    const doneFirst = row.stats.doneGroups.length;

    db.class_memory[0].status = 'building';
    const fast = vi.fn().mockResolvedValue(ANSWER);
    await runMemoryBuild(fakeAdmin(db), 'c1', fast);
    expect(fast).toHaveBeenCalledTimes(6 - doneFirst);
    expect(db.class_memory_material[0].status).toBe('ready');
    expect(db.class_memory[0].stats.incomplete).toBe(false);
  });

  it('si la IA no responde en nada: sin progreso (la cadena se corta), con motivo, y sin perder lo que ya habia', async () => {
    const db = world(1, 2);
    await runMemoryBuild(fakeAdmin(db), 'c1', vi.fn().mockResolvedValue(ANSWER));
    expect(db.class_memory[0].stats.incomplete).toBe(false);
    db.class_memory[0].status = 'building';
    db.material_chunks.forEach((r) => (r.content += ' cambio'));
    await runMemoryBuild(fakeAdmin(db), 'c1', vi.fn().mockResolvedValue(null));
    const m = db.class_memory[0];
    expect(m.stats).toMatchObject({ materialsFailed: 1, incomplete: true, groupsDone: 0 });
    expect(m.error).toMatch(/La IA no respondió/);
    expect(m.graph.concepts.length).toBeGreaterThan(0);
  });

  it('la importancia final mezcla lo que dijo la IA con lo central que es en el grafo', async () => {
    const db = world(1, 1);
    await runMemoryBuild(fakeAdmin(db), 'c1', vi.fn().mockResolvedValue(ANSWER));
    const g = db.class_memory[0].graph.concepts as Concept[];
    const meso = g.find((x) => x.key === normalizeKey('Mesopotamia'))!;
    const ur = g.find((x) => x.key === normalizeKey('Ur'))!;
    expect(meso.importance).toBeGreaterThan(ur.importance);
  });
});

// ─────────────────────────── importancia por centralidad ───────────────────────────
describe('mergeGraphs: importancia por centralidad', () => {
  const g = { concepts: [c('Egipto', { importance: 3 }), c('Faraón', { importance: 3 }), c('Pirámides', { importance: 3 }), c('Momificación', { importance: 3 }), c('Lino', { importance: 3 })], edges: [e('Faraón', 'Egipto'), e('Pirámides', 'Egipto'), e('Momificación', 'Egipto'), e('Lino', 'Momificación')] };
  it('el tema del que cuelgan otros sube y el dato suelto baja', () => {
    const { graph } = mergeGraphs([{ materialId: 'm1', graph: { ...g, concepts: [...g.concepts, c('Dato suelto', { importance: 3 })] } }]);
    const imp = (n: string) => graph.concepts.find((x) => x.key === normalizeKey(n))!.importance;
    expect(imp('Egipto')).toBeGreaterThan(imp('Lino'));
    expect(imp('Lino')).toBeGreaterThanOrEqual(imp('Dato suelto'));
    expect(imp('Dato suelto')).toBeLessThan(3);
    expect(imp('Egipto')).toBe(4);
  });
  it('con blend:false no se toca, y siempre queda entre 1 y 5', () => {
    const { graph } = mergeGraphs([{ materialId: 'm1', graph: g }], { blend: false });
    expect(graph.concepts.every((x) => x.importance === 3)).toBe(true);
    const wild = mergeGraphs([{ materialId: 'm1', graph: { concepts: [c('A uno', { importance: 5 }), c('B dos', { importance: 1 })], edges: [] } }]).graph;
    expect(wild.concepts.every((x) => x.importance >= 1 && x.importance <= 5)).toBe(true);
  });
  it('es determinista', () => {
    const a = mergeGraphs([{ materialId: 'm1', graph: g }]).graph;
    const b = mergeGraphs([{ materialId: 'm1', graph: g }]).graph;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ─────────────────────────── jerarquia (temas y partes) ───────────────────────────
describe('buildTree', () => {
  const concepts = [c('Egipto', { importance: 5 }), c('Alto Egipto', { importance: 3 }), c('Bajo Egipto', { importance: 3 }), c('Menfis', { importance: 3 }), c('Faraón', { importance: 4 }), c('Lino', { importance: 1 }), c('Natrón', { importance: 2 }), c('Mesopotamia', { importance: 5 })];
  const edges = [e('Alto Egipto', 'Egipto'), e('Bajo Egipto', 'Egipto'), e('Menfis', 'Bajo Egipto', 'ocurre_en'), e('Faraón', 'Egipto'), e('Lino', 'Natrón', 'relacionado')];

  it('lo que es parte de (u ocurre en) otro cuelga de el; los temas con mas partes van primero', () => {
    const t = buildTree(concepts, edges);
    expect(t.roots[0].concept.name).toBe('Egipto');
    expect(t.roots[0].children.map((x) => x.concept.name)).toEqual(['Faraón', 'Alto Egipto', 'Bajo Egipto']);
  });

  it('varios niveles: nada desaparece (Egipto > Bajo Egipto > Menfis)', () => {
    const t = buildTree(concepts, edges);
    const bajo = t.roots[0].children.find((x) => x.concept.name === 'Bajo Egipto')!;
    expect(bajo.children.map((x) => x.concept.name)).toEqual(['Menfis']);
    expect(countParts(t.roots[0])).toBe(4);
    // todo concepto aparece exactamente una vez, en el arbol o en los detalles menores
    const names: string[] = [];
    const walk = (n: { concept: Concept; children: any[] }) => (names.push(n.concept.name), n.children.forEach(walk));
    t.roots.forEach(walk);
    t.minor.forEach((m) => names.push(m.name));
    expect(names.sort()).toEqual(concepts.map((x) => x.name).sort());
  });

  it('un dato suelto (poca importancia y sin relaciones) va a "detalles menores"; un tema central sin relaciones se queda', () => {
    const t = buildTree(concepts, edges);
    expect(t.minor.map((x) => x.name)).toEqual([]);
    const t2 = buildTree([...concepts, c('Cerebro', { importance: 2 })], edges);
    expect(t2.minor.map((x) => x.name)).toEqual(['Cerebro']);
    expect(t2.roots.map((r) => r.concept.name)).toContain('Mesopotamia');
  });

  it('si algo es parte de varios, elige al mas importante; un ciclo de contenciones no cuelga el arbol', () => {
    const t = buildTree([c('Pirámides', { importance: 3 }), c('Egipto', { importance: 5 }), c('Arquitectura', { importance: 2 })], [e('Pirámides', 'Arquitectura'), e('Pirámides', 'Egipto')]);
    expect(t.roots.find((r) => r.concept.name === 'Egipto')!.children.map((x) => x.concept.name)).toEqual(['Pirámides']);
    const cyc = buildTree([c('A uno'), c('B dos')], [e('A uno', 'B dos'), e('B dos', 'A uno')]);
    expect(cyc.roots.length + cyc.minor.length).toBeGreaterThan(0);
  });

  it('ignora relaciones a conceptos que no existen y no se rompe con una memoria vacia', () => {
    expect(buildTree([c('Solo')], [e('Solo', 'Fantasma')]).roots).toHaveLength(1);
    expect(buildTree([], [])).toEqual({ roots: [], minor: [] });
  });
});

// ─────────────────────────── estado del panel ───────────────────────────
describe('panelState v2', () => {
  const t0 = new Date('2026-10-29T10:00:00Z').getTime();
  const ready = (stats: MemorySummary['stats'], over: Partial<MemorySummary> = {}): MemorySummary => ({ status: 'ready', version: 1, builtAt: null, startedAt: '2026-10-29T10:00:00Z', error: null, stats, ...over });

  it('progress: materiales y bloques leidos, con porcentaje; sin datos da null', () => {
    expect(progress(NO_MEMORY)).toBeNull();
    expect(progress(ready({ materials: 4, materialsRead: 1, groupsDone: 5, groupsTotal: 20 }))).toEqual({ read: 1, total: 4, groupsDone: 5, groupsTotal: 20, percent: 25 });
    expect(progress(ready({ materials: 1, groupsDone: 9, groupsTotal: 3 }))?.percent).toBe(100);
  });

  it('el mensaje de "construyendo" dice cuantos bloques lleva', () => {
    expect(headline(ready({ materials: 2, groupsDone: 3, groupsTotal: 9 }, { status: 'building' }), t0 + 1000).text).toMatch(/3 de 9 bloques/);
  });

  it('shouldContinue: solo si esta lista, falta leer, hubo progreso y no se llego al tope', () => {
    const inc = (done: number) => ready({ incomplete: true, groupsDone: done });
    expect(shouldContinue(0, inc(5), 0)).toBe(true);
    expect(shouldContinue(5, inc(5), 1)).toBe(false); // sin progreso: se corta
    expect(shouldContinue(0, ready({ incomplete: false, groupsDone: 9 }), 0)).toBe(false);
    expect(shouldContinue(0, ready({ incomplete: true, groupsDone: 5 }, { status: 'building' }), 0)).toBe(false);
    expect(shouldContinue(0, ready({ incomplete: true, groupsDone: 5 }, { status: 'failed' }), 0)).toBe(false);
    expect(shouldContinue(0, inc(5), MAX_AUTO_RUNS)).toBe(false);
  });

  it('el panel solo encadena pasadas si el profesor pulso el boton (no al abrir la pagina) y muestra progreso y temas', () => {
    const ui = read('src/app/(teacher)/teacher/classrooms/[id]/lab/MemoryPanel.tsx');
    expect(ui).toContain('shouldContinue(lastDone.current, summary, runs.current)');
    expect(ui).toContain('const click = (force: boolean) => {');
    expect(ui).toContain('setAuto(true)');
    expect(ui).not.toMatch(/useEffect\(\(\) => \{\s*start\(/);
    expect(ui).toContain('role="progressbar"');
    expect(ui).toContain('Continuar leyendo');
    expect(ui).toContain('Detalles menores');
    expect(ui).toContain("'Por temas'");
  });
});

// ─────────────────────────── leer lo guardado ───────────────────────────
describe('readGraph con los tipos nuevos', () => {
  it('acepta persona/lugar/evento y causa/ocurre_en; lo desconocido sigue degradandose', () => {
    const g = readGraph({
      concepts: [{ key: 'a', name: 'A', kind: 'persona' }, { key: 'b', name: 'B', kind: 'lugar' }, { key: 'c', name: 'C', kind: 'inventado' }],
      edges: [{ from: 'a', to: 'b', relation: 'ocurre_en' }, { from: 'b', to: 'c', relation: 'causa' }, { from: 'a', to: 'c', relation: 'rara' }],
    });
    expect(g.concepts.map((x) => x.kind)).toEqual(['persona', 'lugar', 'concepto']);
    expect(g.edges.map((x) => x.relation)).toEqual(['ocurre_en', 'causa', 'relacionado']);
  });
});
