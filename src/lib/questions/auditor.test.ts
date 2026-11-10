import { describe, expect, it } from 'vitest';
import { blindText, buildBlindPrompt, combine, fullText, parseBlind, parseDefects, supportsBlindSolve, isAuditable } from './auditor';

const mc = { id: 'a', type: 'multiple_choice', q: '¿Cuál es la capital de Francia?', opts: ['Roma', 'París', 'Madrid'], ok: 1, exp: 'París es la capital.' };
const tf = { id: 'b', type: 'true_false', q: 'El agua hierve a 100 °C al nivel del mar.', ok: true, exp: 'Presión de 1 atm.' };

describe('resolucion ciega: no filtra la respuesta', () => {
  it('el texto ciego NO contiene la respuesta marcada, la explicacion ni palabras clave', () => {
    const t = blindText({ ...mc, keywords: ['secreto'] });
    expect(t).toContain('París');
    expect(t).not.toContain('Respuesta');
    expect(t).not.toContain('capital.');
    expect(t).not.toContain('secreto');
    expect(buildBlindPrompt([mc], 'mat')).not.toContain('Presión');
  });
  it('el texto completo SI lleva la respuesta y la explicacion', () => {
    expect(fullText(mc)).toContain('Respuesta marcada como correcta: 1');
    expect(fullText(mc)).toContain('París es la capital.');
  });
  it('solo opcion multiple y verdadero/falso se resuelven a ciegas; los minijuegos no se auditan', () => {
    expect(supportsBlindSolve(mc)).toBe(true);
    expect(supportsBlindSolve(tf)).toBe(true);
    expect(supportsBlindSolve({ type: 'fill_blank' })).toBe(false);
    expect(isAuditable({ type: 'cuarto_crisis' })).toBe(false);
  });
});

describe('parseBlind', () => {
  it('reconstruye en orden y exige el conteo exacto', () => {
    const r = parseBlind('{"answers":[{"index":2,"answer":true},{"index":1,"answer":1,"confident":false}]}', 2)!;
    expect(r[0]).toEqual({ answer: 1, confident: false });
    expect(r[1]).toEqual({ answer: true, confident: true });
    expect(parseBlind('{"answers":[{"index":1,"answer":1}]}', 2)).toBeNull();
    expect(parseBlind('basura', 1)).toBeNull();
  });
  it('una respuesta que no es numero ni booleano es null', () => {
    expect(parseBlind('{"answers":[{"index":1,"answer":"B"}]}', 1)![0].answer).toBeNull();
  });
});

describe('parseDefects: sin cita real no cuenta', () => {
  const resp = (defects: unknown[]) => JSON.stringify({ audits: [{ index: 1, defects }] });
  it('acepta un defecto con codigo valido, severidad valida y cita presente en la pregunta', () => {
    const r = parseDefects(resp([{ code: 'pista_accidental', severity: 'mayor', quote: 'Pregunta sobre Roma', why: 'x' }]), [mc].map((q) => ({ ...q, q: 'Pregunta sobre Roma y París' })))!;
    expect(r[0]).toHaveLength(1);
  });
  it('descarta citas inventadas, codigos desconocidos, severidades invalidas y citas demasiado cortas', () => {
    const r = parseDefects(
      resp([
        { code: 'pista_accidental', severity: 'mayor', quote: 'texto que no esta en la pregunta', why: '' },
        { code: 'inventado', severity: 'mayor', quote: 'capital de Francia', why: '' },
        { code: 'ambigua', severity: 'grave', quote: 'capital de Francia', why: '' },
        { code: 'ambigua', severity: 'mayor', quote: 'ab', why: '' },
      ]),
      [mc],
    )!;
    expect(r[0]).toEqual([]);
  });
  it('exige un objeto por pregunta', () => {
    expect(parseDefects('{"audits":[]}', [mc])).toBeNull();
  });
});

describe('combine', () => {
  it('discrepancia ciega => sospechosa; coincidencia sin defectos => no', () => {
    expect(combine(mc, { answer: 0, confident: true }, []).suspicious).toBe(true);
    expect(combine(mc, { answer: 1, confident: true }, []).suspicious).toBe(false);
    expect(combine(tf, { answer: false, confident: true }, []).blindMatches).toBe(false);
  });
  it('un defecto critico o mayor la vuelve sospechosa; uno menor no', () => {
    const d = (severity: 'critico' | 'mayor' | 'menor') => [{ code: 'trivial', severity, quote: 'x', why: '' }];
    expect(combine(mc, { answer: 1, confident: true }, d('critico')).suspicious).toBe(true);
    expect(combine(mc, { answer: 1, confident: true }, d('mayor')).suspicious).toBe(true);
    expect(combine(mc, { answer: 1, confident: true }, d('menor')).suspicious).toBe(false);
  });
  it('si el auditor no pudo auditar (todo null) NO cuenta ni a favor ni en contra', () => {
    const r = combine(mc, null, null);
    expect(r.audited).toBe(false);
    expect(r.suspicious).toBe(false);
  });
  it('que el auditor no logre resolverla (null) no es discrepancia', () => {
    expect(combine(mc, { answer: null, confident: false }, []).blindMatches).toBeNull();
    expect(combine(mc, { answer: null, confident: false }, []).suspicious).toBe(false);
  });
});
