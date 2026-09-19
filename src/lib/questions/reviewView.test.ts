import { describe, it, expect } from 'vitest';
import { buildAnswerView } from './reviewView';

// Formas tomadas de filas reales de lesson_questions en produccion.
describe('buildAnswerView', () => {
  describe('multiple_choice', () => {
    it('marca como correcta la opcion cuyo indice es ok', () => {
      const v = buildAnswerView({
        type: 'multiple_choice',
        opts: ['A. Bien Normal', 'B. Bien Inferior', 'C. Bien de Lujo', 'D. Bien Giffen'],
        ok: 2,
      });
      expect(v.kind).toBe('options');
      if (v.kind !== 'options') return;
      expect(v.hasCorrect).toBe(true);
      expect(v.options.map((o) => o.correct)).toEqual([false, false, true, false]);
    });

    it('ok = 0 es una respuesta valida (la primera opcion), no "sin respuesta"', () => {
      const v = buildAnswerView({ type: 'multiple_choice', opts: ['A. uno', 'B. dos'], ok: 0 });
      expect(v.kind === 'options' && v.hasCorrect && v.options[0].correct).toBe(true);
    });

    it('sin ok valido muestra las opciones pero avisa que ninguna esta marcada', () => {
      for (const ok of [undefined, null, -1, 7, 1.5, '1', true]) {
        const v = buildAnswerView({ type: 'multiple_choice', opts: ['A', 'B'], ok });
        expect(v.kind).toBe('options');
        expect(v.kind === 'options' && v.hasCorrect).toBe(false);
      }
    });

    it('sin opciones es "missing"', () => {
      expect(buildAnswerView({ type: 'multiple_choice', opts: [], ok: 0 })).toEqual({ kind: 'missing' });
      expect(buildAnswerView({ type: 'multiple_choice', opts: null, ok: 0 })).toEqual({ kind: 'missing' });
    });
  });

  describe('true_false', () => {
    it('distingue verdadero de falso; false NO es "sin dato"', () => {
      expect(buildAnswerView({ type: 'true_false', ok: true })).toEqual({ kind: 'true_false', value: true });
      expect(buildAnswerView({ type: 'true_false', ok: false })).toEqual({ kind: 'true_false', value: false });
    });

    it('sin booleano es "missing"', () => {
      expect(buildAnswerView({ type: 'true_false', ok: null })).toEqual({ kind: 'missing' });
      expect(buildAnswerView({ type: 'true_false', ok: 'true' })).toEqual({ kind: 'missing' });
    });
  });

  describe('match', () => {
    it('devuelve los pares term/def', () => {
      const v = buildAnswerView({
        type: 'match',
        pairs: [
          { def: 'Los bienes se consumen juntos.', term: 'Bien Complementario' },
          { def: 'Se pueden reemplazar entre si.', term: 'Bien Sustituto' },
        ],
      });
      expect(v).toEqual({
        kind: 'pairs',
        pairs: [
          { term: 'Bien Complementario', def: 'Los bienes se consumen juntos.' },
          { term: 'Bien Sustituto', def: 'Se pueden reemplazar entre si.' },
        ],
      });
    });

    it('descarta pares mal formados sin perder los buenos', () => {
      const v = buildAnswerView({ type: 'match', pairs: [{ term: 'a', def: 'b' }, { term: 'solo term' }, null, 'x'] });
      expect(v).toEqual({ kind: 'pairs', pairs: [{ term: 'a', def: 'b' }] });
    });

    it('sin pares utilizables es "missing"', () => {
      expect(buildAnswerView({ type: 'match', pairs: [] })).toEqual({ kind: 'missing' });
      expect(buildAnswerView({ type: 'match', pairs: null })).toEqual({ kind: 'missing' });
      expect(buildAnswerView({ type: 'match', pairs: 'no soy un array' })).toEqual({ kind: 'missing' });
    });
  });

  describe('short_answer y fill_blank', () => {
    it('short_answer devuelve las palabras clave esperadas', () => {
      const v = buildAnswerView({ type: 'short_answer', keywords: ['bien Giffen', 'elasticidad precio', 'demanda'] });
      expect(v).toEqual({ kind: 'keywords', keywords: ['bien Giffen', 'elasticidad precio', 'demanda'] });
    });

    it('fill_blank devuelve las respuestas aceptadas', () => {
      expect(buildAnswerView({ type: 'fill_blank', answers: ['elástica'] })).toEqual({ kind: 'blank', answers: ['elástica'] });
    });

    it('ignora cadenas vacias y valores que no son texto', () => {
      const v = buildAnswerView({ type: 'short_answer', keywords: ['util', '  ', 3, null] });
      expect(v).toEqual({ kind: 'keywords', keywords: ['util'] });
    });

    it('vacio o ausente es "missing"', () => {
      expect(buildAnswerView({ type: 'short_answer', keywords: [] })).toEqual({ kind: 'missing' });
      expect(buildAnswerView({ type: 'fill_blank' })).toEqual({ kind: 'missing' });
    });
  });

  it('un minijuego o un tipo desconocido no tiene "respuesta" aqui (su contenido va en game_data)', () => {
    expect(buildAnswerView({ type: 'cuarto_crisis' })).toEqual({ kind: 'none' });
    expect(buildAnswerView({ type: 'inventado' })).toEqual({ kind: 'none' });
  });
});
