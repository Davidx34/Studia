// EVIDENCIA VERIFICABLE (docs/IA_ARQUITECTURA_DE_MEMORIAS.md §14). Criterio del profesor: TODO lo que afirma una pregunta debe estar EXPLICITAMENTE en el material (si no, el modelo falla al leer y extraer, y el
// estudiante no puede estudiarlo del material); tampoco puede haber resultados, procedimientos o ideas que el material no respalde. La forma objetiva de exigirlo es una CITA: la pregunta (o el revisor)
// debe copiar la frase literal del material que respalda la respuesta, y el CODIGO comprueba que esa frase existe. Una cita que no existe en el material no cuenta (no se puede «inventar» evidencia).
// Pura y sin IA. Verificar que la frase existe NO prueba que respalde la respuesta: eso lo juzga el revisor (o el profesor); aqui solo se cierra la puerta a citas inventadas.
import { normalizeAnswer } from '@/lib/lesson/normalize';

/** Texto normalizado para comparar citas: sin tildes, minusculas, solo letras y numeros separados por un espacio. */
export function normForQuote(text: unknown): string {
  return normalizeAnswer(String(text ?? ''))
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

export const MIN_QUOTE_TOKENS = 8; // una cita de menos de 8 palabras es demasiado corta para probar nada

/** Material (varios fragmentos) normalizado, listo para buscar citas. */
export function indexForQuotes(chunks: readonly string[]): string {
  return chunks.map(normForQuote).join(' ');
}

export function quoteTokens(quote: unknown): number {
  const n = normForQuote(quote);
  return n ? n.split(' ').length : 0;
}

/** ¿La cita (≥ 8 palabras) aparece LITERALMENTE (normalizada) en el material? */
export function quoteInMaterial(quote: unknown, normalizedMaterial: string, minTokens = MIN_QUOTE_TOKENS): boolean {
  const n = normForQuote(quote);
  if (!n || n.split(' ').length < minTokens) return false;
  return normalizedMaterial.includes(n);
}

export type EvidenceStatus = 'sin_evidencia' | 'no_verificada' | 'verificada';

/** Estado de la evidencia que trae una pregunta (campo `evidence`): ausente, presente pero no hallada en el material, o verificada. */
export function evidenceStatus(q: any, normalizedMaterial: string): EvidenceStatus {
  const e = q?.evidence;
  if (typeof e !== 'string' || e.trim() === '') return 'sin_evidencia';
  return quoteInMaterial(e, normalizedMaterial) ? 'verificada' : 'no_verificada';
}

/** Bloque que se agrega al prompt de generacion para exigir la evidencia. */
export const EVIDENCE_PROMPT_BLOCK = `REGLA DE EVIDENCIA (obligatoria, la mas importante despues del anclaje): cada pregunta debe poder respaldarse con UNA frase del MATERIAL DE REFERENCIA que afirme EXPLICITAMENTE su respuesta correcta. Agrega a CADA pregunta el campo "evidence" con esa frase copiada TEXTUALMENTE, palabra por palabra, del material (entre 8 y 40 palabras). Si no encuentras una frase que diga explicitamente la respuesta, NO generes esa pregunta (no calcules resultados nuevos, no deduzcas, no uses conocimiento que el material no dice). Una "evidence" inventada o parafraseada invalida la pregunta.`;

/** Fragmentos mas relacionados con una afirmacion (por terminos de contenido compartidos): sirve para dar al revisor o a un verificador el material relevante. */
export function rankChunks(claimText: string, chunks: readonly string[], k = 6): string[] {
  const terms = new Set(normForQuote(claimText).split(' ').filter((t) => t.length >= 4));
  return chunks
    .map((c, i) => {
      const have = new Set(normForQuote(c).split(' '));
      let s = 0;
      for (const t of terms) if (have.has(t)) s++;
      return { c, i, s };
    })
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, k)
    .map((x) => x.c);
}
