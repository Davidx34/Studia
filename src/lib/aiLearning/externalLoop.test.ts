import { describe, expect, it } from 'vitest';
import { bankStatusFor, categoryCounts, goalCheck, judgeVsExternal, sampleSizeForLower, summarizeRound, validateExternal, validateRevision, type Lot, type Revision } from './externalLoop';

const mc = (q: string, opts: string[], ok: number) => ({ type: 'multiple_choice', q, opts, ok, exp: 'Explicacion de la pregunta', concept_tag: 'tema' });
const lot: Lot = {
  id: 'L1',
  fecha: '2026-11-11',
  generador: 'gemini',
  arm: 'base',
  items: [
    { id: 'a', module_id: 'm', module_title: 'M', question: mc('¿Cuál es la capital de Francia?', ['Roma', 'París', 'Madrid', 'Berlín'], 1) },
    { id: 'b', module_id: 'm', module_title: 'M', question: mc('¿Cuánto es 2 + 2 según el texto?', ['3', '4', '5', '6'], 0) },
    { id: 'c', module_id: 'm', module_title: 'M', question: mc('Pregunta ambigua sobre economía básica', ['uno', 'dos', 'tres', 'cuatro'], 0) },
  ],
};
const def = (code: string, severity: string, quote: string) => ({ code, severity, quote, why: 'x' }) as any;
const good = (id: string) => ({ id, veredicto: 'bueno', defectos: [] }) as any;
const rev = (items: any[]): Revision => ({ revisor: 'claude', fecha: '2026-11-11', lote: 'L1', items });

describe('validateRevision (una revision estricta o no vale)', () => {
  const corregida = mc('¿Cuánto es 2 + 2?', ['3', '4', '5', '6'], 1);
  const ok = rev([good('a'), { id: 'b', veredicto: 'corregir', defectos: [def('respuesta_incorrecta', 'critico', '¿Cuánto es 2 + 2 según el texto?')], corregida }, { id: 'c', veredicto: 'malo', defectos: [def('ambigua', 'mayor', 'Pregunta ambigua sobre economía básica')] }]);
  it('una revision completa y bien citada es valida', () => {
    expect(validateRevision(lot, ok)).toEqual([]);
  });
  it('exige revisar todas, una sola vez, y que existan en el lote', () => {
    expect(validateRevision(lot, rev([good('a'), good('a'), good('zz')]))).toEqual(expect.arrayContaining([expect.stringContaining('revisada dos veces'), expect.stringContaining('no existe en el lote'), expect.stringContaining('b: falta su revision'), expect.stringContaining('c: falta su revision')]));
  });
  it('un defecto necesita codigo conocido, severidad valida y una CITA que exista en la pregunta', () => {
    const e = validateRevision(lot, rev([good('a'), { id: 'b', veredicto: 'malo', defectos: [def('inventado', 'grave', 'texto que no esta')] }, good('c')]));
    expect(e.join('|')).toContain('codigo de defecto desconocido');
    expect(e.join('|')).toContain('severidad invalida');
    expect(e.join('|')).toContain('no aparece en la pregunta');
  });
  it('«bueno» no puede traer defectos serios; «corregir/malo» deben traer al menos uno', () => {
    const e = validateRevision(lot, rev([{ id: 'a', veredicto: 'bueno', defectos: [def('ambigua', 'mayor', 'capital de Francia')] }, { id: 'b', veredicto: 'malo', defectos: [] }, good('c')]));
    expect(e.join('|')).toContain('a: marcada «bueno» pero tiene defectos criticos o mayores');
    expect(e.join('|')).toContain('b: «malo» exige al menos un defecto');
  });
  it('la correccion debe existir, pasar el validador de forma, conservar el tipo y ser distinta', () => {
    const d = [def('ambigua', 'mayor', 'Pregunta ambigua sobre economía básica')];
    const sin = validateRevision(lot, rev([good('a'), good('b'), { id: 'c', veredicto: 'corregir', defectos: d }]));
    expect(sin.join('|')).toContain('exige la version corregida');
    const igual = validateRevision(lot, rev([good('a'), good('b'), { id: 'c', veredicto: 'corregir', defectos: d, corregida: lot.items[2].question }]));
    expect(igual.join('|')).toContain('identica a la original');
    const mala = validateRevision(lot, rev([good('a'), good('b'), { id: 'c', veredicto: 'corregir', defectos: d, corregida: { type: 'multiple_choice', q: 'x', opts: ['a'], ok: 9 } }]));
    expect(mala.join('|')).toContain('no pasa el validador de forma');
    const tipo = validateRevision(lot, rev([good('a'), good('b'), { id: 'c', veredicto: 'corregir', defectos: d, corregida: { type: 'true_false', q: 'Una afirmacion suficientemente larga', ok: true, exp: 'Explicacion de la respuesta' } }]));
    expect(tipo.join('|')).toContain('cambia el tipo');
  });
  it('la revision de otro lote se rechaza', () => {
    expect(validateRevision(lot, { ...ok, lote: 'OTRO' }).join('|')).toContain('es del lote');
  });
});

