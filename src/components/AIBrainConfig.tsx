'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Props { classroomId: string; }

export default function AIBrainConfig({ classroomId }: Props) {
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [config, setConfig] = useState({
    subject_description: '',
    grade_level_detail: '',
    learning_objectives: '',
    skill_memory: true,
    skill_comprehension: true,
    skill_application: true,
    skill_analysis: false,
    skill_synthesis: false,
    skill_evaluation: false,
    question_depth: 3,
    language_level: 'intermediate',
    type_multiple_choice: true,
    type_true_false: true,
    type_fill_blank: true,
    type_match: true,
    type_order: false,
    type_short_answer: false,
    custom_instructions: '',
    example_good_question: '',
    example_bad_question: '',
    topics_emphasize: '',
    topics_avoid: '',
  });

  useEffect(() => {
    supabase.from('classroom_ai_config').select('*').eq('classroom_id', classroomId).single()
      .then(({ data }) => { if (data) setConfig(data); });
  }, [classroomId]);

  const handleSave = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('classroom_ai_config').upsert({
      ...config, classroom_id: classroomId, teacher_id: user?.id, updated_at: new Date().toISOString()
    }, { onConflict: 'classroom_id' });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const toggle = (key: string) => setConfig(p => ({ ...p, [key]: !(p as any)[key] }));
  const update = (key: string, val: any) => setConfig(p => ({ ...p, [key]: val }));

  return (
    <div className="space-y-8">
      <div className="bg-purple-900 bg-opacity-30 border border-purple-500 rounded-xl p-6">
        <h2 className="text-xl font-bold text-white mb-2">🧠 Cerebro de la IA</h2>
        <p className="text-gray-400 text-sm">Configura cómo la IA genera preguntas para tus estudiantes. Entre más detallado, mejor será la evaluación.</p>
      </div>

      <div className="bg-gray-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-bold text-lg">📚 Descripción de la Materia</h3>
        <div>
          <label className="text-gray-400 text-sm">¿De qué trata exactamente esta clase?</label>
          <textarea value={config.subject_description} onChange={e => update('subject_description', e.target.value)}
            className="w-full mt-2 bg-gray-700 text-white rounded-lg p-3 text-sm resize-none h-24 border border-gray-600 focus:border-purple-500 outline-none"
            placeholder="Ej: Matemáticas de 5to grado, enfocada en fracciones y decimales..." />
        </div>
        <div>
          <label className="text-gray-400 text-sm">Detalle del nivel/grado</label>
          <input value={config.grade_level_detail} onChange={e => update('grade_level_detail', e.target.value)}
            className="w-full mt-2 bg-gray-700 text-white rounded-lg p-3 text-sm border border-gray-600 focus:border-purple-500 outline-none"
            placeholder="Ej: 5to grado primaria, Colombia, edad promedio 10-11 años" />
        </div>
        <div>
          <label className="text-gray-400 text-sm">Objetivos de aprendizaje</label>
          <textarea value={config.learning_objectives} onChange={e => update('learning_objectives', e.target.value)}
            className="w-full mt-2 bg-gray-700 text-white rounded-lg p-3 text-sm resize-none h-24 border border-gray-600 focus:border-purple-500 outline-none"
            placeholder="Ej: Al finalizar, el estudiante debe poder: 1) Sumar fracciones con diferente denominador..." />
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-6">
        <h3 className="text-white font-bold text-lg mb-4">🎯 Habilidades a Evaluar (Taxonomía de Bloom)</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: 'skill_memory', label: '🔵 Recordar', desc: 'Memorizar hechos y conceptos' },
            { key: 'skill_comprehension', label: '🟢 Comprender', desc: 'Interpretar y explicar ideas' },
            { key: 'skill_application', label: '🟡 Aplicar', desc: 'Usar conocimiento en situaciones nuevas' },
            { key: 'skill_analysis', label: '🟠 Analizar', desc: 'Descomponer y relacionar conceptos' },
            { key: 'skill_synthesis', label: '🔴 Sintetizar', desc: 'Crear y combinar ideas' },
            { key: 'skill_evaluation', label: '🟣 Evaluar', desc: 'Juzgar y criticar con criterios' },
          ].map(({ key, label, desc }) => (
            <button key={key} onClick={() => toggle(key)}
              className={'p-3 rounded-lg border-2 text-left transition-all ' + ((config as any)[key] ? 'border-purple-500 bg-purple-900 bg-opacity-30' : 'border-gray-600 bg-gray-700')}>
              <p className="text-white font-medium text-sm">{label}</p>
              <p className="text-gray-400 text-xs mt-1">{desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-6">
        <h3 className="text-white font-bold text-lg mb-4">❓ Tipos de Preguntas</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: 'type_multiple_choice', label: '🔘 Opción Múltiple' },
            { key: 'type_true_false', label: '✅ Verdadero/Falso' },
            { key: 'type_fill_blank', label: '✏️ Completar Frase' },
            { key: 'type_match', label: '🔗 Conectar Conceptos' },
            { key: 'type_order', label: '📋 Ordenar Pasos' },
            { key: 'type_short_answer', label: '💬 Respuesta Corta' },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => toggle(key)}
              className={'p-3 rounded-lg border-2 text-left transition-all ' + ((config as any)[key] ? 'border-blue-500 bg-blue-900 bg-opacity-30' : 'border-gray-600 bg-gray-700')}>
              <p className="text-white font-medium text-sm">{label}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-bold text-lg">⚙️ Configuración de Profundidad</h3>
        <div>
          <label className="text-gray-400 text-sm">Profundidad de preguntas: {config.question_depth}/5</label>
          <input type="range" min="1" max="5" value={config.question_depth} onChange={e => update('question_depth', parseInt(e.target.value))}
            className="w-full mt-2 accent-purple-500" />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>Básico</span><span>Intermedio</span><span>Avanzado</span>
          </div>
        </div>
        <div>
          <label className="text-gray-400 text-sm">Nivel de lenguaje</label>
          <select value={config.language_level} onChange={e => update('language_level', e.target.value)}
            className="w-full mt-2 bg-gray-700 text-white rounded-lg p-3 text-sm border border-gray-600">
            <option value="simple">Simple (primaria temprana)</option>
            <option value="intermediate">Intermedio (primaria/secundaria)</option>
            <option value="advanced">Avanzado (bachillerato)</option>
            <option value="university">Universitario</option>
          </select>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-bold text-lg">📝 Instrucciones Personalizadas</h3>
        <div>
          <label className="text-gray-400 text-sm">Instrucciones libres para la IA</label>
          <textarea value={config.custom_instructions} onChange={e => update('custom_instructions', e.target.value)}
            className="w-full mt-2 bg-gray-700 text-white rounded-lg p-3 text-sm resize-none h-32 border border-gray-600 focus:border-purple-500 outline-none"
            placeholder="Ej: Las preguntas deben usar ejemplos de la vida cotidiana colombiana. Evitar preguntas teóricas puras..." />
        </div>
        <div>
          <label className="text-gray-400 text-sm">Ejemplo de pregunta IDEAL</label>
          <textarea value={config.example_good_question} onChange={e => update('example_good_question', e.target.value)}
            className="w-full mt-2 bg-gray-700 text-white rounded-lg p-3 text-sm resize-none h-20 border border-gray-600 focus:border-green-500 outline-none"
            placeholder="Ej: Si tienes 3/4 de una pizza y comes 1/4, ¿qué fracción te queda?" />
        </div>
        <div>
          <label className="text-gray-400 text-sm">Ejemplo de pregunta a EVITAR</label>
          <textarea value={config.example_bad_question} onChange={e => update('example_bad_question', e.target.value)}
            className="w-full mt-2 bg-gray-700 text-white rounded-lg p-3 text-sm resize-none h-20 border border-gray-600 focus:border-red-500 outline-none"
            placeholder="Ej: ¿Cuál es la definición formal de fracción?" />
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-bold text-lg">🎯 Temas</h3>
        <div>
          <label className="text-gray-400 text-sm">Temas a ENFATIZAR</label>
          <textarea value={config.topics_emphasize} onChange={e => update('topics_emphasize', e.target.value)}
            className="w-full mt-2 bg-gray-700 text-white rounded-lg p-3 text-sm resize-none h-20 border border-gray-600 focus:border-green-500 outline-none"
            placeholder="Ej: Fracciones equivalentes, conversión a decimales..." />
        </div>
        <div>
          <label className="text-gray-400 text-sm">Temas a EVITAR</label>
          <textarea value={config.topics_avoid} onChange={e => update('topics_avoid', e.target.value)}
            className="w-full mt-2 bg-gray-700 text-white rounded-lg p-3 text-sm resize-none h-20 border border-gray-600 focus:border-red-500 outline-none"
            placeholder="Ej: Fracciones negativas, álgebra con fracciones..." />
        </div>
      </div>

      <button onClick={handleSave} disabled={saving}
        className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-4 rounded-xl hover:opacity-90 transition disabled:opacity-50 text-lg">
        {saving ? 'Guardando...' : saved ? '✅ Guardado correctamente' : '💾 Guardar Configuración de IA'}
      </button>
    </div>
  );
}