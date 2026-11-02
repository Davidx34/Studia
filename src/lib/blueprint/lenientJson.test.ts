import { describe, expect, it } from 'vitest';
import { extractLooseJsonObject, repairLooseJson } from './lenientJson';
import { validateExamQuestion, FILL_ANSWER_LIMITS, chunkKey, type ChunkIndex } from './examQuestion';
import type { Blueprint } from './types';

describe('repairLooseJson', () => {
  it('convierte True / False / None (estilo Python) en true / false / null', () => {
    expect(repairLooseJson('{"a": True, "b": False, "c": None}')).toBe('{"a": true, "b": false, "c": null}');
    expect(JSON.parse(repairLooseJson('[True,False,None]'))).toEqual([true, false, null]);
  });
  it('quita comas colgando antes de } o ]', () => {
    expect(JSON.parse(repairLooseJson('{"a": [1, 2, ], "b": 3, }'))).toEqual({ a: [1, 2], b: 3 });
    expect(JSON.parse(repairLooseJson('{"a": 1,\n  }'))).toEqual({ a: 1 });
  });
  it('NO toca lo que esta dentro de cadenas de texto', () => {
    const t = '{"q": "Si es True o False, o None, o [1, 2, ] y { , } entonces", "ok": True}';
    const r = JSON.parse(repairLooseJson(t));
    expect(r.q).toBe('Si es True o False, o None, o [1, 2, ] y { , } entonces');
    expect(r.ok).toBe(true);
  });
  it('respeta comillas escapadas dentro de las cadenas (no se sale de la cadena antes de tiempo)', () => {
    const t = '{"q": "Dijo \\"True\\" y luego , } y \\\\", "ok": False}';
    const r = JSON.parse(repairLooseJson(t));
    expect(r.q).toBe('Dijo "True" y luego , } y \\');
    expect(r.ok).toBe(false);
  });
  it('solo reemplaza palabras COMPLETAS (Trueno, Falsedad, Nonexistent, isTrue no cambian)', () => {
    expect(repairLooseJson('{"a": Trueno}')).toBe('{"a": Trueno}');
    expect(repairLooseJson('{"a": Falsedad, "b": Nonexistent, "c": isTrue, "d": True2}')).toBe('{"a": Falsedad, "b": Nonexistent, "c": isTrue, "d": True2}');
  });
  it('un JSON ya valido queda IGUAL', () => {
    const ok = '{"a": true, "b": [1, 2, 3], "c": {"d": null}, "e": "x, y"}';
    expect(repairLooseJson(ok)).toBe(ok);
  });
  it('no inventa: lo que no es JSON sigue sin serlo', () => {
    expect(() => JSON.parse(repairLooseJson('{"a": }'))).toThrow();
    expect(() => JSON.parse(repairLooseJson('{a: 1}'))).toThrow();
  });
  it('un texto vacio o sin llaves no rompe', () => {
    expect(repairLooseJson('')).toBe('');
    expect(repairLooseJson('hola')).toBe('hola');
  });
});

describe('extractLooseJsonObject', () => {
  it('lee la respuesta real que perdia el modelo: bloque ```json con "ok": False', () => {
    const t = '```json\n{\n"questions": [\n{\n"type": "true_false",\n"q": "¿Es cierto?",\n"ok": False,\n"exp": "x"\n}\n]\n}\n```';
    expect(extractLooseJsonObject(t)).toMatchObject({ questions: [{ ok: false }] });
  });
  it('un JSON valido se lee igual que antes', () => {
    expect(extractLooseJsonObject('texto {"a": 1} fin')).toEqual({ a: 1 });
  });
  it('sin objeto: null', () => {
    expect(extractLooseJsonObject('no hay nada')).toBeNull();
    expect(extractLooseJsonObject('{"a": }')).toBeNull();
  });
});

