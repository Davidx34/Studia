import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { dropNearDuplicates, fuseVariants, packByRelevance, relativeCutoff, selectContext, type Retrieved } from './fusion';
import {
  COMPOSITE_WEIGHTS,
  DEFAULT_GRID,
  RECOMMEND_MAX_REGRESSION,
  RECOMMEND_MIN_GAIN,
  composite,
  conceptScores,
  documentCoverage,
  evaluateConfig,
  interModuleDiversity,
  recommend,
  sweep,
  type ModuleRun,
  type SweepRow,
  type TuningMetrics,
} from './tuning';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const R = (id: string, content = `contenido del fragmento ${id} con palabras distintas ${id}${id}`, material = 'm1'): Retrieved => ({
  chunk_id: id,
  content,
  material_id: material,
  chunk_index: Number(id.replace(/\D/g, '')) || 0,
  score: 0,
});
const LIMITS = { charLimit: 16000, maxChunks: 8 };

describe('selectContext: la misma composicion que antes', () => {
  it('equivale a fusionar, cortar, quitar repetidos y empaquetar con los valores de siempre', () => {
    const lists = [
      ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((id) => R(id)),
      ['a3', 'a1', 'a7', 'a8'].map((id) => R(id)),
    ];
    const legacy = packByRelevance(dropNearDuplicates(relativeCutoff(fuseVariants(lists))), 16000, 8);
    const now = selectContext(lists, { k: 60, cutoffRatio: 0.25, minKeep: 4, charLimit: 16000, maxChunks: 8 });
    expect(now.map((c) => c.chunk_id)).toEqual(legacy.map((c) => c.chunk_id));
  });
  it('el corte relativo sube el umbral pero nunca deja menos de minKeep', () => {
    const lists = [Array.from({ length: 8 }, (_, i) => R(`c${i + 1}`))];
    const open = selectContext(lists, { k: 1, cutoffRatio: 0, minKeep: 4, charLimit: 99999, maxChunks: 8 });
    const tight = selectContext(lists, { k: 1, cutoffRatio: 0.9, minKeep: 4, charLimit: 99999, maxChunks: 8 });
    expect(open).toHaveLength(8);
    expect(tight).toHaveLength(4);
  });
  // P es 1.o en UNA lista; Q es 5.o en DOS. Con k bajo manda el primer puesto (P); con k alto, la repeticion (Q): P > Q solo si k < 3.
  const lists2 = (): Retrieved[][] => [
    [R('p1'), R('f1'), R('f2'), R('f3'), R('q1')],
    [R('g1'), R('g2'), R('g3'), R('g4'), R('q1')],
  ];
  it('k decide entre "primer puesto en una consulta" y "salir en varias": el orden cambia', () => {
    const top = (k: number) => selectContext(lists2(), { k, cutoffRatio: 0, minKeep: 4, charLimit: 99999, maxChunks: 1 })[0].chunk_id;
    expect(top(1)).toBe('p1');
    expect(top(60)).toBe('q1');
  });
});

