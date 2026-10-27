import { describe, it, expect } from 'vitest';
import { describeQuestion, repairFeedbackBlock } from './repair';

describe('describeQuestion', () => {
  it('incluye el tipo y el enunciado', () => {
    expect(describeQuestion({ type: 'multiple_choice', q: 'Cual es la derivada de x^2?' })).toBe('[multiple_choice] Cual es la derivada de x^2?');
  });

  it('agrega lo esencial del contenido: opciones, pares, respuestas o datos del minijuego', () => {
    expect(describeQuestion({ type: 'multiple_choice', q: 'P', opts: ['A', 'B'] })).toContain('["A","B"]');
    expect(describeQuestion({ type: 'match', q: 'P', pairs: [{ term: 'x', def: 'y' }] })).toContain('"term":"x"');
    expect(describeQuestion({ type: 'fill_blank', q: 'P', answers: ['costo marginal'] })).toContain('costo marginal');
    expect(describeQuestion({ type: 'impostor_cognitivo', q: 'P', game_data: { context: 'ctx' } })).toContain('"context":"ctx"');
  });

  it('recorta lo largo y colapsa espacios (el prompt no se infla)', () => {
    const d = describeQuestion({ type: 't', q: 'a   b\n\nc'.repeat(100) });
    expect(d).not.toMatch(/\s{2,}/);
    expect(d.length).toBeLessThan(200);
    expect(describeQuestion({ type: 't', q: 'P', game_data: { x: 'y'.repeat(1000) } }).length).toBeLessThan(260);
  });

  it('tolera campos ausentes', () => {
    expect(describeQuestion({})).toBe('[?] ');
  });
});

describe('repairFeedbackBlock', () => {
  const r = (n: number) => ({ q: { type: 'match', q: `pregunta ${n}` }, reason: `motivo ${n}` });

  it('lista cada pregunta rechazada con su motivo', () => {
    const b = repairFeedbackBlock([r(1), r(2)]);
    expect(b).toContain('1. [match] pregunta 1');
    expect(b).toContain('MOTIVO: motivo 1');
    expect(b).toContain('2. [match] pregunta 2');
  });

  it('pide verificar cada dato, no repetir y no depender de recursos que el estudiante no tiene', () => {
    const b = repairFeedbackBlock([r(1)]);
    expect(b).toMatch(/verifica TU MISMO/);
    expect(b).toMatch(/NO las repitas/);
    expect(b).toMatch(/video, una imagen/);
    expect(b).toMatch(/preguntas NUEVAS/);
  });

  it('muestra como maximo 8 ejemplos', () => {
    const b = repairFeedbackBlock(Array.from({ length: 20 }, (_, i) => r(i + 1)));
    expect(b).toContain('8. [match] pregunta 8');
    expect(b).not.toContain('9. [match]');
  });

  it('recorta motivos muy largos', () => {
    const b = repairFeedbackBlock([{ q: { type: 't', q: 'P' }, reason: 'x'.repeat(1000) }]);
    expect(b.match(/x+/)![0].length).toBeLessThanOrEqual(220);
  });
});
