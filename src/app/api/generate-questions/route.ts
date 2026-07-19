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

// Genera 4 preguntas cortas (multiple_choice/true_false, sin minijuegos) enfocadas
// SOLO en los concept_tag debiles que paso el cliente. Se usa para el repaso dirigido
// (Sesion E.1): nunca se cachea ni se guarda en lesson_questions (es efimero, se
// descarta despues de usarse una vez), asi que siempre llama a Cohere directo.
async function generateRemediationQuestions(
  supabase: any,
  moduleId: string,
  moduleTitle: string,
  weakConcepts: string[]
): Promise<any[]> {
  const COHERE_API_KEY = process.env.COHERE_API_KEY;
  if (!COHERE_API_KEY) return [];

  const context = await getRagContext(supabase, moduleId);

  const prompt = `Eres un profesor de apoyo haciendo un repaso corto y alentador con un estudiante.

TEMA DEL MODULO: ${moduleTitle}
CONTENIDO DEL MATERIAL:
${(context || '').substring(0, 1500)}

El estudiante tuvo dificultad especificamente con estos conceptos: ${weakConcepts.join(', ')}.

Genera EXACTAMENTE 4 preguntas de repaso, SOLO sobre esos conceptos (nada mas del tema general).
Usa un lenguaje de apoyo, preguntas mas simples y directas que refuercen comprension (no que confundan mas).
Distribucion: 2 preguntas "multiple_choice" y 2 preguntas "true_false".

Formato JSON por pregunta:
- multiple_choice: {"type":"multiple_choice","q":"pregunta","opts":["A. op1","B. op2","C. op3","D. op4"],"ok":0,"exp":"explicacion de apoyo","concept_tag":"uno de los conceptos de arriba, exacto"}
- true_false: {"type":"true_false","q":"afirmacion","ok":true,"exp":"explicacion de apoyo","concept_tag":"uno de los conceptos de arriba, exacto"}

Responde SOLO con JSON valido:
{"questions":[...4 preguntas aqui...]}`;

  const res = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + COHERE_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'c4ai-aya-expanse-32b', messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const text = data.message?.content?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.questions || [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const { moduleId, context: clientContext, moduleTitle, aiConfig, remediationConcepts } = await req.json();

    let supabase: Awaited<ReturnType<typeof createServerSupabase>> | null = null;
    if (moduleId) supabase = await createServerSupabase();

    // 0. Modo repaso dirigido (Sesion E.1): atajo completo, nunca toca el cache normal.
    if (remediationConcepts?.length > 0 && moduleId && supabase) {
      const questions = await generateRemediationQuestions(supabase, moduleId, moduleTitle, remediationConcepts);
      return NextResponse.json({ questions, cached: false });
    }

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
      el_descifrador: '{"type":"el_descifrador","q":"Descifra la palabra clave","word_to_guess":"ESCRIBA","initial_clue":"Funcionario que registraba documentos oficiales en civilizaciones antiguas","hints":["Era responsable de mantener registros y documentos publicos","Sin esta profesion no habria constancia de leyes ni tratados","Viene del latin scribere, que significa escribir"],"exp":"explicacion pedagogica de por que este concepto importa","concept_tag":"identificador_snake_case"}',
      linea_del_tiempo: '{"type":"linea_del_tiempo","q":"Ordena estos eventos cronologicamente","items":[{"id":1,"text":"evento mas antiguo","correct_position":1,"year":"opcional"},{"id":2,"text":"segundo evento","correct_position":2,"year":"opcional"},{"id":3,"text":"tercer evento","correct_position":3,"year":"opcional"}],"exp":"explicacion pedagogica de por que este orden importa","concept_tag":"identificador_snake_case"}',
      categorias_rapidas: '{"type":"categorias_rapidas","q":"Clasifica estos elementos en su categoria correcta","categories":["Categoria A","Categoria B","Categoria C"],"items":[{"id":1,"text":"elemento 1","correct_category":"Categoria A"},{"id":2,"text":"elemento 2","correct_category":"Categoria B"},{"id":3,"text":"elemento 3","correct_category":"Categoria C"},{"id":4,"text":"elemento 4","correct_category":"Categoria A"}],"time_limit_seconds":60,"exp":"explicacion pedagogica de por que esta clasificacion importa","concept_tag":"identificador_snake_case"}',
      flashcard_rapida: '{"type":"flashcard_rapida","q":"Encuentra los pares relacionados","flash_pairs":[{"id":1,"card1":"concepto 1","card2":"su definicion o relacion"},{"id":2,"card1":"concepto 2","card2":"su definicion o relacion"},{"id":3,"card1":"concepto 3","card2":"su definicion o relacion"},{"id":4,"card1":"concepto 4","card2":"su definicion o relacion"}],"exp":"explicacion pedagogica de por que estas asociaciones importan","concept_tag":"identificador_snake_case"}',
      impostor_cognitivo: '{"type":"impostor_cognitivo","q":"Encuentra la afirmacion falsa","context":"Breve introduccion o escenario para situar al estudiante","statements":[{"id":1,"text":"afirmacion verdadera 1","is_impostor":false},{"id":2,"text":"afirmacion verdadera 2","is_impostor":false},{"id":3,"text":"afirmacion falsa pero plausible","is_impostor":true}],"exp":"explicacion detallada de por que la afirmacion falsa es incorrecta y cual es la verdad academica","concept_tag":"identificador_snake_case"}',
      alquimia_conceptual: '{"type":"alquimia_conceptual","q":"Encuentra el puente logico","fusion_title":"nombre creativo de la combinacion","element_a":"concepto base A","element_b":"concepto aplicado B","alchemy_enigma":"planteamiento que desafia al usuario a encontrar el eslabon entre A y B","bridge_options":[{"id":"X","text":"opcion correcta que explica la fusion","is_correct":true},{"id":"Y","text":"distractor con logica inversa","is_correct":false},{"id":"Z","text":"distractor superficial sin rigor","is_correct":false}],"exp":"el concepto de nivel superior que se desbloquea, en 2 frases","concept_tag":"identificador_snake_case"}',
      cuarto_crisis: '{"type":"cuarto_crisis","q":"Resuelve la crisis antes de que se acabe el tiempo","crisis_scenario":"descripcion narrativa del problema urgente en un parrafo","telemetry_data":["sintoma o metrica 1","sintoma o metrica 2","sintoma o metrica 3"],"interventions":[{"action_code":"ALPHA","description":"protocolo correcto basado en la teoria exacta","is_solution":true,"consequence":"Crisis evitada, explicacion de por que funciono"},{"action_code":"BETA","description":"accion paliativa que solo oculta el sintoma","is_solution":false,"consequence":"Error, el sistema colapsa despues, por que no basto"},{"action_code":"GAMMA","description":"accion erronea comun de novatos","is_solution":false,"consequence":"Explosion, el error se amplifico, por que fue incorrecto"}],"exp":"explicacion tecnica de por que los datos apuntaban a esa solucion","concept_tag":"identificador_snake_case"}',
      juicio_conocimiento: '{"type":"juicio_conocimiento","q":"Encuentra el fraude intelectual en el testimonio","case_file":"contexto del caso de estudio","expert_testimony":[{"paragraph_id":1,"text":"declaracion introductoria con datos correctos"},{"paragraph_id":2,"text":"declaracion con el fraude oculto (falacia o error sutil)"},{"paragraph_id":3,"text":"declaracion de cierre que se apoya en los parrafos anteriores"}],"guilty_paragraph_id":2,"cross_examination_tip":"pequeña pista inicial para orientar al usuario","exp":"explicacion magistral de por que ese parrafo es un fraude conceptual y que ley teorica viola","concept_tag":"identificador_snake_case"}'
    };

    // Minijuegos disponibles como "bonus" fuera de la distribucion normal (no le
    // roban cupo a los tipos que el profesor configuro). Maximo 2 minijuegos por
    // modulo para no perder variedad pedagogica: si hay mas de 2 tipos disponibles,
    // se sortean 2 por generacion en vez de pedirlos todos.
    const MINIGAME_RULES: Record<string, string> = {
      el_descifrador: 'SOLO SI el tema tiene un termino o palabra clave clara para adivinar (ej: un concepto, un nombre propio, un invento)',
      linea_del_tiempo: 'SOLO SI el tema tiene una secuencia cronologica o de pasos clara (ej: eventos historicos, etapas de un proceso, ciclo biologico)',
      categorias_rapidas: 'SOLO SI el tema tiene una clasificacion o taxonomia clara con 3-4 categorias y varios elementos por categoria (ej: tipos de organismos, categorias historicas, clases de algo)',
      flashcard_rapida: 'SOLO SI el tema tiene pares claros de conceptos asociados (ej: termino-definicion, causa-efecto, pais-capital, organo-funcion)',
      impostor_cognitivo: 'SOLO SI el tema tiene datos, leyes o hechos precisos sobre los que se puede construir una afirmacion falsa pero plausible (confundir causa/efecto, invertir un dato, un error comun de estudiantes)',
      alquimia_conceptual: 'SOLO SI el tema tiene un concepto base (teorico) y una aplicacion avanzada o aparentemente inconexa que se pueda conectar mediante una ley, propiedad o herramienta especifica del tema',
      cuarto_crisis: 'SOLO SI el tema tiene un concepto cuya mala aplicacion pueda describirse como una falla o problema con sintomas identificables y una solucion tecnica clara',
      juicio_conocimiento: 'SOLO SI el tema tiene una tesis o argumento donde se pueda insertar un error metodologico o conceptual sutil pero identificable (paso logico mal hecho, asuncion falsa, dato invertido)',
    };
    const MAX_MINIGAMES_PER_MODULE = 2;

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

    // Los minijuegos son un bonus fuera de la distribucion normal: solo tienen
    // sentido cuando hay un modulo real (se cachean/trackean como el resto), y
    // solo si el tema efectivamente se presta para ese formato (si no aplica,
    // Cohere genera en su lugar una pregunta mas de los tipos configurados).
    const minigameTypes = moduleId ? shuffle(Object.keys(MINIGAME_RULES)).slice(0, MAX_MINIGAMES_PER_MODULE) : [];
    for (const mg of minigameTypes) {
      typeInstructions += `\n- 1 pregunta adicional de tipo "${mg}" ${MINIGAME_RULES[mg]}; si no aplica, genera en su lugar una pregunta mas de los tipos de arriba. Formato JSON: ${jsonFormats[mg]}`;
    }
    const TOTAL_WITH_MINIGAME = TOTAL_QUESTIONS + minigameTypes.length;

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
- linea_del_tiempo: "items" debe tener entre 3 y 5 eventos/pasos reales del CONTENIDO DEL MATERIAL, cada uno con "correct_position" empezando en 1 y sin saltos ni repeticiones; "year" es opcional (solo si el material lo menciona explicitamente, si no dejalo vacio).
- categorias_rapidas: "categories" debe tener entre 3 y 4 categorias reales del CONTENIDO DEL MATERIAL; "items" debe tener entre 6 y 8 elementos en total, con al menos 2 elementos por categoria y "correct_category" que coincida EXACTAMENTE (mismo texto) con uno de los valores de "categories".
- flashcard_rapida: "flash_pairs" debe tener entre 6 y 8 pares reales del CONTENIDO DEL MATERIAL (concepto + su definicion/relacion/causa-efecto), cada "card1"/"card2" corto (maximo 6 palabras) para que quepan en una tarjeta.
- impostor_cognitivo: "statements" debe tener EXACTAMENTE 3 afirmaciones cortas sobre el CONTENIDO DEL MATERIAL: 2 con "is_impostor":false (verdaderas, precisas) y 1 con "is_impostor":true (falsa pero plausible, nunca obviamente absurda).
- alquimia_conceptual: "element_a" y "element_b" deben ser dos conceptos reales y distintos del CONTENIDO DEL MATERIAL; "bridge_options" debe tener EXACTAMENTE 3 opciones, solo una con "is_correct":true.
- cuarto_crisis: "telemetry_data" debe tener EXACTAMENTE 3 sintomas concretos derivados del CONTENIDO DEL MATERIAL; "interventions" debe tener EXACTAMENTE 3 protocolos con action_code "ALPHA","BETA","GAMMA" (en ese orden), solo "ALPHA" con "is_solution":true.
- juicio_conocimiento: "expert_testimony" debe tener EXACTAMENTE 3 parrafos numerados 1,2,3 sobre el CONTENIDO DEL MATERIAL; "guilty_paragraph_id" debe apuntar al parrafo con el error oculto (nunca el parrafo 1).

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
    // Normaliza cada minijuego a la misma forma anidada (game_type/game_data) que usan
    // las filas servidas desde cache, para que el cliente no tenga que manejar N shapes.
    const generated: any[] = (parsed.questions || []).map((q: any) => {
      if (q.type === 'el_descifrador') {
        const { word_to_guess, initial_clue, hints, ...rest } = q;
        return {
          ...rest,
          game_type: 'el_descifrador',
          game_data: { word_to_guess, initial_clue, hints, pedagogical_feedback: q.exp },
        };
      }
      if (q.type === 'linea_del_tiempo') {
        const { items, ...rest } = q;
        return {
          ...rest,
          game_type: 'linea_del_tiempo',
          game_data: { items, pedagogical_feedback: q.exp },
        };
      }
      if (q.type === 'categorias_rapidas') {
        const { categories, items, time_limit_seconds, ...rest } = q;
        return {
          ...rest,
          game_type: 'categorias_rapidas',
          game_data: { categories, items, time_limit_seconds, pedagogical_feedback: q.exp },
        };
      }
      if (q.type === 'flashcard_rapida') {
        const { flash_pairs, ...rest } = q;
        return {
          ...rest,
          game_type: 'flashcard_rapida',
          game_data: { pairs: flash_pairs, pedagogical_feedback: q.exp },
        };
      }
      if (q.type === 'impostor_cognitivo') {
        const { context, statements, ...rest } = q;
        return {
          ...rest,
          game_type: 'impostor_cognitivo',
          game_data: { context, statements, exposicion_del_impostor: q.exp },
        };
      }
      if (q.type === 'alquimia_conceptual') {
        const { fusion_title, element_a, element_b, alchemy_enigma, bridge_options, ...rest } = q;
        return {
          ...rest,
          game_type: 'alquimia_conceptual',
          game_data: { fusion_title, element_a, element_b, alchemy_enigma, bridge_options, unlocked_knowledge: q.exp },
        };
      }
      if (q.type === 'cuarto_crisis') {
        const { crisis_scenario, telemetry_data, interventions, ...rest } = q;
        return {
          ...rest,
          game_type: 'cuarto_crisis',
          game_data: { crisis_scenario, telemetry_data, interventions, post_mortem_report: q.exp },
        };
      }
      if (q.type === 'juicio_conocimiento') {
        const { case_file, expert_testimony, guilty_paragraph_id, cross_examination_tip, ...rest } = q;
        return {
          ...rest,
          game_type: 'juicio_conocimiento',
          game_data: { case_file, expert_testimony, guilty_paragraph_id, cross_examination_tip, verdict_explanation: q.exp },
        };
      }
      return q;
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
