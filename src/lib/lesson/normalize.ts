// Normalización de strings para fill_blank (lower, trim, sin tildes)
// Fase 11.D · Stud.ia

export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // sacar marcas de acento (combining diacritics)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' '); // colapsar espacios múltiples
}

export function isFillAnswerCorrect(
  userInput: string,
  correctAnswer: string,
  alternatives: string[]
): boolean {
  const userN = normalizeAnswer(userInput);
  if (userN.length === 0) return false;
  const candidates = [correctAnswer, ...alternatives].map(normalizeAnswer);
  return candidates.includes(userN);
}

// ¿El texto del estudiante trae la respuesta (o palabra clave) esperada? Contiene, SIN tildes ni mayusculas, pero la aparicion NO puede empezar a mitad de una palabra: «inelastica» ya no
// vale por «elastica» (medido: lo aceptaba, y un antonimo con prefijo es el error mas comun), mientras «precios» sigue valiendo por «precio» (plural, genero, conjugacion). Una respuesta
// esperada vacia nunca se cumple. Es la UNICA regla de «contiene» de las lecciones: la usan el calificador del servidor y el del navegador, para que no diverjan.
export function containsExpected(text: string, expected: string): boolean {
  const t = normalizeAnswer(text);
  const x = normalizeAnswer(expected);
  if (x === '') return false;
  for (let i = t.indexOf(x); i >= 0; i = t.indexOf(x, i + 1)) {
    if (i === 0 || !/[a-z0-9]/.test(t[i - 1])) return true;
  }
  return false;
}

