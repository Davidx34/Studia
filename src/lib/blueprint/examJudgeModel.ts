// El modelo del juez: la tarea `judge` del gateway de IA, SIN Cohere (que es el que escribe las preguntas: un modelo que se juzga a si mismo hereda sus mismos errores). Si el unico
// proveedor disponible fuera Cohere, no hay juez (devuelve null) y quien lo llame lo trata como "sin juzgar", nunca como "aprobado".

import { chainFor } from '@/lib/ai/gateway/providers';
import { routeText } from '@/lib/ai/gateway/router';
import type { ModelCaller } from './examJudge';

export const hasJudgeProvider = (env: Record<string, string | undefined> = process.env): boolean => chainFor('judge', env).some((c) => c.provider !== 'cohere');

export const callJudgeModel: ModelCaller = async (prompt) => {
  if (!hasJudgeProvider()) return null;
  const r = await routeText<string>({
    task: 'judge',
    prompt,
    maxTokens: 1500,
    temperature: 0,
    json: true,
    exclude: ['cohere'],
    validate: (text) => (text.trim() ? { value: text, quality: 1 } : null),
  });
  if (!r.ok) {
    console.warn(`[exam-judge] sin proveedor utilizable (${r.reason})`);
    return null;
  }
  return r.value;
};
