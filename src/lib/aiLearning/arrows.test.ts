import { describe, expect, it } from 'vitest';
import { CATEGORIES } from './errorTaxonomy';
import { GUARD_REASON_PREFIX, guardVerdict, guardedReason } from './judgeGuard';
import { sanitizeRules } from './playbook';
import { flagQuestions, MIN_ATTEMPTS } from './questionFlags';
import { MAX_PROPOSALS, MIN_TOTAL_REASONS, TEMPLATES, proposeRules, ruleFromSuggestion } from './ruleProposals';
import { getPrinciple } from './doctrine';

const many = (reason: string, n: number) => Array.from({ length: n }, () => reason);

describe('proposeRules (rechazos -> reglas)', () => {
  it('con pocos motivos NO propone nada y lo dice', () => {
    const r = proposeRules(many('La respuesta marcada es incorrecta.', MIN_TOTAL_REASONS - 1));
    expect(r.insufficient).toBe(true);
    expect(r.proposals).toEqual([]);
  });
  it('propone la plantilla de la categoria que mas se repite, con su evidencia', () => {
    const r = proposeRules([...many('La respuesta marcada es incorrecta: el cálculo da otro valor.', 20), ...many('No se menciona en el material fuente.', 10), ...many('Pregunta duplicada.', 1)]);
    expect(r.insufficient).toBe(false);
    expect(r.proposals.map((p) => p.category)).toEqual(['error_conceptual_o_calculo', 'anclaje_material']);
    expect(r.proposals[0].rule.text).toBe(TEMPLATES.error_conceptual_o_calculo!.text);
    expect(r.proposals[0].rule.evidence).toContain('20 de 31');
  });
  it('NO propone reglas para errores de infraestructura ni de pipeline (no se arreglan con estilo)', () => {
    const r = proposeRules([...many('No se pudo obtener una segunda opinion: un humano debe confirmar.', 25), ...many(null as unknown as string, 10)]);
    expect(r.proposals).toEqual([]);
  });
  it('respeta los umbrales: una categoria rara no se propone y las del validador de forma no cuentan', () => {
    const r = proposeRules([...many('La respuesta marcada es incorrecta.', 28), ...many('Pregunta duplicada.', 2), ...many('[validador de forma] La respuesta ya esta escrita en el enunciado.', 50)]);
    expect(r.total).toBe(30);
    expect(r.proposals.map((p) => p.category)).toEqual(['error_conceptual_o_calculo']);
  });
  it('no repite una regla que ya esta en el cuaderno y respeta el tope', () => {
    const base = many('La respuesta marcada es incorrecta.', 40);
    const ya = proposeRules(base, [{ text: TEMPLATES.error_conceptual_o_calculo!.text }]);
    expect(ya.proposals).toEqual([]);
    const todas = Object.entries({ error_conceptual_o_calculo: 'incorrecta', anclaje_material: 'No se menciona en el material', ambiguedad_respuesta_unica: 'respuesta única', no_autocontenida: 'Faltan datos', respuesta_no_evaluable: 'respuesta abierta', formato_minijuego: 'minijuego formato', redaccion_confusa: 'redacción confusa' }).flatMap(([, t]) => many(`${t}.`, 10));
    expect(proposeRules(todas).proposals.length).toBeLessThanOrEqual(MAX_PROPOSALS);
  });
  it('es determinista', () => {
    const a = [...many('La respuesta marcada es incorrecta.', 12), ...many('No se menciona en el material fuente.', 12), ...many('Pregunta duplicada.', 12)];
    expect(proposeRules(a)).toEqual(proposeRules([...a]));
  });
});

describe('plantillas curadas', () => {
  it('solo existen para categorias atribuibles al generador', () => {
    for (const cat of Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]) expect(CATEGORIES[cat].origin).toBe('generador');
  });
  it('cada plantilla es una regla valida de cuaderno (sanitizeRules no la altera) y sus principios existen', () => {
    for (const [cat, t] of Object.entries(TEMPLATES)) {
      expect(sanitizeRules([{ text: t!.text }])[0].text, cat).toBe(t!.text);
      for (const id of t!.principleIds) expect(getPrinciple(id), `${cat} -> ${id}`).toBeDefined();
    }
  });
});