describe('metricas', () => {
  it('diversidad: contextos identicos = 0 y se cuentan; disjuntos = 1; un solo modulo = 1', () => {
    expect(interModuleDiversity([['a', 'b'], ['a', 'b']])).toEqual({ diversity: 0, identicalPairs: 1 });
    expect(interModuleDiversity([['a', 'b'], ['c', 'd']])).toEqual({ diversity: 1, identicalPairs: 0 });
    expect(interModuleDiversity([['a']])).toEqual({ diversity: 1, identicalPairs: 0 });
    expect(interModuleDiversity([])).toEqual({ diversity: 1, identicalPairs: 0 });
  });
  it('diversidad: parecido parcial (Jaccard) y varios pares', () => {
    const d = interModuleDiversity([['a', 'b', 'c'], ['b', 'c', 'd'], ['x']]);
    // pares: (0,1)=2/4=.5  (0,2)=0  (1,2)=0  -> media .1666 -> diversidad .8333
    expect(d.diversity).toBeCloseTo(1 - 0.5 / 3, 6);
    expect(d.identicalPairs).toBe(0);
  });
  it('cobertura: union / total, con tope 1 y 0 si no hay material', () => {
    expect(documentCoverage([['a', 'b'], ['b', 'c']], 6)).toBeCloseTo(0.5, 6);
    expect(documentCoverage([['a', 'b', 'c']], 2)).toBe(1);
    expect(documentCoverage([['a']], 0)).toBe(0);
    expect(documentCoverage([], 5)).toBe(0);
  });
  it('conceptos clave: precision (fragmentos que hablan de alguno) y recall (conceptos presentes); sin tildes ni mayusculas; palabra completa', () => {
    const chunks = [{ content: 'La Elasticidad mide la respuesta.' }, { content: 'Texto sin relacion alguna.' }, { content: 'El aprecio del publico.' }];
    const s = conceptScores(chunks, ['elasticidad', 'precio', 'respuesta']);
    expect(s.precision).toBeCloseTo(1 / 3, 6); // "aprecio" NO contiene "precio" como palabra
    expect(s.recall).toBeCloseTo(2 / 3, 6);
    expect(conceptScores([{ content: 'Demanda y Oferta' }], ['DEMANDA']).precision).toBe(1);
    expect(conceptScores(chunks, [])).toEqual({ precision: 0, recall: 0 });
    expect(conceptScores([], ['x1'])).toEqual({ precision: 0, recall: 0 });
    expect(conceptScores(chunks, ['a', ' '])).toEqual({ precision: 0, recall: 0 });
  });
  it('un concepto con simbolos de regex no rompe la busqueda', () => {
    // El termino se busca LITERAL (con los simbolos escapados): aparece tal cual, asi que cuenta; y uno que no aparece no cuenta por accidente de la regex.
    expect(conceptScores([{ content: 'se usa (x+y)* aqui' }], ['(x+y)*']).precision).toBe(1);
    expect(conceptScores([{ content: 'se usa xxy aqui' }], ['(x+y)*']).precision).toBe(0);
    expect(() => conceptScores([{ content: 'a.b' }], ['a.b', '[x', '$^'])).not.toThrow();
  });
  it('el compuesto pesa 0,4 / 0,3 / 0,3 (suman 1)', () => {
    expect(COMPOSITE_WEIGHTS.diversity + COMPOSITE_WEIGHTS.coverage + COMPOSITE_WEIGHTS.conceptPrecision).toBeCloseTo(1, 10);
    expect(composite({ diversity: 1, coverage: 0, conceptPrecision: 0 })).toBeCloseTo(0.4, 10);
    expect(composite({ diversity: 0, coverage: 1, conceptPrecision: 0 })).toBeCloseTo(0.3, 10);
    expect(composite({ diversity: 0, coverage: 0, conceptPrecision: 1 })).toBeCloseTo(0.3, 10);
  });
});

describe('evaluateConfig', () => {
  const run = (id: string, ids: string[], kw: string[], scope = 20): ModuleRun => ({
    moduleId: id,
    keywords: kw,
    lists: [ids.map((c) => R(c, `texto con ${kw[0] ?? 'nada'} en ${c} unico-${c}`))],
    scopeChunks: scope,
  });
  it('dos modulos con el MISMO contexto: diversidad 0 y un par identico', () => {
    const m = evaluateConfig([run('m1', ['a1', 'a2', 'a3', 'a4'], ['tema']), run('m2', ['a1', 'a2', 'a3', 'a4'], ['tema'])], { k: 60, cutoffRatio: 0.25 }, LIMITS);
    expect(m.diversity).toBe(0);
    expect(m.identicalPairs).toBe(1);
  });
  it('dos modulos con contextos distintos: diversidad 1, cobertura = union / material, precision 1', () => {
    const m = evaluateConfig([run('m1', ['a1', 'a2', 'a3', 'a4'], ['tema']), run('m2', ['b1', 'b2', 'b3', 'b4'], ['tema'])], { k: 60, cutoffRatio: 0.25 }, LIMITS);
    expect(m.diversity).toBe(1);
    expect(m.coverage).toBeCloseTo(8 / 20, 6);
    expect(m.conceptPrecision).toBe(1);
    expect(m.composite).toBeCloseTo(0.4 * 1 + 0.3 * 0.4 + 0.3 * 1, 6);
  });
  it('sin palabras clave la precision es 0 (no distingue configuraciones)', () => {
    const m = evaluateConfig([run('m1', ['a1', 'a2', 'a3', 'a4'], []), run('m2', ['b1', 'b2', 'b3', 'b4'], [])], { k: 60, cutoffRatio: 0.25 }, LIMITS);
    expect(m.conceptPrecision).toBe(0);
  });
  it('sin modulos no revienta', () => {
    expect(() => evaluateConfig([], { k: 60, cutoffRatio: 0.25 }, LIMITS)).not.toThrow();
  });
});

