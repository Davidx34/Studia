// Piezas compartidas de generacion de preguntas con Cohere, usadas por
// /api/generate-questions (flujo automatico existente) y por
// /api/regenerate-module-questions (Mejora Estructural 2: pool
// configurable por el profesor). Extraido para no duplicar el prompt de
// formato JSON por tipo ni la normalizacion de minijuegos en dos lugares.

import { generateEmbedding } from '@/lib/embeddings/generate';

export const RAG_MATCH_COUNT = 5;

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Busca el contexto mas relevante para el modulo: RAG real (embedding +
// match_material_chunks) con fallback a los primeros chunks disponibles.
export async function getRagContext(supabase: any, moduleId: string): Promise<string> {
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

export const jsonFormats: Record<string, string> = {
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
  juicio_conocimiento: '{"type":"juicio_conocimiento","q":"Encuentra el fraude intelectual en el testimonio","case_file":"contexto del caso de estudio","expert_testimony":[{"paragraph_id":1,"text":"declaracion introductoria con datos correctos"},{"paragraph_id":2,"text":"declaracion con el fraude oculto (falacia o error sutil)"},{"paragraph_id":3,"text":"declaracion de cierre que se apoya en los parrafos anteriores"}],"guilty_paragraph_id":2,"cross_examination_tip":"pequeña pista inicial para orientar al usuario","exp":"explicacion magistral de por que ese parrafo es un fraude conceptual y que ley teorica viola","concept_tag":"identificador_snake_case"}',
};

// SOLO SI aplica (ver arriba): en que condiciones tiene sentido pedirle a
// Cohere ese tipo de minijuego para el tema dado.
export const MINIGAME_RULES: Record<string, string> = {
  el_descifrador: 'SOLO SI el tema tiene un termino o palabra clave clara para adivinar (ej: un concepto, un nombre propio, un invento)',
  linea_del_tiempo: 'SOLO SI el tema tiene una secuencia cronologica o de pasos clara (ej: eventos historicos, etapas de un proceso, ciclo biologico)',
  categorias_rapidas: 'SOLO SI el tema tiene una clasificacion o taxonomia clara con 3-4 categorias y varios elementos por categoria (ej: tipos de organismos, categorias historicas, clases de algo)',
  flashcard_rapida: 'SOLO SI el tema tiene pares claros de conceptos asociados (ej: termino-definicion, causa-efecto, pais-capital, organo-funcion)',
  impostor_cognitivo: 'SOLO SI el tema tiene datos, leyes o hechos precisos sobre los que se puede construir una afirmacion falsa pero plausible (confundir causa/efecto, invertir un dato, un error comun de estudiantes)',
  alquimia_conceptual: 'SOLO SI el tema tiene un concepto base (teorico) y una aplicacion avanzada o aparentemente inconexa que se pueda conectar mediante una ley, propiedad o herramienta especifica del tema',
  cuarto_crisis: 'SOLO SI el tema tiene un concepto cuya mala aplicacion pueda describirse como una falla o problema con sintomas identificables y una solucion tecnica clara',
  juicio_conocimiento: 'SOLO SI el tema tiene una tesis o argumento donde se pueda insertar un error metodologico o conceptual sutil pero identificable (paso logico mal hecho, asuncion falsa, dato invertido)',
};

export const MINIGAME_TYPE_RULES_TEXT = `
- el_descifrador: "word_to_guess" debe ser UNA sola palabra en MAYUSCULAS sin acentos ni espacios, tomada del CONTENIDO DEL MATERIAL de arriba (nunca copies "ESCRIBA" del ejemplo de formato, es solo ilustrativo); si el termino tiene varias palabras, usa la mas importante. "hints" debe tener EXACTAMENTE 3 pistas progresivas (la primera vaga, la ultima casi obvia).
- linea_del_tiempo: "items" debe tener entre 3 y 5 eventos/pasos reales del CONTENIDO DEL MATERIAL, cada uno con "correct_position" empezando en 1 y sin saltos ni repeticiones; "year" es opcional (solo si el material lo menciona explicitamente, si no dejalo vacio).
- categorias_rapidas: "categories" debe tener entre 3 y 4 categorias reales del CONTENIDO DEL MATERIAL; "items" debe tener entre 6 y 8 elementos en total, con al menos 2 elementos por categoria y "correct_category" que coincida EXACTAMENTE (mismo texto) con uno de los valores de "categories".
- flashcard_rapida: "flash_pairs" debe tener entre 6 y 8 pares reales del CONTENIDO DEL MATERIAL (concepto + su definicion/relacion/causa-efecto), cada "card1"/"card2" corto (maximo 6 palabras) para que quepan en una tarjeta.
- impostor_cognitivo: "statements" debe tener EXACTAMENTE 3 afirmaciones cortas sobre el CONTENIDO DEL MATERIAL: 2 con "is_impostor":false (verdaderas, precisas) y 1 con "is_impostor":true (falsa pero plausible, nunca obviamente absurda).
- alquimia_conceptual: "element_a" y "element_b" deben ser dos conceptos reales y distintos del CONTENIDO DEL MATERIAL; "bridge_options" debe tener EXACTAMENTE 3 opciones, solo una con "is_correct":true.
- cuarto_crisis: "telemetry_data" debe tener EXACTAMENTE 3 sintomas concretos derivados del CONTENIDO DEL MATERIAL; "interventions" debe tener EXACTAMENTE 3 protocolos con action_code "ALPHA","BETA","GAMMA" (en ese orden), solo "ALPHA" con "is_solution":true.
- juicio_conocimiento: "expert_testimony" debe tener EXACTAMENTE 3 parrafos numerados 1,2,3 sobre el CONTENIDO DEL MATERIAL; "guilty_paragraph_id" debe apuntar al parrafo con el error oculto (nunca el parrafo 1).`;

// Normaliza la respuesta cruda de Cohere para un minijuego al shape anidado
// game_type/game_data que usan todos los componentes de minijuego.
export function normalizeGeneratedQuestion(q: any): any {
  if (q.type === 'el_descifrador') {
    const { word_to_guess, initial_clue, hints, ...rest } = q;
    return { ...rest, game_type: 'el_descifrador', game_data: { word_to_guess, initial_clue, hints, pedagogical_feedback: q.exp } };
  }
  if (q.type === 'linea_del_tiempo') {
    const { items, ...rest } = q;
    return { ...rest, game_type: 'linea_del_tiempo', game_data: { items, pedagogical_feedback: q.exp } };
  }
  if (q.type === 'categorias_rapidas') {
    const { categories, items, time_limit_seconds, ...rest } = q;
    return { ...rest, game_type: 'categorias_rapidas', game_data: { categories, items, time_limit_seconds, pedagogical_feedback: q.exp } };
  }
  if (q.type === 'flashcard_rapida') {
    const { flash_pairs, ...rest } = q;
    return { ...rest, game_type: 'flashcard_rapida', game_data: { pairs: flash_pairs, pedagogical_feedback: q.exp } };
  }
  if (q.type === 'impostor_cognitivo') {
    const { context, statements, ...rest } = q;
    return { ...rest, game_type: 'impostor_cognitivo', game_data: { context, statements, exposicion_del_impostor: q.exp } };
  }
  if (q.type === 'alquimia_conceptual') {
    const { fusion_title, element_a, element_b, alchemy_enigma, bridge_options, ...rest } = q;
    return { ...rest, game_type: 'alquimia_conceptual', game_data: { fusion_title, element_a, element_b, alchemy_enigma, bridge_options, unlocked_knowledge: q.exp } };
  }
  if (q.type === 'cuarto_crisis') {
    const { crisis_scenario, telemetry_data, interventions, ...rest } = q;
    return { ...rest, game_type: 'cuarto_crisis', game_data: { crisis_scenario, telemetry_data, interventions, post_mortem_report: q.exp } };
  }
  if (q.type === 'juicio_conocimiento') {
    const { case_file, expert_testimony, guilty_paragraph_id, cross_examination_tip, ...rest } = q;
    return { ...rest, game_type: 'juicio_conocimiento', game_data: { case_file, expert_testimony, guilty_paragraph_id, cross_examination_tip, verdict_explanation: q.exp } };
  }
  return q;
}

export async function callCohere(prompt: string): Promise<any[] | null> {
  const COHERE_API_KEY = process.env.COHERE_API_KEY;
  if (!COHERE_API_KEY) return null;
  const res = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + COHERE_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'c4ai-aya-expanse-32b', messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data.message?.content?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.questions || [];
  } catch {
    return null;
  }
}