// ───────── reglas de las preguntas de completar (medidas con material real)
const MAT = '11111111-1111-4111-8111-111111111111';
const plan = (): Blueprint => ({ version: 1, outcomes: [{ id: 'o1', statement: 'x' }], periods: [{ id: 'p1', name: 'A', order: 1, weight: 100, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob1', title: 'T', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'M', order: 1 }] }] }] });
const TEXT = 'La elasticidad precio de la demanda mide cuánto cambia la cantidad demandada cuando cambia el precio. Si es mayor que uno, la demanda es elástica.';
const chunks = (): ChunkIndex => new Map([[chunkKey(MAT, 0), { materialName: 'Guía', text: TEXT }]]);
const fill = (q: string, answers: unknown) => validateExamQuestion({
  outcomeId: 'o1', nodeId: 'm1', type: 'fill_blank', q, answers,
  exp: 'Cuando la elasticidad es mayor que uno, la demanda es elástica porque los consumidores reaccionan mucho al precio.',
  source: { materialId: MAT, chunkIndex: 0, quote: 'mide cuánto cambia la cantidad demandada cuando cambia el precio' },
}, { plan: plan(), chunks: chunks() });
const errs = (r: ReturnType<typeof fill>) => (r.ok ? '' : r.errors.join(' | '));

describe('preguntas de completar: respuestas cortas y sin pista', () => {
  it('una respuesta corta se acepta', () => {
    expect(fill('Si la elasticidad es mayor que uno, la demanda es ____.', ['elástica']).ok).toBe(true);
    expect(fill('La elasticidad se calcula dividiendo el cambio ____ de la cantidad entre el del precio.', ['porcentual']).ok).toBe(true);
  });
  it('una respuesta de hasta 5 palabras se acepta; de 6 o mas, no', () => {
    expect(FILL_ANSWER_LIMITS).toEqual({ words: 5, chars: 40 });
    expect(fill('Se calcula como ____ entre dos cambios.', ['razón entre dos cambios porcentuales']).ok).toBe(true);
    expect(errs(fill('Se calcula como ____ entre dos cambios.', ['el porcentaje de cambio en la cantidad demandada dividido por el cambio']))).toContain('demasiado larga');
  });
  it('una respuesta de mas de 40 caracteres, aunque tenga pocas palabras, no se acepta', () => {
    expect(errs(fill('Se llama ____ a eso.', ['desproporcionadamente-largaaaaaaaaaaaaaaaaaaaaaa']))).toContain('demasiado larga');
  });
  it('si UNA de varias respuestas aceptadas es larga, se rechaza', () => {
    expect(errs(fill('Es ____.', ['elástica', 'una frase mucho mas larga de lo que se puede pedir aqui']))).toContain('demasiado larga');
  });
  it('la regla solo aplica a completar (una palabra clave larga en respuesta corta no se toca aqui)', () => {
    const r = validateExamQuestion({ outcomeId: 'o1', nodeId: 'm1', type: 'short_answer', q: '¿Cuándo es elástica la demanda?', keywords: ['cuando la elasticidad precio de la demanda es mayor que uno'], exp: 'Cuando la elasticidad es mayor que uno, la demanda es elástica porque los consumidores reaccionan mucho.', source: { materialId: MAT, chunkIndex: 0, quote: 'mide cuánto cambia la cantidad demandada cuando cambia el precio' } }, { plan: plan(), chunks: chunks() });
    expect(errs(r)).not.toContain('demasiado larga');
  });
  it('la pregunta que YA CONTIENE la respuesta se rechaza (aunque cambien mayusculas, tildes o signos)', () => {
    expect(errs(fill('La demanda es elástica, ____, cuando la elasticidad supera uno.', ['elástica']))).toContain('ya contiene la respuesta');
    expect(errs(fill('LA ELASTICIDAD PRECIO, ____, mide el cambio.', ['Elasticidad']))).toContain('ya contiene la respuesta');
  });
  it('una respuesta que solo es parte de otra palabra del enunciado NO cuenta como pista', () => {
    expect(fill('Si la elasticidad es mayor que uno, la demanda es ____.', ['elástica']).ok).toBe(true);
    expect(fill('La elasticidad ____ se usa para comparar bienes.', ['cruzada']).ok).toBe(true);
    expect(fill('Los bienes elásticos tienen demanda ____ al precio.', ['elástica']).ok).toBe(true); // "elasticos" != "elastica"
  });
  it('respuestas muy cortas (menos de 4 letras) no se consideran pista (un "no" o "si" suelto)', () => {
    expect(fill('¿Es cierto que si el precio sube la cantidad baja? Respuesta: ____.', ['si']).ok).toBe(true);
  });
});