describe('sweep', () => {
  const mkRuns = (offset: number): ModuleRun[] =>
    ['m1', 'm2', 'm3'].map((id, i) => ({
      moduleId: id,
      keywords: ['tema'],
      lists: [Array.from({ length: 6 }, (_, j) => R(`${id}c${j + 1}`, `tema ${id} ${j} ${offset}`)), Array.from({ length: 6 }, (_, j) => R(`${id}c${(j + i + offset) % 6 + 1}`, `tema ${id} ${j}`))],
      scopeChunks: 40,
    }));
  const grid = { textWeights: [0, 0.3], ks: [10, 60], cutoffRatios: [0, 0.25] };

  it('una fila por combinacion y ordenadas de mejor a peor compuesto', () => {
    const rows = sweep(new Map([[0, mkRuns(0)], [0.3, mkRuns(1)]]), LIMITS, grid);
    expect(rows).toHaveLength(2 * 2 * 2);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].metrics.composite).toBeGreaterThanOrEqual(rows[i].metrics.composite);
    expect(new Set(rows.map((r) => `${r.textWeight}|${r.k}|${r.cutoffRatio}`)).size).toBe(8);
  });
  it('un peso que no esta en la rejilla se ignora', () => {
    expect(sweep(new Map([[0.77, mkRuns(0)]]), LIMITS, grid)).toHaveLength(0);
  });
  it('la rejilla por defecto cubre de 0 a 2 y contiene la configuracion de produccion (0,3 / 60 / 0,25)', () => {
    expect(Math.min(...DEFAULT_GRID.textWeights)).toBe(0);
    expect(Math.max(...DEFAULT_GRID.textWeights)).toBe(2);
    expect(DEFAULT_GRID.textWeights).toContain(0.3);
    expect(DEFAULT_GRID.ks).toContain(60);
    expect(DEFAULT_GRID.cutoffRatios).toContain(0.25);
  });
});

describe('recommend', () => {
  const metrics = (c: number, d = 0.5, cov = 0.5, p = 0.5): TuningMetrics => ({ diversity: d, coverage: cov, conceptPrecision: p, conceptRecall: 0.5, identicalPairs: 0, composite: c });
  const row = (w: number, k: number, ratio: number, m: TuningMetrics): SweepRow => ({ textWeight: w, k, cutoffRatio: ratio, metrics: m });
  const current = { textWeight: 0.3, k: 60, cutoffRatio: 0.25 };

  it('sin filas: null', () => {
    expect(recommend([], current)).toBeNull();
  });
  it('si la configuracion actual no se midio, NO recomienda cambiar', () => {
    const r = recommend([row(1, 10, 0, metrics(0.9))], current)!;
    expect(r.change).toBe(false);
    expect(r.reason).toMatch(/no esta en la rejilla/);
  });
  it('mejora menor que el minimo: no cambia', () => {
    const rows = [row(0.5, 30, 0.1, metrics(0.6 + RECOMMEND_MIN_GAIN - 0.001)), row(0.3, 60, 0.25, metrics(0.6))];
    expect(recommend(rows, current)!.change).toBe(false);
  });
  it('mejora clara y sin regresiones: recomienda cambiar', () => {
    const rows = [row(0.5, 30, 0.1, metrics(0.7, 0.6, 0.5, 0.5)), row(0.3, 60, 0.25, metrics(0.6, 0.5, 0.5, 0.5))];
    const r = recommend(rows, current)!;
    expect(r.change).toBe(true);
    expect(r.best.textWeight).toBe(0.5);
    expect(r.baseline?.textWeight).toBe(0.3);
  });
  it('mejora el compuesto pero EMPEORA una propiedad mas del limite: no recomienda', () => {
    const rows = [row(0.5, 30, 0.1, metrics(0.8, 0.9, 0.5, 0.5 - RECOMMEND_MAX_REGRESSION - 0.01)), row(0.3, 60, 0.25, metrics(0.6, 0.5, 0.5, 0.5))];
    const r = recommend(rows, current)!;
    expect(r.change).toBe(false);
    expect(r.reason).toMatch(/conceptPrecision/);
  });
});

