import { describe, expect, it } from 'vitest';
import { MAX_ANSWER_CHARS, MAX_ANSWER_WORDS, askedCount, fillBlankQuality, hasDroppedSymbols, isTypable, matchQuality, shortAnswerQuality, unfairKeywords } from './typability';
import { isValidQuestion } from './validateQuestion';
import { validateExamQuestion, chunkKey, type ChunkIndex } from '@/lib/blueprint/examQuestion';
import type { Blueprint } from '@/lib/blueprint/types';

describe('isTypable: lo que un estudiante puede escribir', () => {
  it('palabras, tildes, ñ, numeros y signos de palabra', () => {
    for (const a of ['costo de oportunidad', 'elástica', 'año', 'Cobb-Douglas', "O'Brien", '15', '1,5', '10 %', 'bien Giffen']) expect(isTypable(a), a).toBe(true);
  });
  it('los casos reales: formulas y simbolos NO se pueden escribir', () => {
    for (const a of ['pxx + pyy ≤ W', '-px / py', 'L = (P - CMg)/P', 'x^2', '$\\lambda$', '\\frac{a}{b}', 'a <= b', 'p1x1 + p2x2 = m', 'U(x,y)', '{a}', 'a_1']) expect(isTypable(a), a).toBe(false);
  });
  it('vacio, solo espacios, no texto, demasiado largo', () => {
    for (const a of ['', '   ', null, undefined, 5, {}, []]) expect(isTypable(a)).toBe(false);
    expect(MAX_ANSWER_WORDS).toBe(6);
    expect(MAX_ANSWER_CHARS).toBe(60);
    expect(isTypable('uno dos tres cuatro cinco seis')).toBe(true);
    expect(isTypable('uno dos tres cuatro cinco seis siete')).toBe(false);
    expect(isTypable('a'.repeat(60))).toBe(true);
    expect(isTypable('a'.repeat(61))).toBe(false);
  });
  it('no puede empezar por un signo', () => {
    expect(isTypable('-3')).toBe(false);
    expect(isTypable('.5')).toBe(false);
    expect(isTypable('3-5')).toBe(true);
  });
});

describe('hasDroppedSymbols: huecos de una formula perdida al leer el PDF', () => {
  it('los casos reales', () => {
    expect(hasDroppedSymbols('La restricción presupuestaria se define como _____, donde  y  son las cantidades de bienes x e y, respectivamente, y  e  son sus precios.')).toBe(true);
    expect(hasDroppedSymbols('La utilidad marginal de un bien  es la ____ de la función de utilidad')).toBe(true);
  });
  it('otros restos: parentesis vacios, dolares vacios y comas sueltas', () => {
    expect(hasDroppedSymbols('La funcion U() depende de x')).toBe(true);
    expect(hasDroppedSymbols('El valor $ $ es positivo')).toBe(true);
    expect(hasDroppedSymbols('donde x , y son bienes')).toBe(true);
    expect(hasDroppedSymbols('texto  , mas texto')).toBe(true);
    expect(hasDroppedSymbols('el valor es  .')).toBe(true); // espacios y luego un signo de cierre
  });
  it('texto normal NO se marca (un espacio, formulas completas, doble espacio tras un punto)', () => {
    expect(hasDroppedSymbols('La restricción presupuestaria se define como la desigualdad con $p_x x + p_y y \\le W$.')).toBe(false);
    expect(hasDroppedSymbols('Primera frase.  Segunda frase sin problema.')).toBe(false);
    expect(hasDroppedSymbols('El costo de oportunidad (CO) es lo que se renuncia.')).toBe(false);
    expect(hasDroppedSymbols('')).toBe(false);
    expect(hasDroppedSymbols(undefined)).toBe(false);
  });
});

describe('palabras clave justas', () => {
  it('las que ya estan en el enunciado se regalan (caso real: «restriccion presupuestaria» y «precio»)', () => {
    const q = 'Explique brevemente cómo afecta un aumento en el precio de un bien a la restricción presupuestaria del consumidor.';
    expect(unfairKeywords(q, ['restricción presupuestaria', 'precio', 'desplazamiento'])).toEqual(['restricción presupuestaria', 'precio']);
    expect(unfairKeywords(q, ['desplaz', 'ingreso'])).toEqual([]);
  });
  it('una palabra clave que no se puede teclear tampoco es justa', () => {
    expect(unfairKeywords('Explica la desigualdad', ['x ≤ y', 'pendiente'])).toEqual(['x ≤ y']);
  });
  it('una palabra clave que solo EMPIEZA a mitad de otra palabra del enunciado no cuenta como regalada', () => {
    expect(unfairKeywords('Explica la microeconomía del consumidor', ['economía'])).toEqual([]);
  });
});

