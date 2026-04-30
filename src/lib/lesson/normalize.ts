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