describe('variables de entorno de la recuperacion', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  async function load(name: 'RAG_RRF_K' | 'RAG_CUTOFF_RATIO', env?: string) {
    vi.resetModules();
    vi.unstubAllEnvs();
    if (env !== undefined) vi.stubEnv(name, env);
    const m = await import('./retrieve');
    return name === 'RAG_RRF_K' ? m.RAG_RRF_K : m.RAG_CUTOFF_RATIO;
  }
  it('RAG_RRF_K: 60 por defecto; acepta de 1 a 1000; lo invalido se ignora', async () => {
    expect(await load('RAG_RRF_K')).toBe(60);
    expect(await load('RAG_RRF_K', '30')).toBe(30);
    expect(await load('RAG_RRF_K', '1')).toBe(1);
    expect(await load('RAG_RRF_K', '1000')).toBe(1000);
    for (const bad of ['abc', '0', '-5', '1001', '', '  ']) expect(await load('RAG_RRF_K', bad)).toBe(60);
  });
  it('RAG_CUTOFF_RATIO: 0,25 por defecto; acepta de 0 a 1; lo invalido se ignora', async () => {
    expect(await load('RAG_CUTOFF_RATIO')).toBe(0.25);
    expect(await load('RAG_CUTOFF_RATIO', '0')).toBe(0);
    expect(await load('RAG_CUTOFF_RATIO', '0.4')).toBe(0.4);
    expect(await load('RAG_CUTOFF_RATIO', '1')).toBe(1);
    for (const bad of ['abc', '-0.1', '1.5', '', ' ']) expect(await load('RAG_CUTOFF_RATIO', bad)).toBe(0.25);
  });
  it('la recuperacion usa los parametros recibidos (peso del texto, k y corte) y los de entorno si no llegan', async () => {
    vi.resetModules();
    const { retrieveContext } = await import('./retrieve');
    const calls: { text_weight: number }[] = [];
    const rows = Array.from({ length: 6 }, (_, i) => ({ chunk_id: `c${i + 1}`, content: `fragmento numero ${i + 1} con texto propio ${i}${i}`, material_id: 'm', chunk_index: i + 1, score: 0.1 }));
    const client = {
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { title: 'Tema', description: 'd', classroom_id: 'c', source_material_ids: [], topic_keywords: [] } }) }) }) }),
      rpc: async (_n: string, args: { text_weight: number }) => (calls.push(args), { data: rows }),
    };
    const embed = async () => [0.1, 0.2];
    await retrieveContext(client, 'mod', { charLimit: 99999, embed });
    await retrieveContext(client, 'mod', { charLimit: 99999, embed, textWeight: 1.7 });
    expect(calls[0].text_weight).toBe(0.3);
    expect(calls[calls.length - 1].text_weight).toBe(1.7);
    const tight = await retrieveContext(client, 'mod', { charLimit: 99999, embed, cutoffRatio: 1, fusionK: 5 });
    expect(tight!.chunkIds.length).toBeLessThanOrEqual(6);
  });
  it('fusionK llega a la fusion: con k=1 gana el primer puesto de una consulta; con k=60 (el de produccion), el fragmento que sale en varias', async () => {
    vi.resetModules();
    const { retrieveContext } = await import('./retrieve');
    const mk = (id: string): Retrieved => ({ chunk_id: id, content: `texto distinto del fragmento ${id} ${id}${id}`, material_id: 'm', chunk_index: Number(id.replace(/\D/g, '')) || 0, score: 0 });
    const perCall = [[mk('p1'), mk('f1'), mk('f2'), mk('f3'), mk('q1')], [mk('g1'), mk('g2'), mk('g3'), mk('g4'), mk('q1')]];
    const client = (calls: { n: number }) => ({
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { title: 'Tema', description: 'detalle', classroom_id: 'c', source_material_ids: [], topic_keywords: [] } }) }) }) }),
      rpc: async () => ({ data: perCall[calls.n++ % 2] }),
    });
    const embed = async () => [0.1];
    const low = await retrieveContext(client({ n: 0 }), 'mod', { charLimit: 99999, embed, maxChunks: 1, cutoffRatio: 0, fusionK: 1 });
    const high = await retrieveContext(client({ n: 0 }), 'mod', { charLimit: 99999, embed, maxChunks: 1, cutoffRatio: 0 });
    expect(low!.chunkIds).toEqual(['p1']);
    expect(high!.chunkIds).toEqual(['q1']);
  });
});

describe('cableado del barrido', () => {
  it('el script lee y NO escribe en la base, y reutiliza el codigo de produccion', () => {
    const src = read('scripts/eval-rag-sweep.ts');
    expect(src).toMatch(/match_material_chunks_hybrid/);
    expect(src).toMatch(/from '\.\.\/src\/lib\/rag\/tuning'/);
    expect(src).toMatch(/RAG_CUTOFF_RATIO.*RAG_RRF_K.*RAG_TEXT_WEIGHT|RAG_TEXT_WEIGHT/);
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
  it('el script excluye los modulos SIN material (dos contextos vacios no son contextos identicos) y omite la clase si quedan menos de 2', () => {
    const src = read('scripts/eval-rag-sweep.ts');
    expect(src).toMatch(/if \(scopeChunks === 0\) \{\s*withoutMaterial\+\+;\s*continue;/);
    expect(src).toMatch(/perModule\.length < 2/);
    // y el material se cuenta ANTES de gastar embeddings
    expect(src.indexOf('withoutMaterial++')).toBeLessThan(src.indexOf('embed(v)'));
  });
  it('la recuperacion de produccion usa selectContext (lo medido es lo que corre)', () => {
    expect(read('src/lib/rag/retrieve.ts')).toMatch(/selectContext\(/);
    expect(read('src/lib/rag/tuning.ts')).toMatch(/selectContext\(/);
  });
});
