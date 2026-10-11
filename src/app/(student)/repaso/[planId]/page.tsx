'use client';

// Ronda de un plan de refuerzo personalizado (Sesion E.2).
// Reutiliza el modo "remediation" de /api/generate-questions (Sesion E.1):
// 4 preguntas efimeras (multiple_choice/true_false) sobre los conceptos
// debiles del plan. Cada ronda completada avanza modules_completed.

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { advanceRemediationPlan, type RemediationPlan } from '@/lib/actions/remediation-plans';
import { TonitoCharacter } from '@/components/tonito/TonitoCharacter';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { ChoiceQuestion, AnswerFeedback, choiceResult, correctChoiceText, type ChoiceKind, type ChoiceValue } from '@/components/lesson/ChoiceQuestion';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';

// Mismo shape simplificado (solo multiple_choice/true_false, sin
// minijuegos) que produce generateRemediationQuestions() en
// /api/generate-questions/route.ts para el modo "remediation".
type RemediationQuestion = {
  type: string;
  q: string;
  ok?: number | boolean;
  opts?: string[];
  exp?: string | null;
};

type RoundResult = { completed: boolean; bonusXp: number };

export default function RepasoPlanPage() {
  const params = useParams();
  const router = useRouter();
  const planId = params.planId as string;
  const supabase = createClient();

  const [plan, setPlan] = useState<RemediationPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<RemediationQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [selected, setSelected] = useState<number | boolean | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<RoundResult | null>(null);

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
    setPlan(planData as RemediationPlan);

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

  const handleAnswer = (answer: number | boolean) => {
    if (answered) return;
    const q = questions[idx];
    if (!q) return;
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
      <div role="status" className="theme-scope max-w-2xl mx-auto p-8 text-center text-fg-muted">
        <TonitoCharacter mood="thinking" animation="idle" gradient={['#6C5CE7', '#00D2D3']} size={90} />
        <p className="mt-4">Preparando tu repaso…</p>
      </div>
    );
  }

  if (error && !done) {
    return (
      <div className="theme-scope max-w-2xl mx-auto p-8 text-center space-y-4">
        <p role="alert" className="text-danger">{error}</p>
        <Button variant="secondary" onClick={() => router.push('/dashboard')}>
          Volver al inicio
        </Button>
      </div>
    );
  }

  // Narrowing explicito para TS: si no hay error y ya no esta cargando,
  // load() siempre dejo `plan` seteado (o retorno antes con un error).
  if (!plan) return null;

  if (done && result) {
    return (
      <div className="theme-scope max-w-2xl mx-auto p-4 sm:p-8">
        <Card className="p-8 text-center space-y-4 bg-success/10 border-success/40">
          <TonitoCharacter mood="celebrating" animation="supersaiyan" gradient={['#6C5CE7', '#00D2D3']} size={110} />
          <h1 className="text-2xl font-bold text-fg">¡Ronda completada!</h1>
          <p className="text-fg-muted">
            Acertaste {score}/{questions.length} preguntas.
          </p>
          <p className="text-accent-text font-bold text-lg">
            {result.bonusXp > 0 ? `+${result.bonusXp} XP bonus` : 'Hoy ya habías ganado el bonus de este plan.'}
          </p>
          {result.completed ? (
            <p className="text-success font-medium">¡Completaste todo el plan de refuerzo "{plan.title}"!</p>
          ) : (
            <p className="text-fg-muted text-sm">
              {(plan.modules_completed || 0) + 1}/{plan.modules_target} módulos completados del plan.
            </p>
          )}
          <Button size="lg" className="w-full" onClick={() => router.push('/dashboard')}>
            Volver al inicio
          </Button>
        </Card>
      </div>
    );
  }

  const q = questions[idx];
  if (!q) return null;
  const progress = ((idx + 1) / questions.length) * 100;

  // Resultado de la pregunta una vez respondida (se anuncia a lectores de pantalla y no depende solo del color).
  const kind = q.type as ChoiceKind;
  const isChoice = q.type === 'multiple_choice' || q.type === 'true_false';
  const result_ = isChoice ? choiceResult(answered, selected, q.ok as ChoiceValue | undefined) : null;
  const correctText = isChoice ? correctChoiceText(kind, q.opts || [], q.ok as ChoiceValue | undefined) : null;

  return (
    <div className="theme-scope max-w-2xl mx-auto p-4 sm:p-8 space-y-5">
      <div>
        <div className="flex justify-between text-xs text-fg-muted mb-1">
          <span>{plan.title}</span>
          <span>{idx + 1}/{questions.length}</span>
        </div>
        <ProgressBar value={progress} label={`Pregunta ${idx + 1} de ${questions.length}`} />
      </div>

      <Card className="p-6 space-y-5">
        <p className="text-fg text-lg font-bold">{q.q}</p>

        {isChoice && (
          <ChoiceQuestion
            kind={kind}
            options={q.opts || []}
            selected={selected}
            answered={answered}
            correct={q.ok as ChoiceValue | undefined}
            onAnswer={(v) => handleAnswer(v)}
          />
        )}

        <AnswerFeedback result={result_} correctText={correctText} />

        {answered && q.exp && <div className="bg-surface-2 border border-line rounded-lg p-3 text-sm text-fg-muted">{q.exp}</div>}

        {answered && (
          <Button size="lg" className="w-full" onClick={nextQuestion} loading={saving} autoFocus>
            {saving ? 'Guardando…' : idx + 1 < questions.length ? 'Siguiente' : 'Terminar ronda'}
          </Button>
        )}
      </Card>
    </div>
  );
}
