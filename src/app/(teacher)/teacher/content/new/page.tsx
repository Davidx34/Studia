'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft, ArrowRight, Check, Sparkles, FileText, Settings, Wand2 } from 'lucide-react';

type Step = 1 | 2 | 3;

interface FormData {
  title: string;
  description: string;
  category: string;
  difficulty_level: number;
  content_type: string;
  estimated_time_minutes: number;
  base_xp_reward: number;
  gemini_prompt_template: string;
}

const CATEGORIES = [
  { value: 'math', label: 'Matemáticas', emoji: '🔢' },
  { value: 'science', label: 'Ciencias', emoji: '🔬' },
  { value: 'language', label: 'Lenguaje', emoji: '📖' },
  { value: 'history', label: 'Historia', emoji: '📜' },
  { value: 'logic', label: 'Lógica', emoji: '🧩' },
];

const PROMPT_SUGGESTIONS = [
  {
    label: 'Pregunta directa',
    text: 'Genera una pregunta directa sobre [TEMA]. Una respuesta correcta y tres distractores plausibles.',
  },
  {
    label: 'Problema con contexto',
    text: 'Crea un problema con contexto de la vida real (compras, deportes, animales) sobre [TEMA]. Hazlo divertido para niños.',
  },
  {
    label: 'Comparación',
    text: 'Genera una pregunta que pida comparar dos elementos de [TEMA]. Incluye una opción que sea un error común.',
  },
];

