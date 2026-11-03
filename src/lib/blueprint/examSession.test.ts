import { describe, expect, it } from 'vitest';
import { FILL_EXTRA_WORDS, INFLECTION_LETTERS, gradeFillBlank, gradeSession, presentQuestion, servedFromRow, startExam, stripOptionLetter, type SessionLayout } from './examSession';
import type { BankRow } from './examBank';
import type { Blueprint } from './types';

const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const plan = (): Blueprint => ({
  version: 1,
  outcomes: [{ id: 'o1', statement: 'Uno' }, { id: 'o2', statement: 'Dos' }],
  periods: [{ id: 'p1', name: 'Corte 1', order: 1, weight: 100, assessesOutcomeIds: ['o1', 'o2'], objectives: [
    { id: 'ob1', title: 'T', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'M1', order: 1 }] },
    { id: 'ob2', title: 'U', outcomeIds: ['o2'], modules: [{ id: 'm2', title: 'M2', order: 1 }] },
  ] }],
});
const row = (over: Partial<BankRow> & { id: string }): BankRow => ({
  outcome_id: 'o1', node_id: 'm1', type: 'multiple_choice', q: 'Pregunta ' + over.id, opts: ['A. uno', 'B. dos', 'C. tres', 'D. cuatro'], ok: 2, answers: null, keywords: null, pairs: null, exp: 'Explicacion de fondo de la pregunta ' + over.id,
  source_material_id: 'mat', source_chunk: 1, source_quote: 'cita ' + over.id, review_status: 'approved', judge_verdict: 'supported', judge_problems: [], ...over,
});
const MC = row({ id: 'mc' });
const TF = row({ id: 'tf', type: 'true_false', opts: null, ok: false });
const FB = row({ id: 'fb', type: 'fill_blank', opts: null, ok: null, answers: ['costo de oportunidad'] });
const SA = row({ id: 'sa', type: 'short_answer', opts: null, ok: null, keywords: ['pendiente', 'precio'] });
const MT = row({ id: 'mt', type: 'match', opts: null, ok: null, pairs: [{ term: 'T1', def: 'D1' }, { term: 'T2', def: 'D2' }, { term: 'T3', def: 'D3' }] });
const ALL = [MC, TF, FB, SA, MT];
const bank = (): BankRow[] => [
  ...Array.from({ length: 6 }, (_, i) => row({ id: `a${i}`, outcome_id: 'o1', node_id: 'm1' })),
  ...Array.from({ length: 6 }, (_, i) => row({ id: `b${i}`, outcome_id: 'o2', node_id: 'm2' })),
];

describe('stripOptionLetter', () => {
  it('quita «A. », «b) » y deja el resto; sin letra, igual', () => {
    expect(stripOptionLetter('A. La respuesta')).toBe('La respuesta');
    expect(stripOptionLetter('  b) otra cosa ')).toBe('otra cosa');
    expect(stripOptionLetter('Sin letra')).toBe('Sin letra');
    expect(stripOptionLetter('A.Pegado')).toBe('A.Pegado');
    expect(stripOptionLetter('Ana. Maria')).toBe('Ana. Maria');
  });
});

