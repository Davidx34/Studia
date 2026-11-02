import { describe, expect, it } from 'vitest';
import { answeredCount, buildPayload, isAnswered, restoreDraft, withAnswer, withMatch, type FormState } from './examForm';
import type { PresentedQuestion } from './examSession';

const MC: PresentedQuestion = { id: 'mc', type: 'multiple_choice', q: 'q', opts: ['uno', 'dos', 'tres'] };
const TF: PresentedQuestion = { id: 'tf', type: 'true_false', q: 'q' };
const FB: PresentedQuestion = { id: 'fb', type: 'fill_blank', q: 'q ____' };
const SA: PresentedQuestion = { id: 'sa', type: 'short_answer', q: 'q' };
const MT: PresentedQuestion = { id: 'mt', type: 'match', q: 'q', terms: ['T1', 'T2'], defs: ['D2', 'D1'] };
const ALL = [MC, TF, FB, SA, MT];

describe('isAnswered', () => {
  it('opcion multiple: una posicion valida (0 cuenta)', () => {
    expect(isAnswered(MC, { selectedIndex: 0 })).toBe(true);
    expect(isAnswered(MC, { selectedIndex: 2 })).toBe(true);
    for (const bad of [-1, 3, 1.5, NaN]) expect(isAnswered(MC, { selectedIndex: bad })).toBe(false);
    expect(isAnswered(MC, undefined)).toBe(false);
    expect(isAnswered(MC, { text: 'x' })).toBe(false);
  });
  it('verdadero/falso: false tambien es una respuesta', () => {
    expect(isAnswered(TF, { selected: false })).toBe(true);
    expect(isAnswered(TF, { selected: true })).toBe(true);
    expect(isAnswered(TF, { selectedIndex: 0 })).toBe(false);
    expect(isAnswered(TF, { selected: 'si' } as any)).toBe(false);
    expect(isAnswered(TF, { selected: 1 } as any)).toBe(false);
  });
  it('texto: el vacio o solo espacios no cuenta', () => {
    for (const q of [FB, SA]) {
      expect(isAnswered(q, { text: 'algo' })).toBe(true);
      expect(isAnswered(q, { text: '' })).toBe(false);
      expect(isAnswered(q, { text: '   \n ' })).toBe(false);
    }
  });
  it('emparejar: solo si TODOS los terminos tienen definicion', () => {
    expect(isAnswered(MT, { defs: ['D1', 'D2'] })).toBe(true);
    expect(isAnswered(MT, { defs: ['D1', null] })).toBe(false);
    expect(isAnswered(MT, { defs: ['D1'] })).toBe(false);
    expect(isAnswered(MT, { defs: ['', 'D2'] })).toBe(false);
  });
  it('un tipo desconocido nunca cuenta', () => {
    expect(isAnswered({ id: 'x', type: 'raro', q: 'q' }, { text: 'a' })).toBe(false);
  });
});

describe('answeredCount y buildPayload', () => {
  const state: FormState = { mc: { selectedIndex: 1 }, tf: { selected: false }, fb: { text: '  costo  ' }, sa: { text: '   ' }, mt: { defs: ['D1', null] }, ajena: { text: 'x' } };
  it('cuenta solo lo contestado de verdad', () => {
    expect(answeredCount(ALL, state)).toBe(3);
    expect(answeredCount(ALL, {})).toBe(0);
  });
  it('envia solo preguntas del examen, con el texto recortado y sin lo vacio', () => {
    const p = buildPayload(ALL, state);
    expect(Object.keys(p).sort()).toEqual(['fb', 'mc', 'mt', 'tf']);
    expect(p.fb).toEqual({ text: 'costo' });
    expect(p.mc).toEqual({ selectedIndex: 1 });
    expect(p.tf).toEqual({ selected: false });
    expect('ajena' in p).toBe(false);
    expect('sa' in p).toBe(false);
  });
  it('emparejar a medias SI se envia (lo conectado cuenta y el servidor lo califica)', () => {
    expect(buildPayload([MT], { mt: { defs: ['D1', null] } }).mt).toEqual({ defs: ['D1', null] });
  });
  it('una posicion invalida de opcion multiple no se envia', () => {
    expect(buildPayload([MC], { mc: { selectedIndex: 9 } })).toEqual({});
  });
});

describe('cambios de estado', () => {
  it('withAnswer no muta', () => {
    const s: FormState = { a: { text: 'x' } };
    const n = withAnswer(s, 'b', { selected: true });
    expect(s).toEqual({ a: { text: 'x' } });
    expect(n).toEqual({ a: { text: 'x' }, b: { selected: true } });
  });
  it('withMatch cambia UN termino y conserva los demas; vaciar deja null; fuera de rango no hace nada', () => {
    let s: FormState = withMatch({}, MT, 1, 'D1');
    expect(s.mt).toEqual({ defs: [null, 'D1'] });
    s = withMatch(s, MT, 0, 'D2');
    expect(s.mt).toEqual({ defs: ['D2', 'D1'] });
    s = withMatch(s, MT, 1, '');
    expect(s.mt).toEqual({ defs: ['D2', null] });
    // un estado con otra cantidad de definiciones se rehace con el tamano correcto
    expect(withMatch({ mt: { defs: ['D1'] } }, MT, 1, 'D2').mt).toEqual({ defs: [null, 'D2'] });
    expect(withMatch({ mt: { defs: ['D1', 'D2', 'D1'] } }, MT, 0, 'D2').mt).toEqual({ defs: ['D2', null] });
    const before = s;
    expect(withMatch(s, MT, 5, 'D1')).toBe(before);
    expect(withMatch(s, MT, -1, 'D1')).toBe(before);
  });
});

describe('restoreDraft: un borrador alterado no se cuela', () => {
  it('acepta respuestas con la forma de su pregunta', () => {
    const raw = { mc: { selectedIndex: 2 }, tf: { selected: true }, fb: { text: 'a' }, sa: { text: 'b' }, mt: { defs: ['D1', null] } };
    expect(restoreDraft(raw, ALL)).toEqual(raw);
  });
  it('descarta lo que no encaja: indices fuera de rango, tipos cambiados, definiciones que no existen, ids ajenos', () => {
    const raw = { mc: { selectedIndex: 7 }, tf: { selected: 'si' }, fb: { selectedIndex: 1 }, sa: 5, mt: { defs: ['inventada', null] }, otra: { text: 'x' } };
    expect(restoreDraft(raw, ALL)).toEqual({});
  });
  it('recorta textos enormes y tolera basura', () => {
    expect((restoreDraft({ fb: { text: 'x'.repeat(5000) } }, ALL).fb as any).text.length).toBe(2000);
    for (const bad of [null, undefined, 5, 'x', [], [1]]) expect(restoreDraft(bad, ALL)).toEqual({});
  });
  it('no hereda de Object.prototype', () => {
    expect(restoreDraft({}, [{ id: 'constructor', type: 'true_false', q: 'q' }])).toEqual({});
  });
});
