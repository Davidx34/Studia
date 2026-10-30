// Generacion de fichas de lectura y flashcards a partir del Markdown del material.
// Cohere primero y el resto de la pasarela de IA de respaldo (mismo patron que la generacion de preguntas). El orquestador recibe la
// funcion que llama al modelo para poder probarlo sin red.

import { routeText, describeAttempts, hasProviderFor, chainWithCohere } from '@/lib/ai/gateway';
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
// Por la pasarela de IA: Cohere va primero (como siempre) y, si no responde, siguen los proveedores de la cadena "study" (Cerebras, Groq, Mistral,
// OpenRouter... lo que tenga llave) con cortacircuito y orden adaptativo. Antes eran dos llamadas a mano (Cohere y OpenRouter) sin cortacircuito.
export function hasStudyProvider(): boolean {
  return !!process.env.COHERE_API_KEY || hasProviderFor('study');
}

export const callStudyModel: ModelCaller = async (prompt) => {
  const chain = chainWithCohere('study', 'first');
  if (chain.length === 0) return null;
  const r = await routeText<string>({
    task: 'study',
    prompt,
    maxTokens: 4096,
    temperature: 0.3,
    chain,
    validate: (text) => (text.trim() ? { value: text, quality: 1 } : null),
  });
  if (!r.ok) {
    console.warn(`[study] sin proveedor utilizable (${r.reason}): ${describeAttempts(r.attempts)}`);
    return null;
  }
  if (r.provider !== 'cohere') console.log(`[LLM_FALLBACK] fichas servidas por ${r.provider}/${r.model}`);
  return r.value;
};