describe('startExam', () => {
  it('solo sirve preguntas APROBADAS y devuelve su barajado', () => {
    const rows = bank().map((r, i) => (i % 3 === 0 ? { ...r, review_status: 'pending' as const } : r));
    const r = startExam({ plan: plan(), rows, exam: { kind: 'period', periodId: 'p1' }, size: 6, rng: seeded(1) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const approved = new Set(rows.filter((x) => x.review_status === 'approved').map((x) => x.id));
    expect(r.questionIds.length).toBe(6);
    expect(r.questionIds.every((id) => approved.has(id))).toBe(true);
    expect(Object.keys(r.layout).sort()).toEqual([...r.questionIds].sort());
  });
  it('barajar las opciones de opcion multiple nunca las deja todas en su sitio, y es una permutacion', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = startExam({ plan: plan(), rows: bank(), exam: { kind: 'final' }, size: 6, rng: seeded(seed) });
      if (!r.ok) throw new Error('fallo');
      for (const l of Object.values(r.layout)) {
        expect([...l.opts!].sort()).toEqual([0, 1, 2, 3]);
        expect(l.opts!.every((v, i) => v === i)).toBe(false);
      }
    }
  });
  it('emparejar baraja las definiciones; verdadero/falso no lleva barajado', () => {
    const rows = [...bank(), row({ id: 'mt', type: 'match', outcome_id: 'o1', node_id: 'm1', opts: null, ok: null, pairs: [{ term: 'T1', def: 'D1' }, { term: 'T2', def: 'D2' }] }), row({ id: 'tf', type: 'true_false', outcome_id: 'o1', node_id: 'm1', opts: null, ok: true })];
    const r = startExam({ plan: plan(), rows, exam: { kind: 'final' }, size: 60, rng: seeded(3) });
    if (!r.ok) throw new Error('fallo');
    expect(r.layout.mt.defs).toEqual([1, 0]);
    expect(r.layout.tf).toEqual({});
  });
  it('un intento distinto baraja distinto (otra semilla, otro orden de opciones)', () => {
    const a = startExam({ plan: plan(), rows: bank(), exam: { kind: 'final' }, size: 12, rng: seeded(1) });
    const b = startExam({ plan: plan(), rows: bank(), exam: { kind: 'final' }, size: 12, rng: seeded(2) });
    if (!a.ok || !b.ok) throw new Error('fallo');
    expect(JSON.stringify(a.layout)).not.toBe(JSON.stringify(b.layout));
  });
  it('propaga los motivos de composeExam: sin aprobadas no hay examen', () => {
    const none = bank().map((r) => ({ ...r, review_status: 'pending' as const }));
    const r = startExam({ plan: plan(), rows: none, exam: { kind: 'final' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('uncoveredOutcomes');
    const nop = startExam({ plan: plan(), rows: bank(), exam: { kind: 'period', periodId: 'nope' } });
    expect(!nop.ok && nop.reason).toBe('noSuchPeriod');
  });
});

describe('presentQuestion: lo que ve el estudiante', () => {
  it('opcion multiple: opciones sin letra y en el orden barajado', () => {
    const p = presentQuestion(MC, { opts: [3, 1, 0, 2] });
    expect(p.opts).toEqual(['cuatro', 'dos', 'uno', 'tres']);
  });
  it('NUNCA lleva clave, explicacion, fuente ni veredicto (ningun tipo)', () => {
    for (const r of ALL) {
      const p = presentQuestion(r, { opts: [1, 0, 2, 3], defs: [2, 0, 1] });
      const text = JSON.stringify(p);
      for (const k of ['"ok"', '"answers"', '"keywords"', '"pairs"', '"exp"', 'source', 'judge', 'Explicacion de fondo', 'cita ', 'costo de oportunidad']) expect(text).not.toContain(k);
      expect(Object.keys(p).every((k) => ['id', 'type', 'q', 'opts', 'terms', 'defs'].includes(k))).toBe(true);
    }
  });
  it('emparejar: terminos en su orden y definiciones barajadas', () => {
    const p = presentQuestion(MT, { defs: [2, 0, 1] });
    expect(p.terms).toEqual(['T1', 'T2', 'T3']);
    expect(p.defs).toEqual(['D3', 'D1', 'D2']);
  });
  it('un barajado ausente o de otro tamano no rompe: se muestra en el orden original', () => {
    expect(presentQuestion(MC, undefined).opts).toEqual(['uno', 'dos', 'tres', 'cuatro']);
    expect(presentQuestion(MC, { opts: [1, 0] }).opts).toEqual(['uno', 'dos', 'tres', 'cuatro']);
    expect(presentQuestion(MT, { defs: [0] }).defs).toEqual(['D1', 'D2', 'D3']);
  });
  it('datos raros en la base (opciones que no son lista, parejas incompletas) no rompen', () => {
    expect(presentQuestion(row({ id: 'x', opts: 'raro' as any }), undefined).opts).toEqual([]);
    expect(presentQuestion(row({ id: 'y', type: 'match', opts: null, pairs: [{ term: 'a' }, { term: 'b', def: 'B' }] as any }), undefined)).toMatchObject({ terms: ['b'], defs: ['B'] });
  });
});

describe('gradeSession', () => {
  const layout: SessionLayout = { mc: { opts: [3, 1, 0, 2] }, mt: { defs: [2, 0, 1] } };
  // En lo que VIO el estudiante, la correcta (original 2 = «tres») esta en la posicion 3.
  const perfect = { mc: { selectedIndex: 3 }, tf: { selected: false }, fb: { text: 'el costo de oportunidad' }, sa: { text: 'la pendiente depende del precio' }, mt: { defs: ['D1', 'D2', 'D3'] } };
  it('jugada perfecta = 100 %', () => {
    const g = gradeSession({ rows: ALL, layout, answers: perfect });
    expect(g).toMatchObject({ correct: 5, total: 5, scorePercent: 100 });
    expect(Object.values(g.results).every(Boolean)).toBe(true);
  });
  it('la posicion que ve el estudiante se traduce a la original', () => {
    expect(gradeSession({ rows: [MC], layout, answers: { mc: { selectedIndex: 2 } } }).results.mc).toBe(false); // posicion 2 = original 0 («uno»)
    expect(gradeSession({ rows: [MC], layout, answers: { mc: { selectedIndex: 3 } } }).results.mc).toBe(true);
  });
  it('cada tipo falla por separado', () => {
    const g = gradeSession({ rows: ALL, layout, answers: { ...perfect, tf: { selected: true }, sa: { text: 'solo precio' }, mt: { defs: ['D2', 'D1', 'D3'] } } });
    expect(g.results).toEqual({ mc: true, tf: false, fb: true, sa: false, mt: false });
    expect(g.scorePercent).toBe(40);
  });
  it('lo que falta o viene mal cuenta como incorrecto, sin tirar', () => {
    const g = gradeSession({ rows: ALL, layout, answers: { mc: { selectedIndex: 99 }, tf: 'si', fb: null, sa: {}, mt: { defs: ['D1'] } } });
    expect(g.correct).toBe(0);
    for (const bad of [null, undefined, 5, 'x', [], [1, 2]]) expect(gradeSession({ rows: ALL, layout, answers: bad }).correct).toBe(0);
  });
  it('indices no enteros, negativos o fuera de rango en opcion multiple son incorrectos', () => {
    for (const sel of [-1, 1.5, 4, NaN, '3', null]) expect(gradeSession({ rows: [MC], layout, answers: { mc: { selectedIndex: sel } } }).results.mc).toBe(false);
  });
  it('sin barajado guardado, opcion multiple no se puede calificar: incorrecta (no se adivina)', () => {
    expect(gradeSession({ rows: [MC], layout: {}, answers: { mc: { selectedIndex: 2 } } }).results.mc).toBe(false);
  });
  it('respuestas de preguntas que no son del examen se ignoran; no se hereda de Object.prototype', () => {
    const g = gradeSession({ rows: [TF], layout: {}, answers: { tf: { selected: false }, otra: { selected: true }, constructor: { selected: true } } });
    expect(Object.keys(g.results)).toEqual(['tf']);
    expect(gradeSession({ rows: [row({ id: 'constructor', type: 'true_false', opts: null, ok: true })], layout: {}, answers: {} }).results.constructor).toBe(false);
  });
  it('el puntaje se redondea a 2 decimales y sin preguntas es 0 (no NaN)', () => {
    const three = [TF, row({ id: 'tf2', type: 'true_false', opts: null, ok: false }), row({ id: 'tf3', type: 'true_false', opts: null, ok: false })];
    expect(gradeSession({ rows: three, layout: {}, answers: { tf: { selected: false } } }).scorePercent).toBe(33.33);
    expect(gradeSession({ rows: [], layout: {}, answers: {} })).toMatchObject({ total: 0, correct: 0, scorePercent: 0 });
  });
});

describe('servedFromRow', () => {
  it('pasa lo necesario para la retroalimentacion, con la fuente armada', () => {
    expect(servedFromRow(MC)).toMatchObject({ id: 'mc', outcomeId: 'o1', nodeId: 'm1', type: 'multiple_choice', q: 'Pregunta mc', exp: 'Explicacion de fondo de la pregunta mc', source: { materialId: 'mat', chunkIndex: 1, quote: 'cita mc' } });
  });
});

describe('gradeFillBlank: palabra completa, no «contiene»', () => {
  it('el caso real medido: «inelastica» NO es «elastica»', () => {
    expect(gradeFillBlank('elástica', ['elástica'])).toBe(true);
    expect(gradeFillBlank('inelástica', ['elástica'])).toBe(false);
    expect(gradeFillBlank('la demanda es inelástica', ['elástica'])).toBe(false);
  });
  it('plural, genero o terminacion corta SI valen (hasta 3 letras de mas y palabras de 4 letras o mas)', () => {
    expect(INFLECTION_LETTERS).toBe(3);
    expect(gradeFillBlank('elásticas', ['elástica'])).toBe(true);
    expect(gradeFillBlank('los precios', ['precio'])).toBe(true);
    expect(gradeFillBlank('costos de oportunidades', ['costo de oportunidad'])).toBe(true); // cada palabra con su terminacion
    expect(gradeFillBlank('elásticamente', ['elástica'])).toBe(false); // 5 letras de mas
    expect(gradeFillBlank('elásticaaaaa', ['elástica'])).toBe(false);
    expect(gradeFillBlank('exceso', ['x'])).toBe(false);
    expect(gradeFillBlank('los', ['lo'])).toBe(false); // menos de 4 letras: solo igual
    expect(gradeFillBlank('solo', ['sol'])).toBe(false); // 3 letras: solo igual
    expect(gradeFillBlank('sol', ['sol'])).toBe(true);
    // la frase se acaba antes que la respuesta esperada: no acierta ni tira
    expect(gradeFillBlank('el costo', ['costo oportunidad'])).toBe(false);
  });
  it('sin tildes, mayusculas ni puntuacion; la respuesta puede ir dentro de una frase corta', () => {
    expect(gradeFillBlank('ELASTICA', ['elástica'])).toBe(true);
    expect(gradeFillBlank('  Es elástica.  ', ['elástica'])).toBe(true);
    expect(gradeFillBlank('la demanda es elástica', ['elástica'])).toBe(true);
  });
  it('expresiones de varias palabras: en ese orden y seguidas', () => {
    expect(gradeFillBlank('el costo de oportunidad', ['costo de oportunidad'])).toBe(true);
    expect(gradeFillBlank('oportunidad de costo', ['costo de oportunidad'])).toBe(false);
    expect(gradeFillBlank('costo oportunidad', ['costo de oportunidad'])).toBe(false);
    expect(gradeFillBlank('costo de la oportunidad', ['costo de oportunidad'])).toBe(false);
  });
  it('una lista larga de terminos NO pasa (tope de palabras de mas)', () => {
    expect(FILL_EXTRA_WORDS).toBe(3);
    expect(gradeFillBlank('uno dos tres elástica', ['elástica'])).toBe(true); // 4 palabras = 1 + 3
    expect(gradeFillBlank('uno dos tres cuatro elástica', ['elástica'])).toBe(false); // 5 palabras
    expect(gradeFillBlank('elástica inelástica unitaria perfectamente rigida', ['elástica'])).toBe(false);
    // el tope cuenta sobre la respuesta MAS LARGA: una expresion de 3 palabras admite 3 de mas
    expect(gradeFillBlank('a b c costo de oportunidad', ['costo de oportunidad'])).toBe(true);
    expect(gradeFillBlank('a b c d costo de oportunidad', ['costo de oportunidad'])).toBe(false);
  });
  it('vacio, solo signos o respuesta esperada vacia: nunca acierta', () => {
    expect(gradeFillBlank('', ['elástica'])).toBe(false);
    expect(gradeFillBlank('   ', ['elástica'])).toBe(false);
    expect(gradeFillBlank('¿?!', ['elástica'])).toBe(false);
    expect(gradeFillBlank('algo', [''])).toBe(false);
    expect(gradeFillBlank('algo', [])).toBe(false);
    expect(gradeFillBlank('algo', ['elástica', '...'])).toBe(false);
    // una respuesta esperada que no tiene palabras no se «salta»: no se puede calificar a medias
    expect(gradeFillBlank('elástica', ['elástica', '...'])).toBe(false);
    // el tope usa la respuesta mas larga cuando hay varias
    expect(gradeFillBlank('a b costo de oportunidad elástica', ['elástica', 'costo de oportunidad'])).toBe(true);
    expect(gradeFillBlank('a b c costo de oportunidad elástica', ['elástica', 'costo de oportunidad'])).toBe(false);
  });
  it('si hubiera varias respuestas, hacen falta TODAS (como en el resto de la app)', () => {
    expect(gradeFillBlank('elástica y rigida', ['elástica', 'rigida'])).toBe(true);
    expect(gradeFillBlank('elástica', ['elástica', 'rigida'])).toBe(false);
  });
  it('numeros y una sola letra tambien se comparan como palabras enteras', () => {
    expect(gradeFillBlank('x', ['x'])).toBe(true);
    expect(gradeFillBlank('exceso', ['x'])).toBe(false);
    expect(gradeFillBlank('el valor es 15', ['15'])).toBe(true);
    expect(gradeFillBlank('150', ['15'])).toBe(false);
  });
  it('gradeSession lo usa: «inelastica» falla y «elastica» acierta; texto que no es cadena, falla', () => {
    const fb = row({ id: 'fbx', type: 'fill_blank', opts: null, ok: null, answers: ['elástica'] });
    const g = (text: unknown) => gradeSession({ rows: [fb], layout: {}, answers: { fbx: { text } } }).results.fbx;
    expect(g('elástica')).toBe(true);
    expect(g('inelástica')).toBe(false);
    expect(g(5)).toBe(false);
    expect(g(undefined)).toBe(false);
    expect(gradeSession({ rows: [fb], layout: {}, answers: {} }).results.fbx).toBe(false);
    expect(gradeSession({ rows: [fb], layout: {}, answers: { fbx: 'elástica' } }).results.fbx).toBe(false);
  });
});