describe('fillBlankQuality y shortAnswerQuality', () => {
  it('completar: respuesta escribible y no regalada', () => {
    expect(fillBlankQuality('El ____ es lo que se renuncia.', ['costo de oportunidad']).ok).toBe(true);
    expect(fillBlankQuality('La restricción se define como _____', ['pxx + pyy ≤ W']).ok).toBe(false);
    expect(fillBlankQuality('La demanda Marshalliana es la cantidad ____ a un precio', ['demanda marshalliana']).ok).toBe(false);
    expect(fillBlankQuality('x', []).ok).toBe(true); // sin respuestas lo decide el validador de forma
  });
  it('respuesta corta: de 1 a 5 palabras clave, escribibles y no regaladas', () => {
    expect(shortAnswerQuality('Menciona un factor que mueve la recta.', ['ingreso']).ok).toBe(true);
    expect(shortAnswerQuality('Menciona un factor.', []).ok).toBe(false);
    expect(shortAnswerQuality('Menciona un factor.', ['a1', 'b2', 'c3', 'd4', 'e5', 'f6']).ok).toBe(false);
    expect(shortAnswerQuality('Explica el ingreso.', ['ingreso']).ok).toBe(false);
    expect(shortAnswerQuality('Explica algo.', 'no es lista').ok).toBe(false);
  });
});

describe('isValidQuestion (lecciones): las preguntas reales de la captura ya NO se sirven', () => {
  const fill = { type: 'fill_blank', q: 'La restricción presupuestaria se define como _____, donde  y  son las cantidades de bienes x e y, respectivamente, y  e  son sus precios.', answers: ['pxx + pyy ≤ W'], exp: 'x' };
  const short = { type: 'short_answer', q: 'Explique brevemente cómo afecta un aumento en el precio de un bien a la restricción presupuestaria del consumidor.', keywords: ['restricción presupuestaria', 'precio', 'desplazamiento'], exp: 'x' };
  it('completar con huecos y respuesta de formula', () => {
    expect(isValidQuestion(fill).valid).toBe(false);
    expect(isValidQuestion({ ...fill, q: 'La restricción presupuestaria se define como _____, donde x e y son las cantidades.' }).error).toContain('escribir');
    expect(isValidQuestion({ ...fill, answers: ['desigualdad'] }).error).toContain('huecos');
  });
  it('respuesta corta con palabras clave regaladas', () => {
    expect(isValidQuestion(short).valid).toBe(false);
    expect(isValidQuestion({ ...short, keywords: ['desplaz', 'ingreso'] }).valid).toBe(true);
  });
  it('una pregunta bien hecha sigue pasando (completar, respuesta corta, opcion multiple con formula completa)', () => {
    expect(isValidQuestion({ type: 'fill_blank', q: 'El ____ es lo que se renuncia al elegir.', answers: ['costo de oportunidad'], exp: 'x' }).valid).toBe(true);
    expect(isValidQuestion({ type: 'multiple_choice', q: '¿Cuál es la restricción? $p_x x + p_y y \\le W$', opts: ['A. $p_x x \\le W$', 'B. otra'], ok: 0, exp: 'x' }).valid).toBe(true);
  });
  it('huecos de formula tambien en las opciones y en los pares de emparejar', () => {
    expect(isValidQuestion({ type: 'multiple_choice', q: 'Elige', opts: ['A. donde  y  son', 'B. otra'], ok: 0, exp: 'x' }).valid).toBe(false);
    expect(isValidQuestion({ type: 'match', q: 'Une', pairs: [{ term: 'a', def: 'donde  y  son' }], exp: 'x' }).valid).toBe(false);
  });
  it('los minijuegos no se ven afectados por esta regla', () => {
    expect(isValidQuestion({ type: 'linea_del_tiempo', q: 'Ordena  esto  ya', game_data: { items: [{ id: 1, text: 'a' }] } }).valid).toBe(true);
  });
});

