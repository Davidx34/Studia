// Politica de "pensar" (razonamiento interno) de los modelos que llama la pasarela, en UN solo lugar y como funciones puras.
//
// Dos cosas que cambian por modelo:
//  1. El nivel de razonamiento que se pide (reasoning_effort). Los gpt-oss de Groq y Cerebras y los Gemini 3.x piensan por defecto.
//  2. El margen de salida. Esos tokens ocultos de razonamiento cuentan contra max_tokens: con un tope justo el modelo gasta todo pensando y la
//     respuesta llega VACIA (medido con ai:doctor --ping en gpt-oss, y en Gemini 3.5 Flash al generar un modulo con minijuegos). Subir el
//     tope no cuesta nada si el modelo no lo usa: solo deja espacio para la respuesta ademas del razonamiento.
//
// El nivel por modelo del API NATIVO de Gemini (thinkingBudget / thinkingLevel) sigue en geminiModels.ts (thinkingConfigFor): alli un
// parametro mal puesto da HTTP 400, y por eso solo se envia a modelos medidos con la llave del proyecto.

export type ThinkingTask = 'generation' | 'judge' | 'analysis' | 'study';
export type ReasoningEffort = 'low' | 'medium';

// Tope absoluto de la salida pedida: ningun margen lo supera (los proveedores gratuitos rechazan peticiones enormes).
export const MAX_OUTPUT_CEILING = 32_768;

// Tokens de margen para el razonamiento, segun el nivel pedido.
export const HEADROOM: Record<ReasoningEffort, number> = { low: 1024, medium: 2048 };

// Nivel de razonamiento para un proveedor/modelo de la API compatible con OpenAI, o null si no se debe enviar el parametro.
export function reasoningEffortFor(providerId: string, model: string, task: ThinkingTask): ReasoningEffort | null {
  // Gemini 3.x (3.5 Flash, 3.8 Flash...) tambien "piensa" por defecto. 'low' evita que deje SIN UNA SOLA pregunta valida un modulo con minijuegos
  // (medido el 2026-10-27) sin dejarlo sin razonar. Los 2.5 no se tocan.
  if (providerId === 'gemini' && /^gemini-3\./.test(model)) return 'low';
  // Groq y Cerebras aceptan reasoning_effort en los gpt-oss: bajo para juzgar y analizar (tareas cortas y deterministas), medio para generar.
  if (!/gpt-oss/i.test(model) || (providerId !== 'groq' && providerId !== 'cerebras')) return null;
  return task === 'generation' || task === 'study' ? 'medium' : 'low';
}

// Tope de tokens que se manda al proveedor: lo pedido mas el margen del razonamiento (si lo hay), sin pasar de MAX_OUTPUT_CEILING.
// Sin razonamiento (effort null) no se toca. Un valor pedido invalido (no finito o < 1) se trata como 1.
export function effectiveMaxTokens(requested: number, effort: ReasoningEffort | null): number {
  const base = Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : 1;
  if (!effort) return base;
  return Math.min(base + HEADROOM[effort], Math.max(base, MAX_OUTPUT_CEILING));
}
