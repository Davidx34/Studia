import { describe, expect, it } from 'vitest';
import { CATEGORIES, classifyReason, isFormValidatorReason, summarizeErrors, type ErrorCategory } from './errorTaxonomy';

// Frases con la FORMA de los motivos reales del juez (escritas de nuevo, sin texto de ningun curso).
const CASES: [ErrorCategory, string][] = [
  ['segunda_opinion_fallida', 'No se pudo obtener una segunda opinion: un humano debe confirmar esta pregunta.'],
  ['segunda_opinion_fallida', 'Segundo juez (modelo-x) no coincide (fail): al menos una pareja no corresponde.'],
  ['juez_sin_veredicto', 'El juez no pudo emitir veredicto (cuota agotada, sin API key o respuesta ilegible).'],
  ['duplicada', 'Pregunta duplicada, no debe llegar al estudiante.'],
  ['duplicada', 'Es una repetición idéntica de la Pregunta 2.'],
  ['formato_minijuego', 'El minijuego de categorias requiere entre 6 y 8 elementos por categoría.'],
  ['respuesta_no_evaluable', 'Solicita una explicación abierta con un ejemplo propio, por lo que la respuesta esperada no es específica.'],
  ['respuesta_no_evaluable', 'El enunciado no acepta variantes razonables de la respuesta.'],
  ['redaccion_confusa', 'El enunciado tiene una redacción confusa y mezcla dos ideas.'],
  ['no_autocontenida', 'La pregunta remite a el texto, que el estudiante no tiene a la vista.'],
  ['no_autocontenida', 'Faltan datos (el precio) para poder resolverla.'],
  ['ambiguedad_respuesta_unica', 'Viola el criterio de respuesta única: tanto la opción B como la C son válidas.'],
  ['ambiguedad_respuesta_unica', 'Las opciones A y B expresan exactamente la misma relación.'],
  ['anclaje_material', 'El concepto no se menciona ni se describe en el material fuente.'],
  ['anclaje_material', 'Ninguno de los conceptos de la lista (uno, dos, tres, cuatro, cinco, seis) aparece explicado en el material fuente.'],
  ['anclaje_material', 'Aunque el material menciona el factor, no describe cómo afecta al resultado.'],
  ['error_conceptual_o_calculo', 'La respuesta marcada es incorrecta: el cálculo da 5 y no 10.'],
  ['error_conceptual_o_calculo', 'Error de cálculo: la derivada correcta es otra.'],
  ['error_conceptual_o_calculo', 'La afirmación es falsa; ocurre justo lo contrario.'],
  ['error_conceptual_o_calculo', 'El término correcto para esa medida es otro, no el que aparece.'],
  ['otro', 'Algo que no encaja en ninguna regla conocida.'],
];

describe('classifyReason', () => {
  it.each(CASES)('%s <- «%s»', (cat, reason) => {
    expect(classifyReason(reason)).toBe(cat);
  });
  it('sin motivo registrado es su propia categoria (del pipeline), no «otro»', () => {
    for (const r of [null, undefined, '', '   ']) expect(classifyReason(r)).toBe('sin_motivo');
    expect(CATEGORIES.sin_motivo.origin).toBe('pipeline');
  });
  it('ignora las marcas de procedencia', () => {
    expect(classifyReason('[juez actual: fail] La respuesta marcada es incorrecta.')).toBe('error_conceptual_o_calculo');
    expect(classifyReason('Auditoria 2026-10-27: Pregunta duplicada.')).toBe('duplicada');
  });
  it('la infraestructura no se atribuye al generador', () => {
    expect(CATEGORIES.segunda_opinion_fallida.origin).toBe('infraestructura');
    expect(CATEGORIES.juez_sin_veredicto.origin).toBe('infraestructura');
    expect(CATEGORIES.anclaje_material.origin).toBe('generador');
  });
  it('toda categoria tiene etiqueta, origen y remedio', () => {
    for (const info of Object.values(CATEGORIES)) {
      expect(info.label.length).toBeGreaterThan(5);
      expect(info.remedy.length).toBeGreaterThan(5);
    }
  });
});

describe('summarizeErrors', () => {
  it('cuenta por categoria y origen, y excluye lo retirado por el validador de forma', () => {
    const s = summarizeErrors(['Pregunta duplicada.', 'No se pudo obtener una segunda opinion.', '[validador de forma] La respuesta ya esta escrita en el enunciado.', null, 'Rareza total']);
    expect(s.total).toBe(4);
    expect(s.byCategory).toMatchObject({ duplicada: 1, segunda_opinion_fallida: 1, sin_motivo: 1, otro: 1 });
    expect(s.byOrigin).toMatchObject({ generador: 1, infraestructura: 1, pipeline: 1, sin_clasificar: 1 });
    expect(s.unclassifiedShare).toBe(0.25);
    expect(isFormValidatorReason('[validador de forma] x')).toBe(true);
  });
  it('sin datos no divide por cero', () => {
    expect(summarizeErrors([]).unclassifiedShare).toBe(0);
  });
});
