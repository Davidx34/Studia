import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { generateEmbedding } from '@/lib/embeddings/generate';

const MIN_CACHE_SIZE = 5; // debajo de esto, todavia se sirve del cache si alcanza
const SERVE_COUNT = 5; // preguntas que ve el estudiante por leccion
const GENERATE_COUNT = 10; // preguntas generadas por llamada a Cohere (puebla el cache mas rapido)
const RAG_MATCH_COUNT = 5; // chunks mas relevantes traidos via match_material_chunks

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Convierte una fila de lesson_questions al shape que espera el render de la leccion.
// Incluye id y concept_tag para que el cliente pueda registrar el intento en question_attempts.
function rowToQuestion(row: any) {
  const q: any = { id: row.id, type: row.type, q: row.q, exp: row.exp, concept_tag: row.concept_tag ?? null };
  if (row.opts) q.opts = row.opts;
  if (row.ok !== null && row.ok !== undefined) q.ok = row.ok;
  if (row.answers) q.answers = row.answers;
  if (row.pairs) q.pairs = row.pairs;
  if (row.keywords) q.keywords = row.keywords;
  if (row.game_type) q.game_type = row.game_type;
  if (row.game_data) q.game_data = row.game_data;
  return q;
}

// Busca el contexto mas relevante para el modulo: primero intenta RAG real
// (embedding del titulo/descripcion + busqueda semantica entre TODOS los
// materiales de la clase via match_material_chunks). Si no hay embeddings
// disponibles o falla, cae al fallback anterior: primeros chunks de cualquier
// material completado de la clase.
async function getRagContext(supabase: any, moduleId: string): Promise<string> {
  const { data: moduleRow } = await supabase
    .from('content_modules')
    .select('title, description, classroom_id')
    .eq('id', moduleId)
    .single();

  if (!moduleRow) return '';

  const queryText = `${moduleRow.title}. ${moduleRow.description || ''}`.trim();
  const embedding = await generateEmbedding(queryText);

  if (embedding) {
    const { data: relevantChunks } = await supabase.rpc('match_material_chunks', {
      query_embedding: embedding,
      classroom_id_filter: moduleRow.classroom_id,
      match_count: RAG_MATCH_COUNT,
    });
    if (relevantChunks && relevantChunks.length > 0) {
      return relevantChunks.map((c: any) => c.content).join('\n\n');
    }
  }

  // Fallback: sin embeddings todavia (material recien subido) o RAG sin resultados.
  const { data: material } = await supabase
    .from('teaching_materials')
    .select('id')
    .eq('classroom_id', moduleRow.classroom_id)
    .eq('processing_status', 'completed')
    .limit(1)
    .single();

  if (material?.id) {
    const { data: chunks } = await supabase
      .from('material_chunks')
      .select('content')
      .eq('material_id', material.id)
      .limit(5);
    if (chunks && chunks.length > 0) return chunks.map((c: any) => c.content).join(' ');
  }

  return moduleRow.description || '';
}