export default function NewModuleWizard() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [data, setData] = useState<FormData>({
    title: '',
    description: '',
    category: 'math',
    difficulty_level: 1,
    content_type: 'quiz',
    estimated_time_minutes: 10,
    base_xp_reward: 15,
    gemini_prompt_template: '',
  });

  const update = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setData((d) => ({ ...d, [key]: value }));

  // Validación por paso
  const canAdvance = (): boolean => {
    if (step === 1) return data.title.trim().length >= 3 && data.category !== '';
    if (step === 2) return data.difficulty_level >= 1 && data.estimated_time_minutes > 0;
    if (step === 3) return data.gemini_prompt_template.trim().length >= 10;
    return false;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');

      // Buscar el classroom del profesor
      const { data: classroom } = await supabase
        .from('classrooms')
        .select('id')
        .eq('teacher_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Calcular order_index siguiente
      const { count } = await supabase
        .from('content_modules')
        .select('*', { count: 'exact', head: true })
        .eq('teacher_id', user.id)
        .eq('category', data.category);

      const { error: insertError } = await supabase.from('content_modules').insert({
        teacher_id: user.id,
        classroom_id: classroom?.id || null,
        title: data.title,
        description: data.description || null,
        category: data.category,
        difficulty_level: data.difficulty_level,
        content_type: data.content_type,
        estimated_time_minutes: data.estimated_time_minutes,
        base_xp_reward: data.base_xp_reward,
        gemini_prompt_template: data.gemini_prompt_template,
        order_index: (count || 0) + 100, // empieza alto para no chocar con seed
        is_active: true,
      });

      if (insertError) throw insertError;

      router.push('/teacher/content');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el módulo');
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <Link
        href="/teacher/content"
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver a contenido
      </Link>

      <div>
        <h1 className="text-3xl font-bold text-white">Crear módulo</h1>
        <p className="text-slate-400 mt-1">Paso {step} de 3</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {([1, 2, 3] as Step[]).map((s, idx) => {
          const isActive = step === s;
          const isDone = step > s;
          const icons = [FileText, Settings, Wand2];
          const Icon = icons[idx];
          return (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border flex-1 transition ${
                  isActive
                    ? 'bg-violet-500/15 border-violet-500/40 text-violet-200'
                    : isDone
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-slate-900 border-slate-800 text-slate-500'
                }`}
              >
                {isDone ? (
                  <Check className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <Icon className="w-4 h-4 flex-shrink-0" />
                )}
                <span className="text-xs font-semibold uppercase tracking-wider truncate">
                  {s === 1 ? 'Información' : s === 2 ? 'Configuración' : 'IA Toñito'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Contenido del paso */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-5">
        {step === 1 && (
          <>
            <div>
              <label className="block text-sm font-semibold text-white mb-2">
                Título del módulo *
              </label>
              <input
                type="text"
                value={data.title}
                onChange={(e) => update('title', e.target.value)}
                placeholder="ej: Introducción a las fracciones"
                className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-violet-500 transition"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-white mb-2">
                Descripción
              </label>
              <textarea
                value={data.description}
                onChange={(e) => update('description', e.target.value)}
                placeholder="Breve descripción de lo que aprenderán..."
                rows={3}
                className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-violet-500 transition resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-white mb-2">Categoría *</label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    onClick={() => update('category', cat.value)}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition ${
                      data.category === cat.value
                        ? 'bg-violet-500/20 border-violet-500 text-white'
                        : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <span className="text-2xl">{cat.emoji}</span>
                    <span className="text-xs font-medium">{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <label className="block text-sm font-semibold text-white mb-2">
                Dificultad: <span className="text-violet-300">{data.difficulty_level}/10</span>
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={data.difficulty_level}
                onChange={(e) => update('difficulty_level', Number(e.target.value))}
                className="w-full accent-violet-500"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>Principiante</span>
                <span>Intermedio</span>
                <span>Avanzado</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-white mb-2">
                  Tiempo estimado (minutos)
                </label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={data.estimated_time_minutes}
                  onChange={(e) => update('estimated_time_minutes', Number(e.target.value))}
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-violet-500 transition"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-white mb-2">
                  XP base
                </label>
                <input
                  type="number"
                  min="5"
                  max="100"
                  value={data.base_xp_reward}
                  onChange={(e) => update('base_xp_reward', Number(e.target.value))}
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-violet-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-white mb-2">Tipo de contenido</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { v: 'quiz', l: 'Quiz' },
                  { v: 'reading', l: 'Lectura' },
                  { v: 'interactive', l: 'Interactivo' },
                ].map((t) => (
                  <button
                    key={t.v}
                    onClick={() => update('content_type', t.v)}
                    className={`p-3 rounded-xl border text-sm font-semibold transition ${
                      data.content_type === t.v
                        ? 'bg-violet-500/20 border-violet-500 text-white'
                        : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    {t.l}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="flex items-start gap-3 p-4 rounded-xl bg-violet-500/10 border border-violet-500/30">
              <Sparkles className="w-5 h-5 text-violet-300 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-slate-300">
                <strong className="text-white">Toñito generará las preguntas usando estas instrucciones.</strong>
                <br />
                Sé específico sobre el tema, el estilo y los errores comunes que quieres incluir como distractores.
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-white mb-2">
                Instrucciones para Toñito *
              </label>
              <textarea
                value={data.gemini_prompt_template}
                onChange={(e) => update('gemini_prompt_template', e.target.value)}
                placeholder="ej: Genera preguntas sobre fracciones equivalentes. Usa pizzas como ejemplos visuales. Incluye un distractor donde se confundan numerador con denominador."
                rows={6}
                className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-violet-500 transition resize-none font-mono text-sm"
              />
              <div className="text-xs text-slate-500 mt-1">
                {data.gemini_prompt_template.length} caracteres · mínimo 10
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                💡 Plantillas sugeridas
              </div>
              <div className="space-y-2">
                {PROMPT_SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => update('gemini_prompt_template', s.text)}
                    className="block w-full text-left p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-violet-500/40 transition group"
                  >
                    <div className="text-xs font-semibold text-violet-300 mb-1">{s.label}</div>
                    <div className="text-xs text-slate-500 group-hover:text-slate-400">{s.text}</div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/40 text-sm text-rose-200">
            {error}
          </div>
        )}
      </div>

      {/* Botones de navegación */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
          disabled={step === 1}
          className="px-4 py-2.5 text-sm font-semibold text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          ← Anterior
        </button>

        {step < 3 ? (
          <button
            onClick={() => setStep((s) => ((s + 1) as Step))}
            disabled={!canAdvance()}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 text-white font-semibold rounded-xl hover:scale-[1.02] active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            Siguiente
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!canAdvance() || submitting}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold rounded-xl hover:scale-[1.02] active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {submitting ? 'Creando...' : 'Crear módulo'}
            <Check className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
