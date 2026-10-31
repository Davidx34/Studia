// Que modelo de Gemini usa cada pieza que llama a Gemini DIRECTO (por su API nativa, no por la pasarela): el juez, la lectura de PDFs,
// el resumen de fragmentos y la deteccion de temas. Antes cada una tenia el modelo escrito a mano; ahora salen de aqui y se cambian
// por variable de entorno, sin tocar codigo.
//
// PERFIL (AI_PROFILE):
//   free (por defecto) = para la cuota gratuita. Desde 2026-10-31 usa modelos 3.x: gemini-2.5-flash y gemini-2.5-flash-lite responden 404 "ya no disponible para usuarios
//                        nuevos" con llaves nuevas (aunque la lista de modelos los muestre) y el juez acababa en el modelo de respaldo, el pequeño.
//   paid               = con presupuesto: ademas pone a Gemini 3.5 al frente de las cadenas de la pasarela (ver docs/IA_MODELOS_Y_PRESUPUESTO.md).
// Cada papel se puede fijar aparte: GEMINI_MODEL_JUDGE, GEMINI_MODEL_PDF, GEMINI_MODEL_CHUNKS, GEMINI_MODEL_TOPICS
// (lista con comas: el primero es el preferido y el resto, respaldo). GEMINI_PDF_MODELS sigue valiendo para el PDF.
//
// Funciones puras (reciben el entorno), para poder probarlas.

export type GeminiRole = 'judge' | 'pdf' | 'chunks' | 'topics';
export type AiProfile = 'free' | 'paid';

type Env = Record<string, string | undefined>;

export const aiProfile = (env: Env = process.env): AiProfile => (env.AI_PROFILE?.trim().toLowerCase() === 'paid' ? 'paid' : 'free');

// Los modelos de "paid" son los que existen en la llave del proyecto segun `npm run ai:doctor` (2026-10-26). El juez usa el 3.5 Flash
// y no el Lite: es la tarea que mas se beneficia de un modelo mas capaz y hace pocas llamadas (lotes de 8 preguntas).
export const DEFAULT_MODELS: Record<AiProfile, Record<GeminiRole, string[]>> = {
  // Con 3.5-flash primero en el juez (la tarea que mas gana con un modelo mas capaz) y el lite como respaldo si se agota su cuota. Medido con la llave del proyecto el 2026-10-31:
  // los 3.x responden (0,5 a 2,4 s) y los 2.5 dan 404.
  free: {
    judge: ['gemini-3.5-flash', 'gemini-3.5-flash-lite'],
    pdf: ['gemini-3.5-flash-lite', 'gemini-3.5-flash'],
    chunks: ['gemini-3.5-flash-lite'],
    topics: ['gemini-3.5-flash-lite'],
  },
  paid: {
    judge: ['gemini-3.5-flash'],
    pdf: ['gemini-3.5-flash-lite', 'gemini-3.5-flash'],
    chunks: ['gemini-3.5-flash-lite'],
    topics: ['gemini-3.5-flash-lite'],
  },
};

const list = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

export function geminiModels(role: GeminiRole, env: Env = process.env): string[] {
  const fromEnv = list(env[`GEMINI_MODEL_${role.toUpperCase()}`]);
  if (fromEnv.length > 0) return fromEnv;
  if (role === 'pdf') {
    const legacy = list(env.GEMINI_PDF_MODELS);
    if (legacy.length > 0) return legacy;
  }
  return DEFAULT_MODELS[aiProfile(env)][role];
}

export const geminiModel = (role: GeminiRole, env: Env = process.env): string => geminiModels(role, env)[0];

// Como se apaga el "pensar" interno del modelo, que consume tokens de salida (y se cobra) y puede dejar sin espacio a una respuesta
// corta. Cada familia lo pide distinto, y pedirlo mal da HTTP 400 (medido con la llave del proyecto, 2026-10-26):
//   gemini-2.5-*            thinkingBudget: 0        valido
//   gemini-3.5-flash        thinkingLevel: 'minimal' valido (sin el, penso ~420 tokens en una peticion trivial)
//   gemini-3.5-flash-lite   (nada)                   thinkingBudget: 0 da 400; sin parametro no piensa
// Cualquier otro modelo: no se envia nada (siempre es valido; como mucho piensa de mas).
export function thinkingConfigFor(model: string): { thinkingConfig: Record<string, unknown> } | Record<string, never> {
  if (/^gemini-2\.5-/.test(model)) return { thinkingConfig: { thinkingBudget: 0 } };
  if (/^gemini-3\.5-flash$/.test(model)) return { thinkingConfig: { thinkingLevel: 'minimal' } };
  return {};
}
