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
const RUBRIC = `Evalua esta pregunta de evaluacion educativa contra estos criterios:

1. ANCLAJE: la pregunta y su respuesta correcta se pueden verificar contra el MATERIAL FUENTE dado (no inventa datos que no estan ahi).
2. RESPUESTA UNICA: para multiple_choice/true_false, exactamente una opcion es correcta sin ambiguedad; para fill_blank/short_answer, la respuesta esperada es especifica y verificable.
3. SIN PISTAS ACCIDENTALES: los distractores (opciones incorrectas) son plausibles, no obviamente falsos por redaccion (ej: mucho mas largos/cortos que la correcta, o con errores gramaticales que los delatan).
4. CLARIDAD: el enunciado es comprensible sin ambiguedad de interpretacion.
5. NIVEL: la dificultad es razonable para el nivel declarado (no trivial, no imposible sin el material).

Da un veredicto:
- "pass": cumple los 5 criterios.
- "fail": viola el criterio 1 o 2 (dato inventado, o respuesta ambigua/incorrecta) -- estos son los mas graves, nunca deben llegar al estudiante.
- "review": viola 3, 4 o 5 pero no 1/2 -- probablemente utilizable pero conviene que un humano lo confirme.

Responde SOLO con JSON: {"verdict":"pass|fail|review","reason":"una frase corta explicando el motivo"}`;

function questionToText(q: any): string {
  const parts = [`Tipo: ${q.type}`, `Pregunta: ${q.q}`];
  if (q.opts) parts.push(`Opciones: ${JSON.stringify(q.opts)}`);
  if (q.ok !== null && q.ok !== undefined) parts.push(`Respuesta correcta (indice/bool): ${JSON.stringify(q.ok)}`);
  if (q.answers) parts.push(`Respuestas aceptadas: ${JSON.stringify(q.answers)}`);
  if (q.pairs) parts.push(`Pares: ${JSON.stringify(q.pairs)}`);
  if (q.keywords) parts.push(`Palabras clave esperadas: ${JSON.stringify(q.keywords)}`);
  if (q.exp) parts.push(`Explicacion: ${q.exp}`);
  return parts.join('\n');
}

// Reintenta ante 429 (rate limit transitorio del free tier de Gemini,
// esperable con concurrencia real sobre 10-20+ preguntas por modulo) antes
// de rendirse. Antes un solo 429 mandaba la pregunta a human_review sin
// reintentar — en la verificacion en vivo (Sesion L) esto causo que 2 de 6
// modulos quedaran con 0 preguntas juzgadas por rate limiting, no por
// veredicto real.
export async function judgeQuestion(question: any, sourceMaterial: string, retries = 2): Promise<JudgeResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `${RUBRIC}

MATERIAL FUENTE:
${(sourceMaterial || '').substring(0, 4000)}

PREGUNTA A EVALUAR:
${questionToText(question)}`;

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
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      if (!['pass', 'fail', 'review'].includes(parsed.verdict)) return null;
      return { verdict: parsed.verdict, reason: String(parsed.reason || '').slice(0, 500) };
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

// Corre el juez sobre una lista de preguntas con concurrencia limitada (no
// Promise.all sin limite -- 20-40 preguntas en paralelo contra Gemini
// dispara rate limiting; no secuencial puro -- por modulo puede haber
// suficientes preguntas como para acercarse al timeout de una funcion
// serverless). Bajado de 5 a 3 tras la verificacion en vivo (Sesion L):
// con CONCURRENCY=5 y sin retry, 2 de 6 modulos de Microeconomia
// terminaron con 0 preguntas juzgadas por 429 en cascada. Combinado con
// el retry agregado en judgeQuestion, 3 deja margen real.
const CONCURRENCY = 3;

export async function judgeQuestionsBatch(
  questions: any[],
  sourceMaterial: string
): Promise<Map<string, JudgeResult | null>> {
  const results = new Map<string, JudgeResult | null>();
  let idx = 0;
  async function worker() {
    while (idx < questions.length) {
      const i = idx++;
      const q = questions[i];
      results.set(q.id, await judgeQuestion(q, sourceMaterial));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, questions.length) }, worker));
  return results;
}
