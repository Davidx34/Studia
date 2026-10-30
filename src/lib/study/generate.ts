// Generacion de fichas de lectura y flashcards a partir del Markdown del material.
// Cohere primero, OpenRouter de respaldo (mismo patron que la generacion de preguntas). El orquestador recibe la
// funcion que llama al modelo para poder probarlo sin red.

import { callOpenRouter, isOpenRouterConfigured } from '@/lib/ai/openrouter';
import { sanitizeLogged } from '@/lib/security/promptSanitizer';
import type { ChunkGroup } from './grouping';
import { extractJsonObject, validateGroupCards, type FichaCard, type FlashCard } from './validate';

export type ModelCaller = (prompt: string) => Promise<string | null>;

export function buildStudyPrompt(group: ChunkGroup, materialName: string): string {
  return `Eres un tutor que prepara material de estudio para estudiantes a partir de UN fragmento de sus apuntes.
Material: "${sanitizeLogged(materialName, 'study.generate:nombre', { maxChars: 120 })}"${group.section ? `\nSeccion: "${sanitizeLogged(group.section, 'study.generate:seccion', { maxChars: 160 })}"` : ''}

REGLAS
- Usa SOLO informacion que este en el fragmento. No agregues datos, definiciones ni ejemplos de tu propio conocimiento.
- Escribe en espanol claro, con las mismas palabras tecnicas del fragmento.
- Cada pregunta de las flashcards debe entenderse sola (sin "segun el texto" ni "en el fragmento").
- Respuestas de flashcard breves: una o dos oraciones.
- Si el fragmento tiene formulas, conservalas en LaTeX entre $...$ y escribe cada barra invertida DOBLE dentro del JSON (\\\\frac).
- Entre 5 y 8 flashcards que cubran ideas distintas. Sin preguntas repetidas.

Responde SOLO con un JSON valido, sin explicacion, con esta forma exacta:
{"ficha":{"titulo":"...","idea_principal":"...","puntos_clave":["...","..."],"terminos":[{"termino":"...","definicion":"..."}],"pregunta_reflexion":"..."},"flashcards":[{"pregunta":"...","respuesta":"..."}]}

FRAGMENTO
${sanitizeLogged(group.text, 'study.generate')}`;
}

export interface GeneratedCards {
  fichas: (FichaCard & { section: string | null })[];
  flashcards: (FlashCard & { section: string | null })[];
  groupsOk: number;
  groupsFailed: number;
  // Por que fallaron los bloques que fallaron (para decirselo al profesor con claridad):
  //  - noResponse: el modelo no contesto (limite de uso, conexion, sin llave)
  //  - rejected:   contesto, pero nada paso la verificacion contra el material (formato roto o contenido ajeno)
  //  - skipped:    no se alcanzo a procesar por el limite de tiempo
  noResponse: number;
  rejected: number;
  skipped: number;
}

export type GroupOutcome = { cards: NonNullable<ReturnType<typeof validateGroupCards>> } | { reason: 'noResponse' | 'rejected' };

// Hasta 2 intentos por bloque: un JSON mal formado o un bloque sin tarjetas validas suele resolverse al reintentar.
const ATTEMPTS = 2;

async function generateForGroup(group: ChunkGroup, materialName: string, call: ModelCaller): Promise<GroupOutcome> {
  let answered = false;
  for (let i = 0; i < ATTEMPTS; i++) {
    const text = await call(buildStudyPrompt(group, materialName));
    if (!text) continue;
    answered = true;
    const parsed = extractJsonObject(text);
    if (!parsed) continue;
    const cards = validateGroupCards(parsed, group.text);
    if (cards.ficha || cards.flashcards.length > 0) return { cards };
  }
  return { reason: answered ? 'rejected' : 'noResponse' };
}

export async function generateStudyCards(
  groups: ChunkGroup[],
  materialName: string,
  call: ModelCaller,
  concurrency = 2,
  deadline: number = Infinity
): Promise<GeneratedCards> {
  const results: ({ group: ChunkGroup; outcome: GroupOutcome | 'skipped' } | null)[] = new Array(groups.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (true) {
      const idx = next++;
      if (idx >= groups.length) return;
      // La funcion tiene un tope de tiempo: mejor guardar lo logrado que perderlo todo al cortarse.
      if (Date.now() > deadline) {
        results[idx] = { group: groups[idx], outcome: 'skipped' };
        continue;
      }
      results[idx] = { group: groups[idx], outcome: await generateForGroup(groups[idx], materialName, call) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, worker));

  const out: GeneratedCards = { fichas: [], flashcards: [], groupsOk: 0, groupsFailed: 0, noResponse: 0, rejected: 0, skipped: 0 };
  for (const r of results) {
    if (!r) continue;
    if (r.outcome === 'skipped') {
      out.groupsFailed++;
      out.skipped++;
    } else if ('reason' in r.outcome) {
      out.groupsFailed++;
      out[r.outcome.reason]++;
    } else {
      out.groupsOk++;
      const section = r.group.section;
      if (r.outcome.cards.ficha) out.fichas.push({ ...r.outcome.cards.ficha, section });
      for (const f of r.outcome.cards.flashcards) out.flashcards.push({ ...f, section });
    }
  }
  return out;
}

// ── Llamada real al modelo ──
const COHERE_TIMEOUT_MS = 90_000;

async function callCohereText(prompt: string): Promise<string | null> {
  const key = process.env.COHERE_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://api.cohere.com/v2/chat', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'c4ai-aya-expanse-32b', messages: [{ role: 'user', content: prompt }], max_tokens: 4096, temperature: 0.3 }),
      signal: AbortSignal.timeout(COHERE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[study] Cohere HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.message?.content?.[0]?.text || null;
  } catch (e: any) {
    console.warn(`[study] Cohere fallo: ${e?.name === 'TimeoutError' ? 'timeout' : String(e?.message ?? e)}`);
    return null;
  }
}

export function hasStudyProvider(): boolean {
  return !!process.env.COHERE_API_KEY || isOpenRouterConfigured();
}

export const callStudyModel: ModelCaller = async (prompt) => {
  const fromCohere = await callCohereText(prompt);
  if (fromCohere) return fromCohere;
  if (!isOpenRouterConfigured()) return null;
  const alt = await callOpenRouter(prompt, { role: 'generation', maxTokens: 4000, temperature: 0.3 });
  if (alt.ok) {
    console.log(`[LLM_FALLBACK] fichas servidas por OpenRouter (${alt.model})`);
    return alt.text;
  }
  console.warn(`[study] OpenRouter fallo: ${alt.reason}`);
  return null;
};
