// Fase 1.3 (post-auditoria, Protocolos 7.3 simplificado + 7.5): juez LLM
// asincrono sobre preguntas ya generadas.
//
// Corre DESPUES de la generacion bulk (nunca bloquea al estudiante/profesor
// mientras se genera): revisa cada pregunta con una rubrica fija y devuelve
// un veredicto. Usa Gemini Flash a proposito -- un proveedor DISTINTO al
// generador (Cohere/Aya) -- para no heredar el mismo sesgo de "esto se ve
// bien" que tendria el mismo modelo evaluando su propio trabajo.

// gemini-2.0-flash devolvia 429 RESOURCE_EXHAUSTED con limit:0 en la
// verificacion en vivo (Sesion L, corrida real sobre Microeconomia I) --
// no es cuota agotada por uso, esa key nunca tuvo acceso free tier a ese
// modelo especifico. gemini-2.5-flash SI respondio correctamente con la
// misma key (verificado con una llamada directa). Mismo modelo que ya usa
// textProcessing.ts para deteccion de temas, asi que el proyecto ya
// depende de que este disponible.
const GEMINI_FLASH_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export type JudgeVerdict = 'pass' | 'fail' | 'review';

export interface JudgeResult {
  verdict: JudgeVerdict;
  reason: string;
}

// Rubrica deliberadamente concreta y falsable ("¿esto se puede verificar
// contra el texto?"), no "¿es esta pregunta buena?" -- un LLM-juez con
// criterios vagos tiende a aprobar casi todo o a ser arbitrariamente
// estricto. Los criterios 1/2 (ancorage y respuesta unica) son los que
// determinan fail -- son objetivamente verificables contra el material
// fuente. 3/4/5 determinan review -- son mas de juicio, un humano decide.
// Exportada junto con questionToText para que scripts/judge-local.ts (juez
// offline sobre Ollama, para no depender de la cuota gratuita de Gemini)
// pueda reusar exactamente la misma rubrica y formato de pregunta sin
// duplicarlos -- un cambio a la rubrica aplica a ambos jueces automaticamente.
export const RUBRIC = `Evalua cada pregunta de evaluacion educativa contra estos criterios:

1. ANCLAJE: la pregunta y su respuesta correcta se pueden verificar contra el MATERIAL FUENTE dado (no inventa datos que no estan ahi).
2. RESPUESTA UNICA: para multiple_choice/true_false, exactamente una opcion es correcta sin ambiguedad; para fill_blank/short_answer, la respuesta esperada es especifica y verificable.
3. SIN PISTAS ACCIDENTALES: los distractores (opciones incorrectas) son plausibles, no obviamente falsos por redaccion (ej: mucho mas largos/cortos que la correcta, o con errores gramaticales que los delatan).
4. CLARIDAD: el enunciado es comprensible sin ambiguedad de interpretacion.
5. NIVEL: la dificultad es razonable para el nivel declarado (no trivial, no imposible sin el material).

Da un veredicto por pregunta:
- "pass": cumple los 5 criterios.
- "fail": viola el criterio 1 o 2 (dato inventado, o respuesta ambigua/incorrecta) -- estos son los mas graves, nunca deben llegar al estudiante.
- "review": viola 3, 4 o 5 pero no 1/2 -- probablemente utilizable pero conviene que un humano lo confirme.`;

export function questionToText(q: any): string {
  const parts = [`Tipo: ${q.type}`, `Pregunta: ${q.q}`];
  if (q.opts) parts.push(`Opciones: ${JSON.stringify(q.opts)}`);
  if (q.ok !== null && q.ok !== undefined) parts.push(`Respuesta correcta (indice/bool): ${JSON.stringify(q.ok)}`);
  if (q.answers) parts.push(`Respuestas aceptadas: ${JSON.stringify(q.answers)}`);
  if (q.pairs) parts.push(`Pares: ${JSON.stringify(q.pairs)}`);
  if (q.keywords) parts.push(`Palabras clave esperadas: ${JSON.stringify(q.keywords)}`);
  if (q.exp) parts.push(`Explicacion: ${q.exp}`);
  return parts.join('\n');
}

async function callGemini(prompt: string, retries: number): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${GEMINI_BASE_URL}/models/${GEMINI_FLASH_MODEL}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
      });
      if (!res.ok) {
        if (res.status === 429 && attempt < retries) {
          await new Promise((r) => setTimeout(r, 2500 * (attempt + 1) + Math.floor(Math.random() * 500)));
          continue;
        }
        return null;
      }
      const data = await res.json();
      return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      return null;
    }
  }
  return null;
}