describe('summarizeRound: tasa cruda vs entregable, con IC 95 %', () => {
  const r = rev([good('a'), { id: 'b', veredicto: 'corregir', defectos: [def('calculo_erroneo', 'critico', 'x')] }, { id: 'c', veredicto: 'malo', defectos: [def('ambigua', 'menor', 'x'), def('dato_faltante', 'mayor', 'x')] }]);
  it('cuenta veredictos y las dos tasas por separado', () => {
    const s = summarizeRound(r);
    expect(s.veredictos).toEqual({ bueno: 1, corregir: 1, malo: 1 });
    expect(s.cruda.rate).toBeCloseTo(1 / 3);
    expect(s.entregable.rate).toBeCloseTo(2 / 3);
    expect(s.cruda.ci!.low).toBeLessThan(s.cruda.rate!);
    expect(s.defectosPorCodigo).toEqual({ calculo_erroneo: 1, ambigua: 1, dato_faltante: 1 });
    expect(s.defectosSeriosPorCodigo).toEqual({ calculo_erroneo: 1, dato_faltante: 1 });
  });
  it('las categorias salen solo de defectos SERIOS y se agrupan en la taxonomia de errores', () => {
    expect(categoryCounts(summarizeRound(r))).toEqual({ error_conceptual_o_calculo: 1, no_autocontenida: 1 });
  });
});

describe('meta ≈ 90 % con IC 95 %', () => {
  it('«cumple» solo si el limite inferior llega a la meta; «probable» si la tasa llega pero el intervalo no; «no_alcanzada» si no', () => {
    expect(goalCheck(300, 300).status).toBe('cumple');
    expect(goalCheck(36, 40).status).toBe('probable'); // 90 %: el limite inferior queda en ~77 %
    expect(goalCheck(32, 40).status).toBe('no_alcanzada'); // 80 %
    expect(goalCheck(0, 0).status).toBe('sin_datos');
  });
  it('calcula cuantas preguntas hacen falta para que el IC confirme la meta con la tasa observada', () => {
    const n = sampleSizeForLower(0.96, 0.9)!;
    expect(n).toBeGreaterThan(40);
    expect(sampleSizeForLower(0.9, 0.9)).toBeNull();
    expect(goalCheck(48, 50).neededN).not.toBeNull();
  });
});

describe('calibracion del juez contra el revisor externo', () => {
  it('cuenta falsos aprobados, falsas alarmas y la precision de lo que el juez aprueba', () => {
    const r = judgeVsExternal([
      { judge: 'pass', ext: 'bueno' },
      { judge: 'pass', ext: 'bueno' },
      { judge: 'pass', ext: 'corregir' },
      { judge: 'pass', ext: 'malo' },
      { judge: 'fail', ext: 'bueno' },
      { judge: 'review', ext: 'malo' },
    ]);
    expect(r).toMatchObject({ pairs: 6, falsePass: 2, judgePass: 4, falseAlarm: 1 });
    expect(r.passPrecision.rate).toBeCloseTo(0.5);
  });
});

describe('compuerta de validacion del revisor externo frente al profesor', () => {
  const mk = (agree: number, falsePass: number) => [...Array(agree).fill({ ext: 'bueno', teacher: 'approved' }), ...Array(falsePass).fill({ ext: 'bueno', teacher: 'rejected' })];
  it('sin 20 comparaciones: sin_datos; con 20 y acuerdo perfecto: validado; con errores: no_validado', () => {
    expect(validateExternal(mk(10, 0)).status).toBe('sin_datos');
    expect(validateExternal(mk(40, 0)).status).toBe('validado');
    expect(validateExternal(mk(30, 5)).status).toBe('no_validado');
  });
  it('un revisor no validado NO publica: sus aprobadas entran en revision humana', () => {
    expect(bankStatusFor('validado')).toBe('approved');
    expect(bankStatusFor('no_validado')).toBe('human_review');
    expect(bankStatusFor('sin_datos')).toBe('human_review');
  });
  it('cuenta falsos aprobados y falsos rechazos', () => {
    const v = validateExternal([...mk(20, 2), { ext: 'malo', teacher: 'approved' } as any]);
    expect(v.falsePass).toBe(2);
    expect(v.falseReject).toBe(1);
  });
});

import { RULE_SETS } from './experimentRules';
import { RUBRIC_SUBJECT, RUBRIC_V2_EXTRA, rubricFor } from '@/lib/questions/judge';
import { fullText, isAuditable } from '@/lib/questions/auditor';
import { MAX_RULE_CHARS, MAX_RULES } from './playbook';

describe('lo aprendido en la ronda (v2) es medible y no cambia nada por defecto', () => {
  it('item_writing_v2 respeta los limites del cuaderno y cada regla cita su evidencia', () => {
    const v2 = RULE_SETS.item_writing_v2;
    expect(v2.length).toBeGreaterThan(0);
    expect(v2.length).toBeLessThanOrEqual(MAX_RULES);
    for (const r of v2) {
      expect(r.text.length).toBeLessThanOrEqual(MAX_RULE_CHARS);
      expect(r.basis).toContain('Evidencia propia');
    }
  });
  it('la rubrica del juez es IDENTICA por defecto; con JUDGE_RUBRIC=v2 se AGREGAN comprobaciones sin quitar ninguna', () => {
    expect(rubricFor('subject', {})).toBe(RUBRIC_SUBJECT);
    expect(rubricFor('subject', { JUDGE_RUBRIC: 'v1' })).toBe(RUBRIC_SUBJECT);
    const v2 = rubricFor('subject', { JUDGE_RUBRIC: 'v2' });
    expect(v2.startsWith(RUBRIC_SUBJECT)).toBe(true);
    expect(v2).toContain(RUBRIC_V2_EXTRA);
  });
  it('el auditor ahora ve los pares de «match» (antes eran invisibles)', () => {
    const q = { type: 'match', q: 'Conecta', pairs: [{ term: 'Nilo', def: 'Río de Egipto' }] };
    expect(isAuditable(q)).toBe(true);
    expect(fullText(q)).toContain('Río de Egipto');
  });
});
