import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { context, moduleTitle, aiConfig } = await req.json();
    const COHERE_API_KEY = process.env.COHERE_API_KEY;
    if (!COHERE_API_KEY) return NextResponse.json({ error: 'No API key' }, { status: 500 });

    // Construir prompt basado en config del profesor
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
      completar_frase: '{"type":"fill_blank","q":"La ___ es importante porque ___","answers":["palabra1","palabra2"],"exp":"explicacion"}',
      conectar_conceptos: '{"type":"match","q":"Conecta cada concepto con su definicion","pairs":[{"term":"concepto","def":"definicion"}],"exp":"explicacion"}',
      respuesta_corta: '{"type":"short_answer","q":"pregunta abierta","keywords":["palabra_clave1","palabra_clave2"],"exp":"explicacion"}'
    };

    const selectedFormats = types.length > 0 ? types.map(t => jsonFormats[t]).filter(Boolean) : [jsonFormats.opcion_multiple];

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
${context.substring(0, 1500)}

Genera exactamente 5 preguntas variadas usando estos tipos: ${types.join(', ') || 'opcion_multiple'}
Usa estos formatos JSON segun el tipo:
${selectedFormats.join(' O ')}

Responde SOLO con JSON valido:
{"questions":[...5 preguntas aqui...]}`;

    const res = await fetch('https://api.cohere.com/v2/chat', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + COHERE_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'c4ai-aya-expanse-32b', messages: [{ role: 'user', content: prompt }] })
    });

    if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 500 });
    const data = await res.json();
    const text = data.message?.content?.[0]?.text || '';
    console.log('Generated:', text.substring(0, 300));
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ error: 'No JSON found' }, { status: 500 });
    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json(parsed);
  } catch (e) {
    console.error('Error:', String(e));
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}