// Juzga UNA pregunta con UNA llamada a Gemini. Se mantiene exportada para
// reuso puntual, pero el camino principal (judgeQuestionsBatch) ya NO la
// usa por pregunta -- la usa solo como fallback cuando un lote completo
// falla al parsear (ver mas abajo), para no perder ese lote entero por un
// problema de formato en la respuesta.
export async function judgeQuestion(question: any, sourceMaterial: string, retries = 2): Promise<JudgeResult | null> {
  const prompt = `${RUBRIC}

Responde SOLO con JSON: {"verdict":"pass|fail|review","reason":"una frase corta explicando el motivo"}

MATERIAL FUENTE:
${(sourceMaterial || '').substring(0, 4000)}

PREGUNTA A EVALUAR:
${questionToText(question)}`;

  const text = await callGemini(prompt, retries);
  if (!text) return null;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!['pass', 'fail', 'review'].includes(parsed.verdict)) return null;
    return { verdict: parsed.verdict, reason: String(parsed.reason || '').slice(0, 500) };
  } catch {
    return null;
  }
}

// Cuota gratuita real de gemini-2.5-flash: 20 requests/dia (verificado en
// vivo, HTTP 429 con quotaValue:"20"). Antes, judgeQuestionsBatch hacia UNA
// llamada por pregunta -- con un pool tipico de ~20-30 preguntas por
// modulo, un solo modulo agotaba el dia entero, y un curso de 18 modulos
// (Microeconomia I) necesitaba ~130-270 requests para juzgar el pool
// completo, dejando la enorme mayoria en "human_review" no por veredicto
// sino por rate limit. BATCH_SIZE agrupa varias preguntas en una sola
// llamada: con 8 preguntas por lote, ese mismo pool de 130-270 preguntas
// necesita ~17-34 requests -- factible en 1-2 dias en vez de nunca.
const BATCH_SIZE = 8;
const BATCH_CONCURRENCY = 3;

function buildBatchPrompt(batch: any[], sourceMaterial: string): string {
  const numbered = batch
    .map((q, i) => `### PREGUNTA ${i + 1}\n${questionToText(q)}`)
    .join('\n\n');
  return `${RUBRIC}

Vas a evaluar VARIAS preguntas en una sola pasada. Da un veredicto independiente para CADA una -- no dejes que el veredicto de una pregunta influya en el de otra.

Responde SOLO con JSON: {"verdicts":[{"index":1,"verdict":"pass|fail|review","reason":"una frase corta"}, ...]} -- un objeto por cada pregunta, en el mismo orden, con "index" igual al numero de PREGUNTA (1-based). Debe haber EXACTAMENTE ${batch.length} objetos en el array.

MATERIAL FUENTE:
${(sourceMaterial || '').substring(0, 6000)}

${numbered}`;
}

// Exportada para testear el parseo/reconciliacion de indices de forma
// aislada (sin red) -- es la pieza mas fragil de todo el cambio de
// batching: si el LLM devuelve el array desordenado, con un index fuera
// de rango, o con menos/mas objetos de los pedidos, esta funcion es la
// unica barrera antes de asignarle un veredicto incorrecto a la pregunta
// equivocada.
export function parseBatchResponse(text: string, expectedCount: number): (JudgeResult | null)[] | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.verdicts) || parsed.verdicts.length !== expectedCount) return null;
    const byIndex = new Map<number, JudgeResult>();
    for (const v of parsed.verdicts) {
      if (!['pass', 'fail', 'review'].includes(v?.verdict)) continue;
      byIndex.set(v.index, { verdict: v.verdict, reason: String(v.reason || '').slice(0, 500) });
    }
    // Reconstruye en orden 1..expectedCount; un indice faltante/invalido en
    // la respuesta se traduce en null para esa posicion (no descarta el
    // resto del lote).
    return Array.from({ length: expectedCount }, (_, i) => byIndex.get(i + 1) ?? null);
  } catch {
    return null;
  }
}

// Juzga un lote (BATCH_SIZE preguntas) con UNA sola llamada a Gemini. Si la
// respuesta no se puede parsear (formato invalido, conteo no coincide) tras
// los reintentos, cae a judgeQuestion() individual SOLO para ese lote --
// bounded worst-case: nunca peor que el comportamiento anterior, pero solo
// se paga ese costo en el caso raro de fallo de formato.
async function judgeBatch(batch: any[], sourceMaterial: string): Promise<(JudgeResult | null)[]> {
  const prompt = buildBatchPrompt(batch, sourceMaterial);
  const text = await callGemini(prompt, 2);
  if (text) {
    const parsed = parseBatchResponse(text, batch.length);
    if (parsed) return parsed;
  }
  console.warn(`[judgeBatch] lote de ${batch.length} fallo el parseo, cayendo a evaluacion individual (fallback)`);
  return Promise.all(batch.map((q) => judgeQuestion(q, sourceMaterial)));
}

export async function judgeQuestionsBatch(
  questions: any[],
  sourceMaterial: string
): Promise<Map<string, JudgeResult | null>> {
  const results = new Map<string, JudgeResult | null>();
  if (questions.length === 0) return results;

  const batches: any[][] = [];
  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    batches.push(questions.slice(i, i + BATCH_SIZE));
  }

  let idx = 0;
  async function worker() {
    while (idx < batches.length) {
      const i = idx++;
      const batch = batches[i];
      const verdicts = await judgeBatch(batch, sourceMaterial);
      batch.forEach((q, j) => results.set(q.id, verdicts[j] ?? null));
    }
  }
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, batches.length) }, worker));
  return results;
}
