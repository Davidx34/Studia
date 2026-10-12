import { embedQuery } from './embed';

// Compatibilidad: el embedding de una CONSULTA (RETRIEVAL_QUERY, normalizado) del modelo y dimensiones de siempre
// (gemini-embedding-001, 768). Devuelve null ante cualquier falla (sin llave, red, respuesta invalida) para que el
// llamador siga con la busqueda por texto sin romper la generacion. La logica vive en ./embed.ts.
export async function generateEmbedding(text: string): Promise<number[] | null> {
  return embedQuery(text);
}
