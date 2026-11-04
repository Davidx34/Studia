import { describe, expect, it } from 'vitest';
import { isValidQuestion } from './validateQuestion';
import { sanitizeQuestion } from '@/lib/grading/serverGrading';
import { SERVER_GRADED_GAME_TYPES } from '@/lib/grading/gameGrading';

// Lo que lleva cada minijuego en la base (game_data), con lo MINIMO valido para mostrarse.
const GAME_DATA: Record<string, Record<string, unknown>> = {
  el_descifrador: { word_to_guess: 'CONJUNTO', initial_clue: 'Concepto que agrupa posibilidades.', hints: ['uno', 'dos', 'tres'], pedagogical_feedback: 'f' },
  linea_del_tiempo: { theme: 'Roma', items: [{ id: 1, text: 'Fundacion', year: '753 a. C.', order: 1 }, { id: 2, text: 'Imperio', year: '27 a. C.', order: 2 }] },
  categorias_rapidas: { theme: 'Bienes', categories: ['Normales', 'Inferiores'], items: [{ id: 1, text: 'Pan', category: 'Normales' }, { id: 2, text: 'Pasta barata', category: 'Inferiores' }] },
  flashcard_rapida: { pairs: [{ id: 1, card1: 'Derecho romano', card2: 'Base de los sistemas legales.' }, { id: 2, card1: 'Filosofia griega', card2: 'Fundo el pensamiento occidental.' }], pedagogical_feedback: 'f' }, // forma REAL de la base
  impostor_cognitivo: { context: 'c', statements: [{ id: 1, text: 'a', is_impostor: false }, { id: 2, text: 'b', is_impostor: true }, { id: 3, text: 'c', is_impostor: false }] },
  alquimia_conceptual: { fusion_title: 't', element_a: 'A', element_b: 'B', alchemy_enigma: 'e', bridge_options: [{ id: 'x', text: '1', is_correct: true }, { id: 'y', text: '2' }, { id: 'z', text: '3' }] },
  cuarto_crisis: { crisis_scenario: 'Falla', telemetry_data: ['t1'], interventions: [{ action_code: 'A', description: 'd', is_correct: true }, { action_code: 'B', description: 'e' }] },
  juicio_conocimiento: { case_file: 'caso', cross_examination_tip: 'tip', expert_testimony: [{ paragraph_id: 1, text: 'p1' }, { paragraph_id: 2, text: 'p2' }], guilty_paragraph_id: 2 },
};

const question = (type: string, game_data: Record<string, unknown>) => ({ id: `q-${type}`, type, q: 'Enunciado', game_data });
const served = (type: string, game_data: Record<string, unknown>) => sanitizeQuestion(question(type, game_data), () => 0.5, { games: true });

describe('minijuegos servidos SIN la solucion: el navegador los acepta', () => {
  it('hay un caso para cada uno de los 8 juegos del servidor', () => {
    expect(Object.keys(GAME_DATA).sort()).toEqual([...SERVER_GRADED_GAME_TYPES].sort());
  });
  for (const type of SERVER_GRADED_GAME_TYPES) {
    it(`${type}: lo que sale del sanitizador del servidor es valido para mostrarse (antes: «Tipo de pregunta no reconocido»)`, () => {
      const s = served(type, GAME_DATA[type]);
      expect(s.serverGraded).toBe(true);
      expect(isValidQuestion(s)).toEqual({ valid: true });
    });
    it(`${type}: sin datos del juego NO es valido`, () => {
      const s = served(type, {});
      expect(isValidQuestion(s).valid).toBe(false);
      expect(isValidQuestion({ ...s, game_data: undefined }).valid).toBe(false);
    });
  }
  it('sin la marca serverGraded, los juegos que traen su solucion en game_data la siguen exigiendo (nada se relaja)', () => {
    const unmarked = (type: string) => ({ ...served(type, GAME_DATA[type]), serverGraded: undefined });
    for (const type of ['el_descifrador', 'flashcard_rapida', 'impostor_cognitivo', 'juicio_conocimiento']) {
      expect(isValidQuestion(question(type, GAME_DATA[type])).valid, `${type} completo`).toBe(true);
      expect(isValidQuestion(unmarked(type)).valid, `${type} sanitizado sin marca`).toBe(false);
    }
  });
  it('no hace falta «q»: el enunciado de un juego vive en game_data', () => {
    const s = { ...served('linea_del_tiempo', GAME_DATA.linea_del_tiempo), q: undefined };
    expect(isValidQuestion(s)).toEqual({ valid: true });
  });
  it('minimos por juego: 3 afirmaciones, 3 opciones de puente, 2 testimonios, 3 pistas y letras por adivinar', () => {
    const bad = (type: string, patch: Record<string, unknown>) => isValidQuestion(served(type, { ...GAME_DATA[type], ...patch })).valid;
    expect(bad('impostor_cognitivo', { statements: GAME_DATA.impostor_cognitivo.statements && [{ id: 1, text: 'a' }, { id: 2, text: 'b' }] })).toBe(false);
    expect(bad('alquimia_conceptual', { bridge_options: [{ id: 'x', text: '1' }] })).toBe(false);
    expect(bad('alquimia_conceptual', { alchemy_enigma: '' })).toBe(false);
    expect(bad('juicio_conocimiento', { expert_testimony: [{ paragraph_id: 1, text: 'p1' }] })).toBe(false);
    expect(bad('juicio_conocimiento', { case_file: '' })).toBe(false);
    expect(bad('cuarto_crisis', { interventions: [] })).toBe(false);
    expect(bad('cuarto_crisis', { crisis_scenario: '' })).toBe(false);
    expect(bad('categorias_rapidas', { categories: [] })).toBe(false);
    expect(bad('categorias_rapidas', { items: [] })).toBe(false);
    expect(bad('linea_del_tiempo', { items: [] })).toBe(false);
    expect(bad('flashcard_rapida', { pairs: [] })).toBe(false);
    expect(bad('el_descifrador', { hints: ['uno', 'dos'] })).toBe(false); // menos de 3 pistas
    expect(bad('el_descifrador', { initial_clue: '' })).toBe(false);
    expect(bad('el_descifrador', { word_to_guess: '' })).toBe(false); // sin letras que adivinar
    expect(bad('el_descifrador', { word_to_guess: '--  --' })).toBe(false); // solo signos
  });
  it('un tipo de juego desconocido marcado serverGraded sigue siendo invalido', () => {
    expect(isValidQuestion({ id: 'x', type: 'juego_inventado', serverGraded: true, q: 'x', game_data: {} }).valid).toBe(false);
  });
});
