import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

const MIN_CACHE_SIZE = 5; // debajo de esto, todavia se sirve del cache si alcanza
const SERVE_COUNT = 5; // preguntas que ve el estudiante por leccion
const GENERATE_COUNT = 10; // preguntas generadas por llamada a Cohere (puebla el cache mas rapido)

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Convierte una fila de lesson_questions al shape que espera el render de la leccion.
function rowToQuestion(row: any) {
  const q: any = { type: row.type, q: row.q, exp: row.exp };
  if (row.opts) q.opts = row.opts;
  if (row.ok !== null && row.ok !== undefined) q.ok = row.ok;
  if (row.answers) q.answers = row.answers;
  if (row.pairs) q.pairs = row.pairs;
  if (row.keywords) q.keywords = row.keywords;
  return q;
}

export async function POST(req: NextRequest) {
  try {
    const { moduleId, context, moduleTitle, aiConfig } = await req.json();

    // 1. Intentar servir del cache (rapido, sin llamar a Cohere).
    if (moduleId) {
      const supabase = await createServerSupabase();
      const { data: cached } = await supabase
        .from('lesson_questions')
        .select('*')
        .eq('module_id', moduleId);

      if (cached && cached.length >= MIN_CACHE_SIZE) {
        const picked = shuffle(cached).slice(0, SERVE_COUNT).map(rowToQuestion);
        return NextResponse.json({ questions: picked, cached: true });
      }
    }

    // 2. Cache insuficiente (o sin moduleId): generar con Cohere como antes.
    const COHERE_API_KEY = process.env.COHERE_API_KEY;
    if (!COHERE_API_KEY) return NextResponse.json({ error: 'No API key' }, { status: 500 });

    const skills = [];
    if (aiConfig?.skill_memory) skills.push('recordar hechos');
    if (aiConfig?.skill_comprehension) skills.push('comprender conceptos');
    if (aiConfig?.skill_application) skills.push('aplicar conocimiento');
    if (aiConfig?.skill_analysis) skills.push('analizar y descomponer');
    if (aiConfig?.skill_synthesis) skills.push('sintetizar ideas');
    if (aiConfig?.skill_evaluation) skills.push('evaluar criticamente');

    const types = [];
    if (aiConfig?.type_multiple_choice) types.push('opcion_multiple');
    if (aiConfig?.type_true_false) types.push('verdadero_falso');
    if (aiConfig?.type_fill_blank) types.push('completar_frase');
    if (aiConfig?.type_match) types.push('conectar_conceptos');
    if (aiConfig?.type_short_answer) types.push('respuesta_corta');

    const depth = aiConfig?.question_depth || 3;
    const langLevel = aiConfig?.language_level || 'intermediate';
    const customInstructions = aiConfig?.custom_instructions || '';
    const goodExample = aiConfig?.example_good_question || '';
    const badExample = aiConfig?.example_bad_question || '';
    const emphasize = aiConfig?.topics_emphasize || '';
    const avoid = aiConfig?.topics_avoid || '';
    const gradeDetail = aiConfig?.grade_level_detail || '';
    const subjectDesc = aiConfig?.subject_description || '';

    const jsonFormats = {
      opcion_multiple: '{"type":"multiple_choice","q":"pregunta","opts":["A. op1","B. op2","C. op3","D. op4"],"ok":0,"exp":"explicacion"}',
      verdadero_falso: '{"type":"true_false","q":"afirmacion","ok":true,"exp":"explicacion"}',
      completar_frase: '{"type":"fill_blank","q":"La escritura cuneiforme surgio en ___ para registrar transacciones comerciales","answers":["Mesopotamia"],"exp":"explicacion"}',
      conectar_conceptos: '{"type":"match","q":"Conecta cada concepto con su definicion","pairs":[{"term":"concepto","def":"definicion"}],"exp":"explicacion"}',
      respuesta_corta: '{"type":"short_answer","q":"¿Cual fue el aporte matematico mas importante de la India antigua?","keywords":["cero","sistema decimal","numeros"],"exp":"explicacion"}'
    };

    // Distribuir exactamente TOTAL_QUESTIONS entre los tipos activos (nunca solo opcion_multiple
    // si hay mas tipos habilitados). Sin esto, Cohere tiende a generar todo opcion_multiple.
    const TOTAL_QUESTIONS = moduleId ? GENERATE_COUNT : SERVE_COUNT;
    const activeTypes = types.length > 0 ? types : ['opcion_multiple'];
    const base = Math.floor(TOTAL_QUESTIONS / activeTypes.length);
    let remainder = TOTAL_QUESTIONS % activeTypes.length;
    const counts = activeTypes.map(() => base + (remainder-- > 0 ? 1 : 0));

    const typeInstructions = activeTypes
      .map((t, i) => `- ${counts[i]} pregunta(s) de tipo "${t}", con este formato JSON: ${jsonFormats[t]}`)
      .join('\n');

    const prompt = `Eres un profesor experto generando preguntas de evaluacion.

MATERIA: ${subjectDesc || moduleTitle}
GRADO: ${gradeDetail}
TEMA DEL MODULO: ${moduleTitle}
NIVEL DE PROFUNDIDAD: ${depth}/5
NIVEL DE LENGUAJE: ${langLevel}
HABILIDADES A EVALUAR: ${skills.join(', ') || 'comprension general'}
${emphasize ? 'TEMAS A ENFATIZAR: ' + emphasize : ''}
${avoid ? 'TEMAS A EVITAR: ' + avoid : ''}
${customInstructions ? 'INSTRUCCIONES ESPECIALES: ' + customInstructions : ''}
${goodExample ? 'EJEMPLO DE PREGUNTA IDEAL: ' + goodExample : ''}
${badExample ? 'PREGUNTA A EVITAR: ' + badExample : ''}

CONTENIDO DEL MATERIAL:
${(context || '').substring(0, 1500)}

Genera EXACTAMENTE ${TOTAL_QUESTIONS} preguntas, distribuidas asi (respeta la cantidad exacta de cada tipo, no generes solo un tipo):
${typeInstructions}

No repitas preguntas ni reformules la misma idea dos veces; cada pregunta debe cubrir un aspecto distinto del tema.

REGLAS ADICIONALES POR TIPO:
- short_answer: la pregunta debe ser especifica y acotada (nunca vaga tipo "¿que es importante?"), con una respuesta esperada clara. "keywords" debe tener entre 2 y 5 palabras u expresiones concretas que se esperan en la respuesta.
- fill_blank: "q" debe tener UN SOLO espacio en blanco marcado con "___", y "answers" debe tener exactamente 1 palabra o frase corta que lo completa (no varios blancos en la misma oracion).
- match: "pairs" debe tener entre 3 y 4 pares concepto-definicion, cada uno claramente distinto de los demas para evitar ambiguedad.

Responde SOLO con JSON valido:
{"questions":[...${TOTAL_QUESTIONS} preguntas aqui, en el orden y cantidad indicados arriba...]}`;

    const res = await fetch('https://api.cohere.com/v2/chat', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + COHERE_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'c4ai-aya-expanse-32b', messages: [{ role: 'user', content: prompt }] })
    });

    if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 500 });
    const data = await res.json();
    const text = data.message?.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ error: 'No JSON found' }, { status: 500 });
    const parsed = JSON.parse(jsonMatch[0]);
    const generated: any[] = parsed.questions || [];

    // 3. Guardar lo generado en el cache para las proximas aperturas (best-effort).
    if (moduleId && generated.length > 0) {
      const supabase = await createServerSupabase();
      const rows = generated.map((q) => ({
        module_id: moduleId,
        type: q.type,
        q: q.q,
        opts: q.opts ?? null,
        ok: q.ok ?? null,
        answers: q.answers ?? null,
        pairs: q.pairs ?? null,
        keywords: q.keywords ?? null,
        exp: q.exp ?? null,
      }));
      await supabase.from('lesson_questions').insert(rows);
    }

    // El estudiante solo ve SERVE_COUNT, aunque se hayan generado/guardado mas.
    const toServe = moduleId ? shuffle(generated).slice(0, SERVE_COUNT) : generated;
    return NextResponse.json({ questions: toServe, cached: false });
  } catch (e) {
    console.error('Error:', String(e));
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
