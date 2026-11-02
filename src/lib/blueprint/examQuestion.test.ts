import { describe, expect, it } from 'vitest';
import { chunkKey, comparable, EXAM_LIMITS, provenanceOf, quoteIsInChunk, validateExamQuestion, type ChunkIndex } from './examQuestion';
import type { Blueprint } from './types';

const MAT = '11111111-1111-4111-8111-111111111111';
const plan = (): Blueprint => ({
  version: 1,
  outcomes: [{ id: 'o1', statement: 'Explica la elasticidad' }, { id: 'o2', statement: 'Calcula el equilibrio' }],
  periods: [
    { id: 'p1', name: 'Primer corte', order: 1, weight: 100, assessesOutcomeIds: ['o1', 'o2'], objectives: [
      { id: 'ob1', title: 'Elasticidad', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'Concepto de elasticidad', order: 1 }] },
      { id: 'ob2', title: 'Equilibrio', outcomeIds: ['o2'], modules: [{ id: 'm2', title: 'Oferta y demanda', order: 1 }] },
    ] },
  ],
});
const TEXT = 'La elasticidad precio de la demanda mide cuánto cambia la cantidad demandada cuando cambia el precio. Si es mayor que uno, la demanda es elástica.';
const chunks = (): ChunkIndex => new Map([[chunkKey(MAT, 3), { materialName: 'Guía de microeconomía', text: TEXT }]]);

const good = (over: Record<string, unknown> = {}) => ({
  outcomeId: 'o1',
  nodeId: 'm1',
  type: 'multiple_choice',
  q: '¿Qué mide la elasticidad precio de la demanda?',
  opts: ['A. El cambio de la cantidad demandada ante un cambio del precio', 'B. El costo de producir un bien', 'C. La utilidad total del consumidor'],
  ok: 0,
  exp: 'La elasticidad precio de la demanda compara cuánto se mueve la cantidad demandada frente a un cambio del precio; por eso la opción A es la definición, y las otras miden costos o utilidad.',
  source: { materialId: MAT, chunkIndex: 3, quote: 'mide cuánto cambia la cantidad demandada cuando cambia el precio' },
  ...over,
});
const check = (raw: unknown) => validateExamQuestion(raw, { plan: plan(), chunks: chunks() });
const errs = (raw: unknown) => {
  const r = check(raw);
  if (r.ok) throw new Error('se esperaba un rechazo');
  return r.errors.join(' | ');
};

describe('comparable / quoteIsInChunk', () => {
  it('ignora mayusculas, tildes, signos y espacios, pero no palabras distintas', () => {
    expect(comparable('  La ELASTICIDAD, precio…  ')).toBe('la elasticidad precio');
    expect(quoteIsInChunk('MIDE   cuanto cambia la cantidad', TEXT)).toBe(true);
    expect(quoteIsInChunk('mide cuanto aumenta la cantidad', TEXT)).toBe(false);
  });
  it('no acepta una palabra suelta que solo es parte de otra', () => {
    expect(quoteIsInChunk('elasticid', TEXT)).toBe(false);
    expect(quoteIsInChunk('', TEXT)).toBe(false);
    expect(quoteIsInChunk('...', TEXT)).toBe(false);
  });
});

