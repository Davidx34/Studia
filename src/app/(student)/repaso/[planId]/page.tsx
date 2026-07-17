'use client';

// Ronda de un plan de refuerzo personalizado (Sesion E.2).
// Reutiliza el modo "remediation" de /api/generate-questions (Sesion E.1):
// 4 preguntas efimeras (multiple_choice/true_false) sobre los conceptos
// debiles del plan. Cada ronda completada avanza modules_completed.

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { advanceRemediationPlan } from '@/lib/actions/remediation-plans';
import { TonitoCharacter } from '@/components/tonito/TonitoCharacter';
import { useTonitoStore } from '@/stores/useTonitoStore';

export default function RepasoPlanPage() {
  const params = useParams();
  const router = useRouter();
  const planId = params.planId;
  const supabase = createClient();

  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [selected, setSelected] = useState(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // { completed, bonusXp }

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data: planData } = await supabase
      .from('remediation_plans')
      .select('*')
      .eq('id', planId)
      .single();
    if (!planData) {
      setError('No se encontró este plan de refuerzo.');
      setLoading(false);
      return;
    }
    setPlan(planData);

    const { data: anchorModule } = await supabase
      .from('content_modules')
      .select('id, title')
      .eq('classroom_id', planData.classroom_id)
      .order('order_index')
      .limit(1)
      .maybeSingle();

    try {
      const res = await fetch('/api/generate-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moduleId: anchorModule?.id ?? planData.classroom_id,
          moduleTitle: planData.title,
          remediationConcepts: planData.target_concepts,
        }),
      });
      const data = res.ok ? await res.json() : null;
      if (data?.questions?.length > 0) {
        setQuestions(data.questions);
        useTonitoStore.getState().setMood('encouraging');
        useTonitoStore.getState().showMessage('¡Vamos con esta ronda! 💪', 3000);
      } else {
        setError('No se pudieron generar las preguntas del repaso. Intenta más tarde.');
      }
    } catch (e) {
      setError('No se pudieron generar las preguntas del repaso. Intenta más tarde.');
    }
    setLoading(false);
  };

  const handleAnswer = (answer) => {
    if (answered) return;
    const q = questions[idx];
    setSelected(answer);
    setAnswered(true);
    const correct = answer === q.ok;
    if (correct) {
      setScore((s) => s + 1);
      useTonitoStore.getState().onCorrectAnswer();
    } else {
      useTonitoStore.getState().onWrongAnswer();
    }
  };

  const nextQuestion = async () => {
    if (idx + 1 < questions.length) {
      setIdx((i) => i + 1);
      setAnswered(false);
      setSelected(null);
      return;
    }
    setSaving(true);
    const scorePercent = Math.round((score / questions.length) * 100);
    const res = await advanceRemediationPlan(planId, scorePercent);
    setSaving(false);
    if (res.ok) {
      setResult({ completed: res.completed, bonusXp: res.bonusXp });
      useTonitoStore.getState().onModuleComplete(100);
    } else {
      setError(res.error);
    }
    setDone(true);
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center text-gray-300">
        <TonitoCharacter mood="thinking" animation="idle" gradient={['#6C5CE7', '#00D2D3']} size={90} />
        <p className="mt-4">Preparando tu repaso…</p>
      </div>
    );
  }

  if (error && !done) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center space-y-4">
        <p className="text-red-300">{error}</p>
        <button onClick={() => router.push('/dashboard')} className="px-4 py-2 rounded-lg bg-gray-700 text-white font-bold hover:bg-gray-600">
          Volver al dashboard
        </button>
      </div>
    );
  }

  if (done && result) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="bg-gray-800 rounded-xl p-8 text-center space-y-4">
          <TonitoCharacter mood="celebrating" animation="supersaiyan" gradient={['#6C5CE7', '#00D2D3']} size={110} />
          <h1 className="text-2xl font-bold text-white">¡Ronda completada! 🎉</h1>
          <p className="text-gray-300">
            Acertaste {score}/{questions.length} preguntas.
          </p>
          <p className="text-amber-300 font-bold text-lg">+{result.bonusXp} XP bonus</p>
          {result.completed ? (
            <p className="text-emerald-300 font-medium">
              ¡Completaste todo el plan de refuerzo "{plan.title}"! 🏆
            </p>
          ) : (
            <p className="text-gray-400 text-sm">
              {(plan.modules_completed || 0) + 1}/{plan.modules_target} módulos completados del plan.
            </p>
          )}
          <button
            onClick={() => router.push('/dashboard')}
            className="w-full p-4 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-700"
          >
            Volver al dashboard
          </button>
        </div>
      </div>
    );
  }

  const q = questions[idx];
  if (!q) return null;
  const progress = ((idx + 1) / questions.length) * 100;

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-8 space-y-5">
      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>{plan.title}</span>
          <span>{idx + 1}/{questions.length}</span>
        </div>
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-violet-400 to-fuchsia-400 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-6 space-y-5">
        <p className="text-white text-lg font-bold">{q.q}</p>

        {q.type === 'multiple_choice' && (
          <div className="space-y-3">
            {q.opts.map((o, i) => (
              <button
                key={i}
                onClick={() => handleAnswer(i)}
                disabled={answered}
                className={
                  'w-full p-4 rounded-lg text-left font-medium border-2 transition-all ' +
                  (selected === i
                    ? i === q.ok
                      ? 'bg-green-600 text-white border-green-400'
                      : 'bg-red-600 text-white border-red-400'
                    : answered && i === q.ok
                    ? 'bg-green-600 text-white border-green-400'
                    : 'bg-gray-700 text-gray-200 hover:bg-gray-600 border-transparent')
                }
              >
                {o}
              </button>
            ))}
          </div>
        )}

        {q.type === 'true_false' && (
          <div className="grid grid-cols-2 gap-4">
            {[true, false].map((val) => (
              <button
                key={String(val)}
                onClick={() => handleAnswer(val)}
                disabled={answered}
                className={
                  'p-6 rounded-lg text-center font-bold text-xl border-2 transition-all ' +
                  (selected === val
                    ? val === q.ok
                      ? 'bg-green-600 text-white border-green-400'
                      : 'bg-red-600 text-white border-red-400'
                    : answered && val === q.ok
                    ? 'bg-green-600 text-white border-green-400'
                    : 'bg-gray-700 text-white hover:bg-gray-600 border-transparent')
                }
              >
                {val ? 'Verdadero' : 'Falso'}
              </button>
            ))}
          </div>
        )}

        {answered && q.exp && (
          <div className="bg-gray-700/60 rounded-lg p-3 text-sm text-gray-300">{q.exp}</div>
        )}

        {answered && (
          <button
            onClick={nextQuestion}
            disabled={saving}
            className="w-full p-4 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-700 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : idx + 1 < questions.length ? 'Siguiente' : 'Terminar ronda'}
          </button>
        )}
      </div>
    </div>
  );
}
