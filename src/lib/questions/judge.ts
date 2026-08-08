// Fase 1.3 (post-auditoria, Protocolos 7.3 simplificado + 7.5): juez LLM
// asincrono sobre preguntas ya generadas.
//
// Corre DESPUES de la generacion bulk (nunca bloquea al estudiante/profesor
// mientras se genera): revisa cada pregunta con una rubrica fija y devuelve
// un veredicto. Usa Gemini Flash a proposito -- un proveedor DISTINTO al
// generador (Cohere/Aya) -- para no heredar el mismo sesgo de "esto se ve
// bien" que tendria el mismo modelo evaluando su propio trabajo.

const GEMINI_FLASH_MODEL = 'gemini-2.0-flash';
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

export async function judgeQuestion(question: any, sourceMaterial: string): Promise<JudgeResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `${RUBRIC}

MATERIAL FUENTE:
${(sourceMaterial || '').substring(0, 4000)}

PREGUNTA A EVALUAR:
${questionToText(question)}`;

  try {
    const res = await fetch(`${GEMINI_BASE_URL}/models/${GEMINI_FLASH_MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!['pass', 'fail', 'review'].includes(parsed.verdict)) return null;
    return { verdict: parsed.verdict, reason: String(parsed.reason || '').slice(0, 500) };
  } catch {
    return null;
  }
}

// Corre el juez sobre una lista de preguntas con concurrencia limitada (no
// Promise.all sin limite -- 20-40 preguntas en paralelo contra Gemini
// dispara rate limiting; no secuencial puro -- por modulo puede haber
// suficientes preguntas como para acercarse al timeout de una funcion
// serverless). CONCURRENCY=5 es conservador a proposito para el piloto.
const CONCURRENCY = 5;

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