describe('validateExamQuestion: una pregunta buena', () => {
  it('se acepta y devuelve SOLO los campos conocidos', () => {
    const r = check({ ...good(), extra: 'x', __proto__: { a: 1 }, source: { ...good().source, junk: 1 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.question).sort()).toEqual(['answers', 'exp', 'keywords', 'nodeId', 'ok', 'opts', 'outcomeId', 'pairs', 'q', 'source', 'type']);
    expect(Object.keys(r.question.source).sort()).toEqual(['chunkIndex', 'materialId', 'quote']);
  });
  it('los demas tipos tambien se aceptan', () => {
    const tf = check(good({ type: 'true_false', q: 'La elasticidad precio de la demanda mide el cambio de la cantidad demandada ante el precio.', ok: true, opts: undefined }));
    const fb = check(good({ type: 'fill_blank', q: 'La demanda es ____ si la elasticidad es mayor que uno.', answers: ['elástica'], opts: undefined, ok: undefined }));
    const sa = check(good({ type: 'short_answer', q: '¿Cuándo es elástica la demanda?', keywords: ['mayor que uno'], opts: undefined, ok: undefined }));
    const mt = check(good({ type: 'match', q: 'Une cada término con su definición.', pairs: [{ term: 'Elástica', def: 'elasticidad mayor que uno' }, { term: 'Inelástica', def: 'elasticidad menor que uno' }], opts: undefined, ok: undefined }));
    for (const r of [tf, fb, sa, mt]) expect(r.ok, JSON.stringify(r)).toBe(true);
  });
  it('una cita con otra puntuacion, mayusculas o tildes sigue valiendo', () => {
    expect(check(good({ source: { materialId: MAT, chunkIndex: 3, quote: '“MIDE cuanto cambia la cantidad demandada, cuando cambia el precio”' } })).ok).toBe(true);
  });
});

describe('validateExamQuestion: atada al plan', () => {
  it('no es un objeto', () => {
    for (const bad of [null, undefined, 'x', 5, []]) expect(check(bad).ok).toBe(false);
  });
  it('una comprension que no existe', () => expect(errs(good({ outcomeId: 'nope' }))).toContain('comprension final no existe'));
  it('un modulo que no existe (incluidos ids de objetivo o de corte)', () => {
    for (const n of ['nope', 'ob1', 'p1', 'o1', '']) expect(errs(good({ nodeId: n })), n).toContain('modulo no existe');
  });
  it('un modulo que NO ensena esa comprension', () => expect(errs(good({ nodeId: 'm2' }))).toContain('no ensena esa comprension'));
  it('ids que no son texto', () => {
    expect(check(good({ outcomeId: 5 })).ok).toBe(false);
    expect(check(good({ nodeId: { x: 1 } })).ok).toBe(false);
  });
});

describe('validateExamQuestion: pregunta y explicacion', () => {
  it('tipo que el servidor no califica (minijuegos incluidos)', () => {
    for (const t of ['ordenar_pasos', 'cartas', '', null, 5]) expect(errs(good({ type: t })), String(t)).toContain('tipo de pregunta');
  });
  it('enunciado vacio o demasiado largo', () => {
    expect(errs(good({ q: '   ' }))).toContain('pregunta esta vacia');
    expect(errs(good({ q: 'x'.repeat(EXAM_LIMITS.question + 1) }))).toContain('pasa de');
  });
  it('sin explicacion de fondo, muy corta, muy larga, o que solo repite la pregunta', () => {
    expect(errs(good({ exp: '' }))).toContain('explicacion de fondo');
    expect(errs(good({ exp: 'Porque sí.' }))).toContain('explicacion de fondo');
    expect(errs(good({ exp: 'x '.repeat(EXAM_LIMITS.explanation) }))).toContain('pasa de');
    const q = '¿Qué mide la elasticidad precio de la demanda en una economía de mercado moderna?';
    expect(errs(good({ q, exp: q.toUpperCase() }))).toContain('repite la pregunta');
  });
  it('se puede calificar bien: una opcion correcta fuera de rango, opciones iguales, sin respuesta', () => {
    expect(errs(good({ ok: 9 }))).toContain('No se puede calificar bien');
    expect(errs(good({ opts: ['A. igual', 'B. igual', 'C. otra'] }))).toContain('No se puede calificar bien');
    expect(errs(good({ type: 'fill_blank', answers: [], opts: undefined, ok: undefined }))).toContain('No se puede calificar bien');
  });
});

describe('validateExamQuestion: el material explicito se COMPRUEBA', () => {
  it('sin material', () => expect(errs(good({ source: undefined }))).toContain('Falta el material'));
  it('material mal formado', () => {
    for (const s of [{ materialId: 'no-uuid', chunkIndex: 3, quote: 'x'.repeat(30) }, { materialId: MAT, chunkIndex: -1, quote: 'x'.repeat(30) }, { materialId: MAT, chunkIndex: 1.5, quote: 'x'.repeat(30) }, { materialId: MAT, chunkIndex: '3', quote: 'x'.repeat(30) }, 'texto', []]) {
      expect(check(good({ source: s })).ok, JSON.stringify(s)).toBe(false);
    }
  });
  it('un trozo que no existe en los materiales de la clase', () => {
    expect(errs(good({ source: { materialId: MAT, chunkIndex: 99, quote: 'mide cuánto cambia la cantidad demandada' } }))).toContain('no existe en los materiales');
    expect(errs(good({ source: { materialId: '22222222-2222-4222-8222-222222222222', chunkIndex: 3, quote: 'mide cuánto cambia la cantidad demandada' } }))).toContain('no existe en los materiales');
  });
  it('cita demasiado corta o demasiado larga', () => {
    expect(errs(good({ source: { materialId: MAT, chunkIndex: 3, quote: 'mide cuánto' } }))).toContain('entre');
    expect(errs(good({ source: { materialId: MAT, chunkIndex: 3, quote: 'a'.repeat(EXAM_LIMITS.quoteMax + 1) } }))).toContain('entre');
  });
  it('una cita INVENTADA o ALTERADA se rechaza', () => {
    expect(errs(good({ source: { materialId: MAT, chunkIndex: 3, quote: 'la elasticidad mide siempre cuánto sube el precio de los bienes' } }))).toContain('NO aparece');
    expect(errs(good({ source: { materialId: MAT, chunkIndex: 3, quote: 'mide cuánto aumenta la cantidad demandada cuando cambia el precio' } }))).toContain('NO aparece');
  });
  it('informa varios problemas a la vez', () => {
    const e = errs(good({ outcomeId: 'nope', exp: '', source: undefined }));
    expect(e).toContain('comprension final no existe');
    expect(e).toContain('explicacion de fondo');
    expect(e).toContain('Falta el material');
  });
});

describe('provenanceOf: donde se vio', () => {
  const q = { outcomeId: 'o1', nodeId: 'm1', source: { materialId: MAT, chunkIndex: 3, quote: 'q' } };
  it('deriva corte, modulo, comprension y material del plan y de los materiales', () => {
    expect(provenanceOf(q, plan(), chunks())).toEqual({
      periodId: 'p1', periodName: 'Primer corte', nodeId: 'm1', moduleTitle: 'Concepto de elasticidad', outcomeId: 'o1', outcomeStatement: 'Explica la elasticidad', materialId: MAT, materialName: 'Guía de microeconomía', quote: 'q',
    });
  });
  it('si el material ya no existe, el nombre queda vacio (no se inventa)', () => {
    expect(provenanceOf(q, plan(), new Map())!.materialName).toBe('');
  });
  it('si el plan ya no tiene el modulo o la comprension: null (no se inventa donde se vio)', () => {
    expect(provenanceOf({ ...q, nodeId: 'nope' }, plan(), chunks())).toBeNull();
    expect(provenanceOf({ ...q, outcomeId: 'nope' }, plan(), chunks())).toBeNull();
  });
});
