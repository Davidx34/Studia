// Protocolo 7.1.2: isValidQuestion es la ultima linea de defensa antes de
// que una pregunta generada por LLM llegue al estudiante (generacion,
// cache, render — ver docs/AUDITORIA_TECNICA_STUDIA.md, hallazgo de
// "defensa en profundidad en 3 capas"). Cubre los 13 tipos reales, cada
// uno con un caso valido y al menos un caso invalido representativo del
// campo que mas frecuentemente viene incompleto en la generacion real.

import { describe, it, expect } from 'vitest';
import { isValidQuestion } from './validateQuestion';

describe('isValidQuestion', () => {
  it('rechaza entradas vacias o no-objeto', () => {
    expect(isValidQuestion(null).valid).toBe(false);
    expect(isValidQuestion(undefined).valid).toBe(false);
    expect(isValidQuestion('no soy un objeto').valid).toBe(false);
  });

  it('rechaza un tipo desconocido', () => {
    const result = isValidQuestion({ type: 'tipo_inventado' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('tipo_inventado');
  });

  describe('multiple_choice', () => {
    it('acepta una pregunta bien formada', () => {
      expect(
        isValidQuestion({ type: 'multiple_choice', q: '¿Cuál es la capital de Francia?', opts: ['Madrid', 'París', 'Roma'], ok: 1 }).valid
      ).toBe(true);
    });
    it('rechaza sin opts', () => {
      expect(isValidQuestion({ type: 'multiple_choice', q: 'pregunta', opts: [], ok: 0 }).valid).toBe(false);
    });
    it('rechaza con ok fuera de rango', () => {
      expect(isValidQuestion({ type: 'multiple_choice', q: 'pregunta', opts: ['a', 'b'], ok: 5 }).valid).toBe(false);
    });
    it('rechaza con ok no numerico', () => {
      expect(isValidQuestion({ type: 'multiple_choice', q: 'pregunta', opts: ['a', 'b'], ok: '1' }).valid).toBe(false);
    });
  });

  describe('true_false', () => {
    it('acepta con ok booleano', () => {
      expect(isValidQuestion({ type: 'true_false', q: 'La Tierra es redonda', ok: true }).valid).toBe(true);
    });
    it('rechaza con ok no booleano (ej: string "true")', () => {
      expect(isValidQuestion({ type: 'true_false', q: 'afirmacion', ok: 'true' }).valid).toBe(false);
    });
    it('rechaza sin texto de pregunta', () => {
      expect(isValidQuestion({ type: 'true_false', q: '', ok: true }).valid).toBe(false);
    });
  });

  describe('fill_blank', () => {
    it('acepta con answers no vacio', () => {
      expect(isValidQuestion({ type: 'fill_blank', q: 'El cielo es ___', answers: ['azul'] }).valid).toBe(true);
    });
    it('rechaza con answers vacio', () => {
      expect(isValidQuestion({ type: 'fill_blank', q: 'El cielo es ___', answers: [] }).valid).toBe(false);
    });
  });

  describe('match', () => {
    it('acepta con pairs no vacio', () => {
      expect(isValidQuestion({ type: 'match', q: 'Conecta', pairs: [{ term: 'a', def: 'b' }] }).valid).toBe(true);
    });
    it('rechaza con pairs vacio', () => {
      expect(isValidQuestion({ type: 'match', q: 'Conecta', pairs: [] }).valid).toBe(false);
    });
  });

  describe('short_answer', () => {
    it('acepta con keywords no vacio', () => {
      expect(isValidQuestion({ type: 'short_answer', q: '¿Qué es la fotosíntesis?', keywords: ['clorofila', 'luz'] }).valid).toBe(true);
    });
    it('rechaza sin keywords', () => {
      expect(isValidQuestion({ type: 'short_answer', q: 'pregunta', keywords: [] }).valid).toBe(false);
    });
  });

  describe('el_descifrador', () => {
    const validGameData = { word_to_guess: 'FOTOSINTESIS', initial_clue: 'proceso vegetal', hints: ['pista1', 'pista2', 'pista3'] };
    it('acepta con word_to_guess, initial_clue y 3+ hints', () => {
      expect(isValidQuestion({ type: 'el_descifrador', game_data: validGameData }).valid).toBe(true);
    });
    it('rechaza con menos de 3 hints', () => {
      expect(
        isValidQuestion({ type: 'el_descifrador', game_data: { ...validGameData, hints: ['solo una'] } }).valid
      ).toBe(false);
    });
    it('rechaza sin game_data', () => {
      expect(isValidQuestion({ type: 'el_descifrador' }).valid).toBe(false);
    });
  });

  describe('linea_del_tiempo', () => {
    it('acepta con items no vacio', () => {
      expect(
        isValidQuestion({ type: 'linea_del_tiempo', game_data: { items: [{ id: 1, text: 'evento', correct_position: 1 }] } }).valid
      ).toBe(true);
    });
    it('rechaza con items vacio', () => {
      expect(isValidQuestion({ type: 'linea_del_tiempo', game_data: { items: [] } }).valid).toBe(false);
    });
  });

  describe('categorias_rapidas', () => {
    const validGameData = { categories: ['A', 'B'], items: [{ id: 1, text: 'x', correct_category: 'A' }] };
    it('acepta con categories e items no vacios', () => {
      expect(isValidQuestion({ type: 'categorias_rapidas', game_data: validGameData }).valid).toBe(true);
    });
    it('rechaza sin categories', () => {
      expect(isValidQuestion({ type: 'categorias_rapidas', game_data: { ...validGameData, categories: [] } }).valid).toBe(false);
    });
    it('rechaza sin items', () => {
      expect(isValidQuestion({ type: 'categorias_rapidas', game_data: { ...validGameData, items: [] } }).valid).toBe(false);
    });
  });

  describe('flashcard_rapida', () => {
    it('acepta con pairs no vacio', () => {
      expect(
        isValidQuestion({ type: 'flashcard_rapida', game_data: { pairs: [{ id: 1, card1: 'a', card2: 'b' }] } }).valid
      ).toBe(true);
    });
    it('rechaza sin pairs', () => {
      expect(isValidQuestion({ type: 'flashcard_rapida', game_data: { pairs: [] } }).valid).toBe(false);
    });
  });

  describe('impostor_cognitivo', () => {
    it('acepta con exactamente 3 statements y al menos un impostor', () => {
      const gd = { statements: [{ text: 'a', is_impostor: false }, { text: 'b', is_impostor: false }, { text: 'c', is_impostor: true }] };
      expect(isValidQuestion({ type: 'impostor_cognitivo', game_data: gd }).valid).toBe(true);
    });
    it('rechaza con menos de 3 statements', () => {
      const gd = { statements: [{ text: 'a', is_impostor: true }] };
      expect(isValidQuestion({ type: 'impostor_cognitivo', game_data: gd }).valid).toBe(false);
    });
    it('rechaza si ningun statement esta marcado como impostor', () => {
      const gd = { statements: [{ is_impostor: false }, { is_impostor: false }, { is_impostor: false }] };
      expect(isValidQuestion({ type: 'impostor_cognitivo', game_data: gd }).valid).toBe(false);
    });
  });

  describe('alquimia_conceptual', () => {
    const validGameData = {
      element_a: 'a',
      element_b: 'b',
      alchemy_enigma: 'enigma',
      bridge_options: [{ id: 'X', is_correct: true }, { id: 'Y', is_correct: false }, { id: 'Z', is_correct: false }],
    };
    it('acepta con elementos, enigma y exactamente 3 bridge_options', () => {
      expect(isValidQuestion({ type: 'alquimia_conceptual', game_data: validGameData }).valid).toBe(true);
    });
    it('rechaza sin element_b', () => {
      expect(isValidQuestion({ type: 'alquimia_conceptual', game_data: { ...validGameData, element_b: undefined } }).valid).toBe(false);
    });
    it('rechaza con menos de 3 bridge_options', () => {
      expect(
        isValidQuestion({ type: 'alquimia_conceptual', game_data: { ...validGameData, bridge_options: [{ id: 'X', is_correct: true }] } }).valid
      ).toBe(false);
    });
  });

  describe('cuarto_crisis', () => {
    it('acepta con crisis_scenario e interventions no vacio', () => {
      const gd = { crisis_scenario: 'algo pasa', interventions: [{ action_code: 'ALPHA', is_solution: true }] };
      expect(isValidQuestion({ type: 'cuarto_crisis', game_data: gd }).valid).toBe(true);
    });
    it('rechaza sin crisis_scenario', () => {
      expect(isValidQuestion({ type: 'cuarto_crisis', game_data: { interventions: [{}] } }).valid).toBe(false);
    });
  });

  describe('juicio_conocimiento', () => {
    it('acepta con testimonio (2+) y guilty_paragraph_id definido', () => {
      const gd = { case_file: 'caso', expert_testimony: [{ paragraph_id: 1 }, { paragraph_id: 2 }], guilty_paragraph_id: 2 };
      expect(isValidQuestion({ type: 'juicio_conocimiento', game_data: gd }).valid).toBe(true);
    });
    it('rechaza con menos de 2 testimonios', () => {
      const gd = { case_file: 'caso', expert_testimony: [{ paragraph_id: 1 }], guilty_paragraph_id: 1 };
      expect(isValidQuestion({ type: 'juicio_conocimiento', game_data: gd }).valid).toBe(false);
    });
    it('rechaza sin guilty_paragraph_id (incluye el caso 0, que es falsy pero valido)', () => {
      const gdSinId = { case_file: 'caso', expert_testimony: [{ paragraph_id: 1 }, { paragraph_id: 2 }] };
      expect(isValidQuestion({ type: 'juicio_conocimiento', game_data: gdSinId }).valid).toBe(false);

      // guilty_paragraph_id=0 es un indice valido (parrafo 0), no "falta" —
      // la funcion compara explicitamente contra undefined/null, no truthy.
      const gdConIdCero = { case_file: 'caso', expert_testimony: [{ paragraph_id: 0 }, { paragraph_id: 1 }], guilty_paragraph_id: 0 };
      expect(isValidQuestion({ type: 'juicio_conocimiento', game_data: gdConIdCero }).valid).toBe(true);
    });
  });
});
