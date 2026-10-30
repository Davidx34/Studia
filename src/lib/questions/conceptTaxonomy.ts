// Fase 1.2 (post-auditoria, Protocolo 7.6): taxonomia cerrada de conceptos
// por modulo.
//
// Problema: cada pregunta generada trae su propio concept_tag "libre" (el
// LLM inventa el snake_case en el momento). Dos corridas de generacion para
// el MISMO modulo terminan con variantes del mismo concepto
// ("condiciones_primer_orden_lagrange" vs "cpo_lagrange" vs
// "lagrange_condiciones"), lo que rompe la agregacion por concepto en
// question_attempts/progress_analytics (migracion 020) y por tanto el
// reporte de brechas que ve el profesor.
//
// Solucion: antes de generar preguntas para un modulo por primera vez, se
// le pide al LLM una lista cerrada de 5-10 conceptos candidatos (tag +
// label legible) anclados al material real, se persiste en
// classroom_concepts (migracion 039), y esa lista cerrada se reinyecta en
// CADA prompt de generacion posterior para ese modulo con instruccion
// explicita de usar EXACTAMENTE uno de esos tags.

import { getRagContext } from './cohereGeneration';
import { routeText, chainWithCohere } from '@/lib/ai/gateway';

export interface ClosedConcept {
  tag: string;
  label: string;
}

// snake_case en español sin tildes/mayusculas -- mismo criterio que ya
// documentaba (sin validar) el prompt de generate-questions.
const CONCEPT_TAG_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

// Lee la lista de conceptos de la respuesta del modelo. null = no hay una lista utilizable (ni JSON, ni un solo concepto valido).
export function parseConcepts(text: string): ClosedConcept[] | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const raw = Array.isArray(parsed.concepts) ? parsed.concepts : [];
    const concepts: ClosedConcept[] = raw
      .filter((c: any) => c && typeof c.tag === 'string' && typeof c.label === 'string')
      .map((c: any) => ({ tag: c.tag.trim().toLowerCase(), label: c.label.trim() }))
      .filter((c: ClosedConcept) => CONCEPT_TAG_RE.test(c.tag) && c.label.length > 0);
    return concepts.length > 0 ? concepts : null;
  } catch {
    return null;
  }
}

// Pide los conceptos por la pasarela de IA: Cohere primero y, si no responde o no devuelve una lista utilizable, el resto de la cadena "analysis". Nunca
// lanza: la taxonomia es una mejora, no puede tumbar la generacion de preguntas.
async function callCohereForConcepts(prompt: string): Promise<ClosedConcept[] | null> {
  const chain = chainWithCohere('analysis', 'first');
  if (chain.length === 0) return null;
  const r = await routeText<ClosedConcept[]>({
    task: 'analysis',
    prompt,
    maxTokens: 1500,
    temperature: 0.3,
    timeoutMs: 60_000,
    chain,
    validate: (text) => {
      const concepts = parseConcepts(text);
      return concepts ? { value: concepts, quality: 1 } : null;
    },
  });
  return r.ok ? r.value : null;
}

// Devuelve la lista cerrada de conceptos del modulo, generandola (y
// persistiendola) la primera vez que se invoca para ese modulo. Nunca
// lanza: ante cualquier falla (sin API key, Cohere caido, JSON invalido)
// devuelve [] y el llamador cae al comportamiento anterior (concept_tag
// libre) -- la taxonomia cerrada es una mejora, no debe poder bloquear la
// generacion de preguntas del piloto.
//
// Seguro ante llamadas concurrentes: la UNIQUE(module_id, tag) en
// classroom_concepts + upsert con ignoreDuplicates descarta colisiones si
// dos requests generan candidatos en paralelo la primera vez (puede pasar
// porque /api/generate-questions corre tanto con sesion de profesor como
// de estudiante, y el flujo incremental se dispara desde la leccion).
export async function getOrCreateModuleConcepts(
  supabase: any,
  moduleId: string,
  moduleTitle: string
): Promise<ClosedConcept[]> {
  const { data: existing } = await supabase
    .from('classroom_concepts')
    .select('tag, label')
    .eq('module_id', moduleId);

  if (existing && existing.length > 0) return existing;

  const { data: moduleRow } = await supabase
    .from('content_modules')
    .select('classroom_id, description')
    .eq('id', moduleId)
    .single();
  if (!moduleRow) return [];

  const context = await getRagContext(supabase, moduleId);
  if (!context) return []; // sin material aun -- no inventar taxonomia sin anclaje

  const prompt = `Eres un profesor experto disenando la taxonomia de conceptos evaluables de un modulo.

TEMA DEL MODULO: ${moduleTitle}
DESCRIPCION: ${moduleRow.description || ''}

CONTENIDO DEL MATERIAL:
${context.substring(0, 4000)}

Identifica entre 5 y 10 conceptos ESPECIFICOS y evaluables de este material (no el tema general del modulo, sino sub-conceptos concretos que un examen distinguiria por separado). Para cada uno da:
- "tag": identificador snake_case corto en espanol, sin tildes ni mayusculas (ej: "condiciones_primer_orden", "demanda_marshaliana")
- "label": nombre legible corto (ej: "Condiciones de primer orden (Lagrange)")

No generes conceptos redundantes entre si. Responde SOLO con JSON valido:
{"concepts":[{"tag":"...","label":"..."}, ...]}`;

  const candidates = await callCohereForConcepts(prompt);
  if (!candidates || candidates.length === 0) return [];

  const seen = new Set<string>();
  const deduped = candidates.filter((c) => {
    if (seen.has(c.tag)) return false;
    seen.add(c.tag);
    return true;
  });

  const rows = deduped.map((c) => ({
    classroom_id: moduleRow.classroom_id,
    module_id: moduleId,
    tag: c.tag,
    label: c.label,
  }));

  await supabase
    .from('classroom_concepts')
    .upsert(rows, { onConflict: 'module_id,tag', ignoreDuplicates: true });

  const { data: final } = await supabase
    .from('classroom_concepts')
    .select('tag, label')
    .eq('module_id', moduleId);

  return final && final.length > 0 ? final : deduped;
}

// Bloque de instruccion que reemplaza al CONCEPT_TAG "libre" cuando ya hay
// taxonomia cerrada para el modulo. Si concepts esta vacio, el llamador
// debe usar el texto original (fallback), nunca bloquear la generacion.
export function conceptTaxonomyPromptBlock(concepts: ClosedConcept[]): string {
  if (!concepts || concepts.length === 0) return '';
  const list = concepts.map((c) => `- ${c.tag} (${c.label})`).join('\n');
  return `CONCEPT_TAG (obligatorio en cada pregunta): usa EXACTAMENTE uno de estos tags de la lista cerrada -- NO inventes uno nuevo, NO uses una variante de redaccion distinta:\n${list}`;
}