export async function POST(req: NextRequest) {
  try {
    const { moduleId, context: clientContext, moduleTitle, aiConfig } = await req.json();

    let supabase: Awaited<ReturnType<typeof createServerSupabase>> | null = null;
    if (moduleId) supabase = await createServerSupabase();

    // 1. Intentar servir del cache (rapido, sin llamar a Cohere).
    if (moduleId && supabase) {
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

    // Contexto: RAG real cuando hay moduleId (busca en TODA la clase, no solo un material);
    // si no hay moduleId (fallback sin modulo real) se usa el context que mando el cliente.
    let context = clientContext || '';
    if (moduleId && supabase) {
      const ragContext = await getRagContext(supabase, moduleId);
      if (ragContext) context = ragContext;
    }

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
      opcion_multiple: '{"type":"multiple_choice","q":"pregunta","opts":["A. op1","B. op2","C. op3","D. op4"],"ok":0,"exp":"explicacion","concept_tag":"identificador_snake_case"}',
      verdadero_falso: '{"type":"true_false","q":"afirmacion","ok":true,"exp":"explicacion","concept_tag":"identificador_snake_case"}',
      completar_frase: '{"type":"fill_blank","q":"La escritura cuneiforme surgio en ___ para registrar transacciones comerciales","answers":["Mesopotamia"],"exp":"explicacion","concept_tag":"identificador_snake_case"}',
      conectar_conceptos: '{"type":"match","q":"Conecta cada concepto con su definicion","pairs":[{"term":"concepto","def":"definicion"}],"exp":"explicacion","concept_tag":"identificador_snake_case"}',
      respuesta_corta: '{"type":"short_answer","q":"¿Cual fue el aporte matematico mas importante de la India antigua?","keywords":["cero","sistema decimal","numeros"],"exp":"explicacion","concept_tag":"identificador_snake_case"}',
      el_descifrador: '{"type":"el_descifrador","q":"Descifra la palabra clave","word_to_guess":"ESCRIBA","initial_clue":"Funcionario que registraba documentos oficiales en civilizaciones antiguas","hints":["Era responsable de mantener registros y documentos publicos","Sin esta profesion no habria constancia de leyes ni tratados","Viene del latin scribere, que significa escribir"],"exp":"explicacion pedagogica de por que este concepto importa","concept_tag":"identificador_snake_case"}'
    };

    // Distribuir exactamente TOTAL_QUESTIONS entre los tipos activos (nunca solo opcion_multiple
    // si hay mas tipos habilitados). Sin esto, Cohere tiende a generar todo opcion_multiple.
    const TOTAL_QUESTIONS = moduleId ? GENERATE_COUNT : SERVE_COUNT;
    const activeTypes = types.length > 0 ? types : ['opcion_multiple'];
    const base = Math.floor(TOTAL_QUESTIONS / activeTypes.length);
    let remainder = TOTAL_QUESTIONS % activeTypes.length;
    const counts = activeTypes.map(() => base + (remainder-- > 0 ? 1 : 0));

    let typeInstructions = activeTypes
      .map((t, i) => `- ${counts[i]} pregunta(s) de tipo "${t}", con este formato JSON: ${jsonFormats[t]}`)
      .join('\n');

    // El minijuego "El Descifrador" es un bonus fuera de la distribucion normal:
    // solo tiene sentido cuando hay un modulo real (se cachea/trackea como el resto),
    // y solo cuando el tema tiene un termino/concepto concreto para adivinar
    // (si no aplica, Cohere puede omitirlo y generar una pregunta mas del resto).
    const MINIGAME_COUNT = moduleId ? 1 : 0;
    if (MINIGAME_COUNT > 0) {
      typeInstructions += `\n- ${MINIGAME_COUNT} pregunta adicional de tipo "el_descifrador" SOLO SI el tema tiene un termino o palabra clave clara para adivinar (ej: un concepto, un nombre propio, un invento); si no aplica, genera en su lugar una pregunta mas de los tipos de arriba. Formato JSON: ${jsonFormats.el_descifrador}`;
    }
    const TOTAL_WITH_MINIGAME = TOTAL_QUESTIONS + MINIGAME_COUNT;

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

Genera EXACTAMENTE ${TOTAL_WITH_MINIGAME} preguntas, distribuidas asi (respeta la cantidad exacta de cada tipo, no generes solo un tipo):
${typeInstructions}

No repitas preguntas ni reformules la misma idea dos veces; cada pregunta debe cubrir un aspecto distinto del tema.

REGLAS ADICIONALES POR TIPO:
- short_answer: la pregunta debe ser especifica y acotada (nunca vaga tipo "¿que es importante?"), con una respuesta esperada clara. "keywords" debe tener entre 2 y 5 palabras u expresiones concretas que se esperan en la respuesta.
- fill_blank: "q" debe tener UN SOLO espacio en blanco marcado con "___", y "answers" debe tener exactamente 1 palabra o frase corta que lo completa (no varios blancos en la misma oracion).
- match: "pairs" debe tener entre 3 y 4 pares concepto-definicion, cada uno claramente distinto de los demas para evitar ambiguedad.
- el_descifrador: "word_to_guess" debe ser UNA sola palabra en MAYUSCULAS sin acentos ni espacios, tomada del CONTENIDO DEL MATERIAL de arriba (nunca copies "ESCRIBA" del ejemplo de formato, es solo ilustrativo); si el termino tiene varias palabras, usa la mas importante. "hints" debe tener EXACTAMENTE 3 pistas progresivas (la primera vaga, la ultima casi obvia).

CONCEPT_TAG (obligatorio en cada pregunta): identifica el concepto especifico que evalua la pregunta (no el tema general del modulo), como un identificador snake_case corto en español (ej: "revolucion_industrial_causas", "fotosintesis_clorofila"). Si dos preguntas evaluan el mismo concepto especifico, deben usar EXACTAMENTE el mismo concept_tag.

Responde SOLO con JSON valido:
{"questions":[...${TOTAL_WITH_MINIGAME} preguntas aqui, en el orden y cantidad indicados arriba...]}`;

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
    // Normaliza el_descifrador a la misma forma anidada (game_type/game_data) que usan
    // las filas servidas desde cache, para que el cliente no tenga que manejar dos shapes.
    const generated: any[] = (parsed.questions || []).map((q: any) => {
      if (q.type !== 'el_descifrador') return q;
      const { word_to_guess, initial_clue, hints, ...rest } = q;
      return {
        ...rest,
        game_type: 'el_descifrador',
        game_data: { word_to_guess, initial_clue, hints, pedagogical_feedback: q.exp },
      };
    });

    // 3. Guardar lo generado en el cache para las proximas aperturas (best-effort),
    // y recuperar los ids asignados por la base para poder trackear intentos.
    let generatedWithIds = generated;
    if (moduleId && supabase && generated.length > 0) {
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
        concept_tag: q.concept_tag ?? null,
        game_type: q.game_type ?? null,
        game_data: q.game_data ?? null,
      }));
      const { data: inserted } = await supabase.from('lesson_questions').insert(rows).select('id');
      if (inserted && inserted.length === generated.length) {
        generatedWithIds = generated.map((q, i) => ({ ...q, id: inserted[i].id }));
      }
    }

    // El estudiante solo ve SERVE_COUNT, aunque se hayan generado/guardado mas.
    const toServe = moduleId ? shuffle(generatedWithIds).slice(0, SERVE_COUNT) : generatedWithIds;
    return NextResponse.json({ questions: toServe, cached: false });
  } catch (e) {
    console.error('Error:', String(e));
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
