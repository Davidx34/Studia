// Sesion I, Fix 1: a veces Cohere genera una pregunta/minijuego con un campo
// faltante (ej. "opts" vacio, o un minijuego sin "game_data" completo), y el
// componente correspondiente se rompe o renderiza en blanco. Esta funcion
// valida ANTES de intentar renderizar, para poder mostrar un error amigable
// y dejar saltar a la siguiente en vez de una pantalla rota o vacia.

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function isValidQuestion(q: any): ValidationResult {
  if (!q || typeof q !== 'object') return { valid: false, error: 'La pregunta no tiene datos.' };

  switch (q.type) {
    case 'multiple_choice':
      if (!q.q || !Array.isArray(q.opts) || q.opts.length === 0) {
        return { valid: false, error: 'Falta el texto de la pregunta o las opciones.' };
      }
      if (typeof q.ok !== 'number' || q.ok < 0 || q.ok >= q.opts.length) {
        return { valid: false, error: 'Falta la respuesta correcta.' };
      }
      return { valid: true };

    case 'true_false':
      if (!q.q || typeof q.ok !== 'boolean') {
        return { valid: false, error: 'Falta el texto de la afirmación.' };
      }
      return { valid: true };

    case 'fill_blank':
      if (!q.q || !Array.isArray(q.answers) || q.answers.length === 0) {
        return { valid: false, error: 'Falta la oración o la respuesta esperada.' };
      }
      return { valid: true };

    case 'match':
      if (!q.q || !Array.isArray(q.pairs) || q.pairs.length === 0) {
        return { valid: false, error: 'Faltan los pares para conectar.' };
      }
      return { valid: true };

    case 'short_answer':
      if (!q.q || !Array.isArray(q.keywords) || q.keywords.length === 0) {
        return { valid: false, error: 'Falta la pregunta o las palabras clave esperadas.' };
      }
      return { valid: true };

    case 'el_descifrador': {
      const gd = q.game_data || {};
      if (!gd.word_to_guess || !gd.initial_clue) {
        return { valid: false, error: 'El Descifrador: falta la palabra o la pista inicial.' };
      }
      if (!Array.isArray(gd.hints) || gd.hints.length < 3) {
        return { valid: false, error: 'El Descifrador: faltan pistas.' };
      }
      return { valid: true };
    }

    case 'linea_del_tiempo': {
      const gd = q.game_data || {};
      if (!Array.isArray(gd.items) || gd.items.length === 0) {
        return { valid: false, error: 'Línea del Tiempo: no hay eventos para ordenar.' };
      }
      return { valid: true };
    }

    case 'categorias_rapidas': {
      const gd = q.game_data || {};
      if (!Array.isArray(gd.categories) || gd.categories.length === 0) {
        return { valid: false, error: 'Categorías Rápidas: no hay categorías.' };
      }
      if (!Array.isArray(gd.items) || gd.items.length === 0) {
        return { valid: false, error: 'Categorías Rápidas: no hay elementos para clasificar.' };
      }
      return { valid: true };
    }

    case 'flashcard_rapida': {
      const gd = q.game_data || {};
      if (!Array.isArray(gd.pairs) || gd.pairs.length === 0) {
        return { valid: false, error: 'Flashcard Rápida: no hay pares para emparejar.' };
      }
      return { valid: true };
    }

    case 'impostor_cognitivo': {
      const gd = q.game_data || {};
      if (!Array.isArray(gd.statements) || gd.statements.length !== 3) {
        return { valid: false, error: 'El Impostor Cognitivo: deben ser exactamente 3 afirmaciones.' };
      }
      if (!gd.statements.some((s: any) => s.is_impostor)) {
        return { valid: false, error: 'El Impostor Cognitivo: ninguna afirmación está marcada como falsa.' };
      }
      return { valid: true };
    }

    case 'alquimia_conceptual': {
      const gd = q.game_data || {};
      if (!gd.element_a || !gd.element_b || !gd.alchemy_enigma) {
        return { valid: false, error: 'Alquimia Conceptual: faltan los conceptos o el enigma.' };
      }
      if (!Array.isArray(gd.bridge_options) || gd.bridge_options.length !== 3) {
        return { valid: false, error: 'Alquimia Conceptual: deben ser exactamente 3 opciones de puente.' };
      }
      return { valid: true };
    }

    case 'cuarto_crisis': {
      const gd = q.game_data || {};
      if (!gd.crisis_scenario || !Array.isArray(gd.interventions) || gd.interventions.length === 0) {
        return { valid: false, error: 'Cuarto de Crisis: falta el escenario o las intervenciones.' };
      }
      return { valid: true };
    }

    case 'juicio_conocimiento': {
      const gd = q.game_data || {};
      if (!gd.case_file || !Array.isArray(gd.expert_testimony) || gd.expert_testimony.length < 2) {
        return { valid: false, error: 'El Juicio al Conocimiento: falta el testimonio.' };
      }
      if (gd.guilty_paragraph_id === undefined || gd.guilty_paragraph_id === null) {
        return { valid: false, error: 'El Juicio al Conocimiento: falta identificar el párrafo culpable.' };
      }
      return { valid: true };
    }

    default:
      return { valid: false, error: `Tipo de pregunta desconocido: ${q.type}` };
  }
}
