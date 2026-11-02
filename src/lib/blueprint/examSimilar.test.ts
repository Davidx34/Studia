import { describe, expect, it } from 'vitest';
import { findSimilar, jaccard, SIMILAR } from './examSimilar';
import { STRAY_SYMBOL, validateExamQuestion, chunkKey, type ChunkIndex } from './examQuestion';
import type { Blueprint } from './types';

const Q = (q: string, type = 'multiple_choice', quote = 'cita uno') => ({ q, type, quote });

describe('jaccard', () => {
  it('textos iguales dan 1 y sin palabras en comun, 0', () => {
    expect(jaccard('La elasticidad precio', 'la ELASTICIDAD precio')).toBe(1);
    expect(jaccard('elasticidad precio demanda', 'restriccion presupuestaria consumidor')).toBe(0);
  });
  it('ignora tildes, puntuacion y palabras de menos de 3 letras', () => {
    expect(jaccard('¿Qué es la demanda?', 'que es una demanda')).toBeGreaterThan(0.5);
    expect(jaccard('a de la el', 'a de la el')).toBe(0);
  });
  it('el caso real medido: «mide» vs «representa» con el mismo resto', () => {
    const j = jaccard('¿Qué mide la elasticidad precio de la demanda?', '¿Qué representa la elasticidad precio de la demanda?');
    expect(j).toBeGreaterThanOrEqual(SIMILAR.sameSource);
    expect(j).toBeLessThan(SIMILAR.any);
  });
});

describe('findSimilar', () => {
  const existing = [Q('¿Qué mide la elasticidad precio de la demanda?', 'multiple_choice', 'mide cuanto responde la cantidad')];
  it('el caso real: mismo tipo y misma cita con otras palabras se rechaza', () => {
    expect(findSimilar(Q('¿Qué representa la elasticidad precio de la demanda?', 'multiple_choice', 'Mide cuanto, responde la cantidad.'), existing)).toBe(existing[0]);
  });
  it('misma redaccion casi identica se rechaza aunque cambien tipo y cita', () => {
    expect(findSimilar(Q('¿Que mide la elasticidad precio de la demanda ordinaria?', 'true_false', 'otra cita'), existing)).toBe(existing[0]);
  });
  it('mismo parecido medio pero OTRA cita o OTRO tipo: no se rechaza (preguntas distintas del mismo tema)', () => {
    const cand = '¿Qué representa la elasticidad precio de la demanda?';
    expect(findSimilar(Q(cand, 'multiple_choice', 'una cita distinta'), existing)).toBeNull();
    expect(findSimilar(Q(cand, 'true_false', 'mide cuanto responde la cantidad'), existing)).toBeNull();
  });
  it('preguntas distintas sobre el mismo tema y la misma cita pasan', () => {
    expect(findSimilar(Q('Si el precio sube un 10 % y la cantidad baja un 20 %, ¿la demanda es elástica o inelástica?', 'multiple_choice', 'mide cuanto responde la cantidad'), existing)).toBeNull();
  });
  it('los umbrales son inclusivos: exactamente 0,75 se rechaza siempre; exactamente 0,5 solo con mismo tipo y cita', () => {
    expect(jaccard('aaa bbb ccc', 'aaa bbb ccc ddd')).toBe(0.75);
    expect(findSimilar(Q('aaa bbb ccc ddd', 'true_false', 'q2'), [Q('aaa bbb ccc', 'multiple_choice', 'q1')])).not.toBeNull();
    expect(jaccard('aaa bbb', 'aaa bbb ccc ddd')).toBe(0.5);
    expect(findSimilar(Q('aaa bbb ccc ddd'), [Q('aaa bbb')])).not.toBeNull();
    expect(findSimilar(Q('aaa bbb ccc ddd', 'true_false'), [Q('aaa bbb')])).toBeNull();
  });
  it('sin existentes, nada', () => {
    expect(findSimilar(Q('cualquier cosa larga aqui'), [])).toBeNull();
  });
});

// ───────── simbolos sueltos
const MAT = '11111111-1111-4111-8111-111111111111';
const plan = (): Blueprint => ({ version: 1, outcomes: [{ id: 'o1', statement: 'x' }], periods: [{ id: 'p1', name: 'A', order: 1, weight: 100, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob1', title: 'T', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'M', order: 1 }] }] }] });
const TEXT = 'Decimos que la pendiente de la recta presupuestaria mide el costo de oportunidad de consumir el bien x.';
const chunks = (): ChunkIndex => new Map([[chunkKey(MAT, 0), { materialName: 'Guía', text: TEXT }]]);
const EXP = 'La pendiente de la recta presupuestaria mide el costo de oportunidad: cuánto del otro bien se renuncia por una unidad más.';
const check = (q: string, exp = EXP) => validateExamQuestion({ outcomeId: 'o1', nodeId: 'm1', type: 'fill_blank', q, answers: ['costo de oportunidad'], exp, source: { materialId: MAT, chunkIndex: 0, quote: 'la pendiente de la recta presupuestaria mide el costo de oportunidad de consumir el bien x' } }, { plan: plan(), chunks: chunks() });
const errs = (r: ReturnType<typeof check>) => (r.ok ? '' : r.errors.join(' | '));

describe('simbolos de formula sueltos', () => {
  it('el caso real: «recta presupuestaria, − , representa» se rechaza', () => {
    expect(errs(check('La pendiente de la recta presupuestaria, − , representa el ____ de consumir el bien x.'))).toContain('simbolo de formula suelto');
  });
  it('tambien en la explicacion y al inicio o al final de la frase', () => {
    expect(errs(check('La pendiente mide el ____ de consumir el bien x.', EXP + ' Es , = , la razon de precios.'))).toContain('simbolo de formula suelto');
    expect(STRAY_SYMBOL.test('− , la pendiente')).toBe(true);
    expect(STRAY_SYMBOL.test('la pendiente es la razon entre precios, −.')).toBe(true);
    expect(STRAY_SYMBOL.test('queda = − igual')).toBe(true);
  });
  it('un signo pegado a un numero o letra, una ecuacion completa o «(+, −)» NO se rechazan', () => {
    for (const t of ['La pendiente vale −2 en este caso.', 'Si x = 5 entonces y = 10.', 'El signo de la pendiente (+, −) importa.', 'La pendiente es -px/py, siempre.', 'Compara 3 - 2 con 5.', 'Un 10 % más, es decir +10 %, sube.'])
      expect(STRAY_SYMBOL.test(t), t).toBe(false);
  });
  it('una pregunta limpia pasa', () => {
    expect(check('La pendiente de la recta presupuestaria mide el ____ de consumir el bien x.').ok).toBe(true);
  });
});
