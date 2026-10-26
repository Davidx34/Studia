// MIDE modelos de Gemini en TU llave: tiempo de respuesta, tokens (incluidos los de "pensar", que se cobran como salida) y si devuelven
// JSON valido. Sirve para decidir con datos y para REPETIR la medicion cuando cambia algo (por ejemplo, al activar la facturacion).
//
//   npm run ai:probe -- gemini-3.5-flash-lite gemini-3.5-flash            (3 pruebas de cada tipo por modelo)
//   npm run ai:probe -- gemini-3.5-flash-lite --runs 5
//
// Dos pruebas: "juez" (peticion corta, JSON corto) y "generar" (8 preguntas de opcion multiple sobre un texto de Calculo). Cada una
// gasta una peticion de tu cuota. Nunca imprime la llave. Los precios NO se calculan aqui: cambian y hay que mirarlos en Google.

import { thinkingConfigFor } from '../src/lib/ai/geminiModels';

const args = process.argv.slice(2);
const runsIdx = args.indexOf('--runs');
const runs = runsIdx >= 0 ? Math.max(1, Number(args[runsIdx + 1]) || 3) : 3;
const models = args.filter((a, i) => !a.startsWith('--') && i !== runsIdx + 1);
const key = process.env.GEMINI_API_KEY;

if (!key || models.length === 0) {
  console.log('Uso: npm run ai:probe -- <modelo> [<modelo>...] [--runs N]\nNecesita GEMINI_API_KEY en .env.local.');
  process.exit(1);
}

const JUDGE_PROMPT =
  'Evalua esta pregunta de Calculo. Pregunta: "Cual es la derivada de x^2?" Opciones: A) 2x B) x C) x^2 D) 2. Correcta: A. Responde SOLO JSON: {"verdict":"pass|fail|review","reason":"una frase"}';

const MATERIAL =
  'La derivada de f en a mide la razon de cambio instantanea y es el limite del cociente incremental f\'(a)=lim_{h->0}(f(a+h)-f(a))/h. Geometricamente es la pendiente de la recta tangente. Reglas: (x^n)\'=n x^(n-1); (fg)\'=f\'g+fg\'; (f/g)\'=(f\'g-fg\')/g^2; regla de la cadena (f(g(x)))\'=f\'(g(x))g\'(x). Derivadas: (sen x)\'=cos x; (e^x)\'=e^x; (ln x)\'=1/x. Derivable implica continua, pero no al reves: |x| es continua en 0 y no derivable. Puntos criticos: f\'(x)=0 o f\' no existe; la primera derivada clasifica extremos y la segunda indica concavidad.';
const GEN_PROMPT = `Eres un docente de Calculo. Con base SOLO en este material, genera 8 preguntas de opcion multiple de nivel universitario, con 4 opciones, una correcta, distractores plausibles y una explicacion breve. Responde SOLO JSON: {"questions":[{"q":"...","opts":["...","...","...","..."],"ok":0,"exp":"..."}]}\n\nMATERIAL:\n${MATERIAL}`;

type Kind = 'juez' | 'generar';
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function one(model: string, kind: Kind) {
  const t0 = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: kind === 'juez' ? JUDGE_PROMPT : GEN_PROMPT }] }],
      generationConfig: { temperature: kind === 'juez' ? 0 : 0.7, responseMimeType: 'application/json', maxOutputTokens: kind === 'juez' ? 700 : 6000, ...thinkingConfigFor(model) },
    }),
    signal: AbortSignal.timeout(120_000),
  }).catch(() => null);
  const ms = Date.now() - t0;
  if (!res) return { ok: false as const, ms, status: 0 };
  const body: any = await res.json().catch(() => null);
  if (!res.ok) return { ok: false as const, ms, status: res.status, why: String(body?.error?.message ?? '').slice(0, 90).replace(/[A-Za-z0-9_-]{28,}/g, '[..]') };
  const text: string = body?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
  let valid = false;
  try {
    const j = JSON.parse(text);
    valid = kind === 'juez' ? ['pass', 'fail', 'review'].includes(j.verdict) : Array.isArray(j.questions) && j.questions.length === 8 && j.questions.every((q: any) => q.q && Array.isArray(q.opts) && q.opts.length === 4 && Number.isInteger(q.ok) && q.exp);
  } catch {
    valid = false;
  }
  const u = body?.usageMetadata ?? {};
  return { ok: true as const, ms, status: 200, valid, input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, thinking: u.thoughtsTokenCount ?? 0 };
}

async function main() {
  console.log(`Modelo                  prueba    ok  mediana     entrada  salida  pensar  JSON valido`);
  for (const model of models) {
    for (const kind of ['juez', 'generar'] as Kind[]) {
      const results = [];
      for (let i = 0; i < runs; i++) results.push(await one(model, kind));
      const good = results.filter((r) => r.ok) as Extract<(typeof results)[number], { ok: true }>[];
      const errs = results.filter((r) => !r.ok) as Extract<(typeof results)[number], { ok: false }>[];
      const line = good.length
        ? `${String(good.length + '/' + runs).padEnd(5)} ${(median(good.map((r) => r.ms)) / 1000).toFixed(1).padStart(6)} s  ${String(median(good.map((r) => r.input))).padStart(8)}  ${String(median(good.map((r) => r.output))).padStart(6)}  ${String(median(good.map((r) => r.thinking))).padStart(6)}  ${good.filter((r) => r.valid).length}/${good.length}`
        : `0/${runs}`;
      console.log(`${model.padEnd(23)} ${kind.padEnd(8)} ${line}`);
      for (const e of errs.slice(0, 1)) console.log(`${' '.repeat(33)}error HTTP ${e.status}${e.why ? ': ' + e.why : ''}`);
    }
  }
  console.log('\nOjo: los tokens de "pensar" se cobran como salida. Si el tiempo cambia al activar la facturacion, repite esta medicion.');
}

main().catch((e) => {
  console.error('FALLO:', e instanceof Error ? e.message.replace(key!, '[CLAVE]') : String(e));
  process.exitCode = 1;
});