describe('preguntas de EXAMEN: las mismas reglas', () => {
  const MAT = '11111111-1111-4111-8111-111111111111';
  const plan = (): Blueprint => ({ version: 1, outcomes: [{ id: 'o1', statement: 'x' }], periods: [{ id: 'p1', name: 'A', order: 1, weight: 100, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob1', title: 'T', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'M', order: 1 }] }] }] });
  const TEXT = 'Decimos que la pendiente de la recta presupuestaria mide el costo de oportunidad de consumir el bien x.';
  const chunks = (): ChunkIndex => new Map([[chunkKey(MAT, 0), { materialName: 'G', text: TEXT }]]);
  const base = { outcomeId: 'o1', nodeId: 'm1', exp: 'La pendiente de la recta presupuestaria mide el costo de oportunidad: cuánto del otro bien se renuncia por una unidad más.', source: { materialId: MAT, chunkIndex: 0, quote: 'la pendiente de la recta presupuestaria mide el costo de oportunidad de consumir el bien x' } };
  const errs = (r: ReturnType<typeof validateExamQuestion>) => (r.ok ? '' : r.errors.join(' | '));
  it('completar con respuesta de formula', () => {
    expect(errs(validateExamQuestion({ ...base, type: 'fill_blank', q: 'La pendiente se calcula como ____ entre precios.', answers: ['-px / py'] }, { plan: plan(), chunks: chunks() }))).toContain('teclado');
  });
  it('respuesta corta con palabras clave regaladas o sin teclear', () => {
    const r = validateExamQuestion({ ...base, type: 'short_answer', q: 'Explica qué mide la pendiente de la recta presupuestaria.', keywords: ['pendiente', 'oportunidad'] }, { plan: plan(), chunks: chunks() });
    expect(errs(r)).toContain('ya presente en el enunciado');
    expect(validateExamQuestion({ ...base, type: 'short_answer', q: 'Explica qué mide esa inclinación de la recta.', keywords: ['oportunidad'] }, { plan: plan(), chunks: chunks() }).ok).toBe(true);
  });
  it('huecos de formula en el enunciado', () => {
    expect(errs(validateExamQuestion({ ...base, type: 'fill_blank', q: 'La pendiente de la recta, donde  y  son precios, es ____.', answers: ['costo'] }, { plan: plan(), chunks: chunks() }))).toContain('huecos');
  });
});

// Reglas nacidas de la revision externa (docs/IA_ARQUITECTURA_DE_MEMORIAS.md §13).
describe('reglas de la revision externa', () => {
  it('completar: debe haber una respuesta por hueco (el calificador exige TODAS)', () => {
    expect(fillBlankQuality('El Índice de Lerner en competencia perfecta vale ___.', ['cero', '0']).ok).toBe(false);
    expect(fillBlankQuality('El poder adquisitivo depende de ___ y ___.', ['precios', 'ingreso']).ok).toBe(true);
    expect(fillBlankQuality('La demanda es ___ si su elasticidad es mayor que uno.', ['elástica']).ok).toBe(true);
    expect(fillBlankQuality('Dos huecos ___ y ___ pero una sola respuesta.', ['una']).ok).toBe(false);
  });
  it('completar sin hueco marcado no se rechaza por esta regla', () => {
    expect(fillBlankQuality('Escribe el nombre de la curva', ['oferta']).ok).toBe(true);
  });
  it('respuesta corta: pedir «dos» o «tres» exige esa cantidad de palabras clave', () => {
    expect(askedCount('Indica dos de las características de la competencia perfecta.')).toBe(2);
    expect(askedCount('Menciona los tres conjuntos de cestas que se definen.')).toBe(3);
    expect(askedCount('Explica el significado de la condición de primer orden.')).toBeNull();
    expect(askedCount('Menciona una de las dos razones del colapso.')).toBeNull();
    expect(askedCount('Indica al menos dos características.')).toBeNull();
    expect(shortAnswerQuality('Menciona dos supuestos fundamentales sobre la conducta del consumidor.', ['tomador', 'racional', 'bienestar']).ok).toBe(false);
    expect(shortAnswerQuality('Menciona dos supuestos fundamentales sobre la conducta del consumidor.', ['tomador', 'racional']).ok).toBe(true);
  });
  it('emparejar: un termino repetido se rechaza, pero definiciones identicas NO (el calificador compara el texto)', () => {
    expect(matchQuality([{ term: 'Alfa', def: 'Uno' }, { term: 'alfa', def: 'Dos' }]).ok).toBe(false);
    expect(matchQuality([{ term: 'Maíz', def: 'América' }, { term: 'Papa', def: 'América' }, { term: 'Arroz', def: 'Asia' }]).ok).toBe(true);
  });
});
