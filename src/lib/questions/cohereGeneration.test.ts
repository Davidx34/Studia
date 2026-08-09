// Protocolo 7.1.2: normalizeGeneratedQuestion convierte la respuesta cruda
// de Cohere para los 8 minijuegos al shape anidado (game_type/game_data)
// que consumen todos los componentes de render — es el punto unico donde
// un campo mal mapeado rompe silenciosamente un minijuego completo para
// TODOS los estudiantes que lo ven. Cubre los 8 tipos de minijuego mas el
// passthrough de tipos de pregunta normales (que no deben tocarse).

import { describe, it, expect } from 'vitest';
import { normalizeGeneratedQuestion } from './cohereGeneration';

describe('normalizeGeneratedQuestion', () => {
  it('deja intactos los tipos de pregunta normales (no minijuego)', () => {
    const q = { type: 'multiple_choice', q: 'pregunta', opts: ['a', 'b'], ok: 0, exp: 'explicacion' };
    expect(normalizeGeneratedQuestion(q)).toEqual(q);
  });

  it('normaliza el_descifrador: mueve word_to_guess/initial_clue/hints a game_data', () => {
    const raw = {
      type: 'el_descifrador',
      q: 'Descifra',
      word_to_guess: 'FOTOSINTESIS',
      initial_clue: 'proceso vegetal',
      hints: ['h1', 'h2', 'h3'],
      exp: 'porque importa',
    };
    const result = normalizeGeneratedQuestion(raw);
    expect(result.game_type).toBe('el_descifrador');
    expect(result.game_data).toEqual({
      word_to_guess: 'FOTOSINTESIS',
      initial_clue: 'proceso vegetal',
      hints: ['h1', 'h2', 'h3'],
      pedagogical_feedback: 'porque importa',
    });
    // Los campos ya movidos a game_data no deben quedar duplicados en el nivel superior.
    expect(result.word_to_guess).toBeUndefined();
    expect(result.hints).toBeUndefined();
  });

  it('normaliza linea_del_tiempo: mueve items a game_data', () => {
    const raw = { type: 'linea_del_tiempo', q: 'Ordena', items: [{ id: 1, text: 'evento' }], exp: 'porque' };
    const result = normalizeGeneratedQuestion(raw);
    expect(result.game_type).toBe('linea_del_tiempo');
    expect(result.game_data).toEqual({ items: [{ id: 1, text: 'evento' }], pedagogical_feedback: 'porque' });
    expect(result.items).toBeUndefined();
  });

  it('normaliza categorias_rapidas: mueve categories/items/time_limit_seconds a game_data', () => {
    const raw = {
      type: 'categorias_rapidas',
      q: 'Clasifica',
      categories: ['A', 'B'],
      items: [{ id: 1 }],
      time_limit_seconds: 60,
      exp: 'porque',
    };
    const result = normalizeGeneratedQuestion(raw);
    expect(result.game_data).toEqual({
      categories: ['A', 'B'],
      items: [{ id: 1 }],
      time_limit_seconds: 60,
      pedagogical_feedback: 'porque',
    });
  });

  it('normaliza flashcard_rapida: renombra flash_pairs a pairs dentro de game_data', () => {
    const raw = { type: 'flashcard_rapida', q: 'Empareja', flash_pairs: [{ id: 1, card1: 'a', card2: 'b' }], exp: 'porque' };
    const result = normalizeGeneratedQuestion(raw);
    expect(result.game_data.pairs).toEqual([{ id: 1, card1: 'a', card2: 'b' }]);
    expect(result.flash_pairs).toBeUndefined();
    // No debe quedar un campo "flash_pairs" residual dentro de game_data tampoco.
    expect(result.game_data.flash_pairs).toBeUndefined();
  });

  it('normaliza impostor_cognitivo: mueve context/statements, renombra exp a exposicion_del_impostor', () => {
    const raw = {
      type: 'impostor_cognitivo',
      q: 'Encuentra',
      context: 'escenario',
      statements: [{ text: 'a', is_impostor: false }],
      exp: 'explicacion',
    };
    const result = normalizeGeneratedQuestion(raw);
    expect(result.game_data).toEqual({
      context: 'escenario',
      statements: [{ text: 'a', is_impostor: false }],
      exposicion_del_impostor: 'explicacion',
    });
  });

  it('normaliza alquimia_conceptual: mueve los 5 campos, renombra exp a unlocked_knowledge', () => {
    const raw = {
      type: 'alquimia_conceptual',
      q: 'Encuentra el puente',
      fusion_title: 'titulo',
      element_a: 'a',
      element_b: 'b',
      alchemy_enigma: 'enigma',
      bridge_options: [{ id: 'X', is_correct: true }],
      exp: 'concepto desbloqueado',
    };
    const result = normalizeGeneratedQuestion(raw);
    expect(result.game_data).toEqual({
      fusion_title: 'titulo',
      element_a: 'a',
      element_b: 'b',
      alchemy_enigma: 'enigma',
      bridge_options: [{ id: 'X', is_correct: true }],
      unlocked_knowledge: 'concepto desbloqueado',
    });
  });

  it('normaliza cuarto_crisis: mueve crisis_scenario/telemetry_data/interventions, renombra exp a post_mortem_report', () => {
    const raw = {
      type: 'cuarto_crisis',
      q: 'Resuelve',
      crisis_scenario: 'descripcion',
      telemetry_data: ['s1', 's2'],
      interventions: [{ action_code: 'ALPHA', is_solution: true }],
      exp: 'analisis tecnico',
    };
    const result = normalizeGeneratedQuestion(raw);
    expect(result.game_data).toEqual({
      crisis_scenario: 'descripcion',
      telemetry_data: ['s1', 's2'],
      interventions: [{ action_code: 'ALPHA', is_solution: true }],
      post_mortem_report: 'analisis tecnico',
    });
  });

  it('normaliza juicio_conocimiento: mueve los 4 campos, renombra exp a verdict_explanation', () => {
    const raw = {
      type: 'juicio_conocimiento',
      q: 'Encuentra el fraude',
      case_file: 'contexto',
      expert_testimony: [{ paragraph_id: 1, text: 'a' }],
      guilty_paragraph_id: 1,
      cross_examination_tip: 'pista',
      exp: 'explicacion magistral',
    };
    const result = normalizeGeneratedQuestion(raw);
    expect(result.game_data).toEqual({
      case_file: 'contexto',
      expert_testimony: [{ paragraph_id: 1, text: 'a' }],
      guilty_paragraph_id: 1,
      cross_examination_tip: 'pista',
      verdict_explanation: 'explicacion magistral',
    });
  });

  it('el resultado de cada minijuego es siempre valido segun isValidQuestion tras normalizar', async () => {
    // Verificacion cruzada con la otra funcion de mayor ROI (Protocolo
    // 7.1.2): el contrato entre ambas es que normalizeGeneratedQuestion
    // produce exactamente el shape que isValidQuestion espera.
    const { isValidQuestion } = await import('@/lib/lesson/validateQuestion');

    const rawExamples = [
      { type: 'el_descifrador', word_to_guess: 'X', initial_clue: 'c', hints: ['1', '2', '3'] },
      { type: 'linea_del_tiempo', items: [{ id: 1 }] },
      { type: 'categorias_rapidas', categories: ['A'], items: [{ id: 1 }] },
      { type: 'flashcard_rapida', flash_pairs: [{ id: 1, card1: 'a', card2: 'b' }] },
      {
        type: 'impostor_cognitivo',
        statements: [{ is_impostor: false }, { is_impostor: false }, { is_impostor: true }],
      },
      {
        type: 'alquimia_conceptual',
        element_a: 'a',
        element_b: 'b',
        alchemy_enigma: 'e',
        bridge_options: [{ id: 'X', is_correct: true }, { id: 'Y', is_correct: false }, { id: 'Z', is_correct: false }],
      },
      {
        type: 'cuarto_crisis',
        crisis_scenario: 'c',
        interventions: [{ action_code: 'ALPHA', is_solution: true }],
      },
      {
        type: 'juicio_conocimiento',
        case_file: 'c',
        expert_testimony: [{ paragraph_id: 1 }, { paragraph_id: 2 }],
        guilty_paragraph_id: 2,
      },
    ];

    for (const raw of rawExamples) {
      const normalized = normalizeGeneratedQuestion(raw);
      const check = isValidQuestion(normalized);
      expect(check.valid, `${raw.type} deberia ser valido tras normalizar: ${check.error}`).toBe(true);
    }
  });
});