describe('ruleFromSuggestion (retrospectiva aceptada -> regla)', () => {
  const s = (over = {}) => ({ kind: 'reinforce_concept', text: 'Agrega explicación o práctica sobre «elasticidad_precio» antes de evaluarlo.', evidence: 'Acierto 22 % en 80 intentos.', status: 'accepted', ...over });
  it('traduce reforzar un concepto aceptado en una regla con su evidencia', () => {
    const r = ruleFromSuggestion(s())!;
    expect(r.text).toContain('«elasticidad_precio»');
    expect(r.evidence).toBe('Acierto 22 % en 80 intentos.');
    expect(sanitizeRules([r])).toHaveLength(1);
  });
  it('solo si esta ACEPTADA y es de un tipo con traduccion segura', () => {
    for (const status of ['pending', 'rejected', 'postponed']) expect(ruleFromSuggestion(s({ status }))).toBeNull();
    for (const kind of ['review_question', 'review_pending', 'review_judge', 'collect_more_data', 'reinforce_module']) expect(ruleFromSuggestion(s({ kind }))).toBeNull();
    expect(ruleFromSuggestion(s({ text: 'Sin concepto entre comillas' }))).toBeNull();
  });
});

describe('guardVerdict (calibracion -> pipeline)', () => {
  it('con el juez degradado, lo aprobado pasa a revision humana', () => {
    expect(guardVerdict('pass', { status: 'degraded' })).toEqual({ verdict: 'review', guarded: true });
  });
  it('NUNCA toca fail ni review, y con trusted, insufficient o sin calibracion no hace nada', () => {
    for (const v of ['fail', 'review'] as const) expect(guardVerdict(v, { status: 'degraded' })).toEqual({ verdict: v, guarded: false });
    for (const st of ['trusted', 'insufficient'] as const) expect(guardVerdict('pass', { status: st })).toEqual({ verdict: 'pass', guarded: false });
    expect(guardVerdict('pass', null)).toEqual({ verdict: 'pass', guarded: false });
    expect(guardVerdict('pass', undefined)).toEqual({ verdict: 'pass', guarded: false });
  });
  it('la razon conserva el motivo del juez y lleva la marca del control', () => {
    const r = guardedReason('La clave es correcta.');
    expect(r.startsWith(GUARD_REASON_PREFIX)).toBe(true);
    expect(r).toContain('La clave es correcta.');
    expect(guardedReason(null)).toContain('(sin motivo)');
  });
});

describe('flagQuestions (estadisticas -> banderas)', () => {
  const row = (id: string, attempts: number, rate: number, students = 5) => ({ question_id: id, attempts, correct: Math.round(attempts * rate), correct_rate: rate, distinct_students: students });
  it('no concluye con menos del minimo de respuestas', () => {
    const r = flagQuestions([row('a', MIN_ATTEMPTS - 1, 0), row('b', 3, 1)]);
    expect(r.flags).toEqual([]);
    expect(r.belowMinimum).toBe(2);
  });
  it('senala las muy dificiles primero y las muy faciles despues, con su n', () => {
    const r = flagQuestions([row('facil', 30, 0.98), row('dura', 12, 0.1), row('normal', 40, 0.6), row('dura2', 50, 0.05)]);
    expect(r.flags.map((f) => f.questionId)).toEqual(['dura2', 'dura', 'facil']);
    expect(r.flags[0].reason).toContain('50 respuestas');
    expect(r.total).toBe(4);
  });
  it('acepta correct_rate como texto (numeric de Postgres)', () => {
    expect(flagQuestions([{ question_id: 'x', attempts: 20, correct: 1, correct_rate: '0.0500', distinct_students: 4 }]).flags).toHaveLength(1);
  });
  it('los limites exactos no se senalan (0,20 y 0,95)', () => {
    expect(flagQuestions([row('a', 20, 0.2), row('b', 20, 0.95)]).flags).toEqual([]);
  });
});
