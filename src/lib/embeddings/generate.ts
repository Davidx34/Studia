const GEMINI_EMBED_MODEL = 'gemini-embedding-001';
const GEMINI_EMBED_DIMENSIONS = 768; // debe matchear material_chunks.embedding vector(768)
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// Genera un embedding de 768 dimensiones vía Gemini, en el mismo formato que
// usan process-material/generate-lesson-from-material para los chunks de material.
// Devuelve null ante cualquier falla (sin API key, error de red, respuesta inválida)
// para que el llamador pueda hacer fallback sin romper la generación de preguntas.
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !text?.trim()) return null;

  try {
    const res = await fetch(
      `${GEMINI_BASE_URL}/models/${GEMINI_EMBED_MODEL}:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          outputDimensionality: GEMINI_EMBED_DIMENSIONS,
        }),
      }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const values = json?.embedding?.values;
    return Array.isArray(values) ? values : null;
  } catch {
    return null;
  }
}
