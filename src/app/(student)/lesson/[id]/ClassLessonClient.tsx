'use client';

// ClassLessonClient: cliente de lección para módulos AUTO-GENERATED
// Fase 11.D · Stud.ia
//
// Diferencias vs LessonClient legacy:
//   - Llama a generate-lesson-from-material (via server action wrapper) en vez de gemini-tutor
//   - Soporta 3 tipos de pregunta: multiple_choice, true_false, fill_blank
//   - Renderiza source_quote en el feedback ("📖 Del material de tu profesor...")
//
// Comparte el flujo general (5 preguntas, XP, achievements) con el legacy.
// Para reducir riesgo, no toca LessonClient ni gemini-tutor.

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
  BookOpen,
} from 'lucide-react';
import { generateLessonFromMaterial } from '@/lib/actions/classroom-map';
import { isFillAnswerCorrect } from '@/lib/lesson/normalize';
import { evaluateAchievements } from '@/lib/achievements/evaluate';
import { useGameStore } from '@/stores/useGameStore';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { createClient } from '@/lib/supabase/client';
import type { GeneratedLessonQuestion } from '@/types/database';

interface Props {
  module: any;
  streakDays: number;
  previousScore: number | null;
}

type Phase = 'loading' | 'question' | 'feedback' | 'completed' | 'error';

export function ClassLessonClient({ module, streakDays, previousScore }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { addXP, addCoins } = useGameStore();
  const { onCorrectAnswer, onWrongAnswer, showMessage, setMood } = useTonitoStore();

  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<GeneratedLessonQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Estado por-pregunta
  const [selectedMC, setSelectedMC] = useState<number | null>(null);
  const [selectedTF, setSelectedTF] = useState<boolean | null>(null);
  const [fillInput, setFillInput] = useState('');
  const [feedback, setFeedback] = useState<{
    isCorrect: boolean;
    message: string;
    sourceQuote?: string;
  } | null>(null);

  const [questionStart, setQuestionStart] = useState(Date.now());
  const [totalTime, setTotalTime] = useState(0);

  // Cargar preguntas del módulo
  const loadLesson = useCallback(async () => {
    setPhase('loading');
    setMood('thinking');
    showMessage(`¡Empecemos con "${module.title}"! 📚`, 4000);

    const r = await generateLessonFromMaterial(module.id, 5);
    if (!r.ok || !r.questions || r.questions.length === 0) {
      setError(r.error ?? 'No se pudo cargar la lección.');
      setPhase('error');
      setMood('sad');
      return;
    }
    setQuestions(r.questions);
    setQuestionStart(Date.now());
    setPhase('question');
    setMood('happy');
  }, [module.id, module.title, setMood, showMessage]);

  useEffect(() => {
    loadLesson();
  }, [loadLesson]);

  const current = questions[currentIdx];

  function evaluateCurrent(): { isCorrect: boolean; sourceQuote: string; explanation: string } {
    if (!current) return { isCorrect: false, sourceQuote: '', explanation: '' };
    if (current.question_type === 'multiple_choice') {
      const ok = selectedMC === current.data.correct_index;
      return {
        isCorrect: ok,
        sourceQuote: current.data.source_quote,
        explanation: current.data.explanation,
      };
    }
    if (current.question_type === 'true_false') {
      const ok = selectedTF === current.data.is_true;
      return {
        isCorrect: ok,
        sourceQuote: current.data.source_quote,
        explanation: current.data.explanation,
      };
    }
    // fill_blank
    const ok = isFillAnswerCorrect(
      fillInput,
      current.data.correct_answer,
      current.data.alternatives_accepted
    );
    return {
      isCorrect: ok,
      sourceQuote: current.data.source_quote,
      explanation: current.data.explanation,
    };
  }

  function handleSubmit() {
    if (!current) return;
    // Validar que haya selección
    if (current.question_type === 'multiple_choice' && selectedMC === null) return;
    if (current.question_type === 'true_false' && selectedTF === null) return;
    if (current.question_type === 'fill_blank' && fillInput.trim().length === 0) return;

    const elapsed = Math.floor((Date.now() - questionStart) / 1000);
    setTotalTime((t) => t + elapsed);

    const ev = evaluateCurrent();
    if (ev.isCorrect) {
      setCorrectCount((c) => c + 1);
      onCorrectAnswer();
    } else {
      onWrongAnswer();
    }

    setFeedback({
      isCorrect: ev.isCorrect,
      message: ev.explanation,
      sourceQuote: ev.sourceQuote,
    });
    setPhase('feedback');
  }

  async function handleNext() {
    // Reset estados por-pregunta
    setSelectedMC(null);
    setSelectedTF(null);
    setFillInput('');
    setFeedback(null);

    if (currentIdx + 1 >= questions.length) {
      // Lección completada
      await finishLesson();
      return;
    }
    setCurrentIdx((i) => i + 1);
    setQuestionStart(Date.now());
    setPhase('question');
    setMood('happy');
  }

  async function finishLesson() {
    setPhase('completed');
    const score = Math.round((correctCount / questions.length) * 100);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Calcular XP usando RPC existente
    const { data: xpData } = await supabase.rpc('calculate_xp', {
      p_base_xp: module.base_xp_reward ?? 10,
      p_streak_days: streakDays,
      p_difficulty: module.difficulty_level,
      p_score: score,
      p_attempts: 1,
      p_time_seconds: totalTime,
      p_estimated_minutes: module.estimated_time_minutes ?? 5,
    } as any);
    const earnedXp = (xpData as number) ?? 10;
    const earnedCoins = Math.floor(earnedXp / 4);

    addXP(earnedXp);
    addCoins(earnedCoins);

    // UPDATE student_progress
    const { data: progress } = await supabase
      .from('student_progress')
      .select('id, best_score, attempts')
      .eq('student_id', user.id)
      .eq('module_id', module.id)
      .single();

    if (progress) {
      await supabase
        .from('student_progress')
        .update({
          status: 'completed',
          completion_percentage: 100,
          score,
          best_score: Math.max((progress as any).best_score ?? 0, score),
          attempts: ((progress as any).attempts ?? 0) + 1,
          time_spent_seconds: totalTime,
          earned_xp: earnedXp,
          earned_coins: earnedCoins,
          completed_at: new Date().toISOString(),
        } as any)
        .eq('id', (progress as any).id);
    }

    await evaluateAchievements(user.id);
    setMood('happy');
    showMessage(`¡Lección completada! +${earnedXp} XP 🎉`, 6000);
  }

  // ============================================================
  // Render
  // ============================================================

  if (phase === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="w-10 h-10 text-violet-300 animate-spin" />
        <p className="text-white/80">Generando tu lección con IA…</p>
        <p className="text-xs text-white/50">Puede tardar 10-30s</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="max-w-md mx-auto rounded-2xl bg-red-500/15 border border-red-500/30 p-6 text-center">
        <XCircle className="w-10 h-10 text-red-300 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-white mb-2">No se pudo cargar la lección</h2>
        <p className="text-sm text-red-200 mb-4">{error}</p>
        <button
          onClick={loadLesson}
          className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl text-sm transition"
        >
          Reintentar
        </button>
        <Link
          href="/dashboard"
          className="block mt-2 text-xs text-white/60 hover:text-white"
        >
          Volver al inicio
        </Link>
      </div>
    );
  }

  if (phase === 'completed') {
    const score = Math.round((correctCount / questions.length) * 100);
    return (
      <div className="max-w-md mx-auto rounded-2xl bg-white/10 backdrop-blur border border-white/20 p-8 text-center">
        <Sparkles className="w-12 h-12 text-yellow-300 mx-auto mb-3" />
        <h2 className="text-2xl font-bold text-white mb-1">¡Lección completada!</h2>
        <p className="text-white/80 mb-4">
          {correctCount} de {questions.length} correctas · Score {score}%
        </p>
        <Link
          href="/dashboard"
          className="inline-block bg-white text-violet-600 px-6 py-3 rounded-xl font-semibold hover:bg-white/90 transition"
        >
          Volver al inicio
        </Link>
      </div>
    );
  }

  // Render question/feedback
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          Salir
        </Link>
        <div className="text-sm text-white/80">
          Pregunta {currentIdx + 1} de {questions.length}
        </div>
      </div>

      <div className="rounded-2xl bg-white/10 backdrop-blur border border-white/20 p-6">
        {phase === 'question' && current && (
          <QuestionView
            q={current}
            selectedMC={selectedMC}
            setSelectedMC={setSelectedMC}
            selectedTF={selectedTF}
            setSelectedTF={setSelectedTF}
            fillInput={fillInput}
            setFillInput={setFillInput}
            onSubmit={handleSubmit}
          />
        )}

        {phase === 'feedback' && feedback && (
          <FeedbackView
            isCorrect={feedback.isCorrect}
            message={feedback.message}
            sourceQuote={feedback.sourceQuote}
            onNext={handleNext}
            isLast={currentIdx + 1 >= questions.length}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================
// Subcomponente: vista de la pregunta
// ============================================================

function QuestionView({
  q,
  selectedMC,
  setSelectedMC,
  selectedTF,
  setSelectedTF,
  fillInput,
  setFillInput,
  onSubmit,
}: {
  q: GeneratedLessonQuestion;
  selectedMC: number | null;
  setSelectedMC: (n: number) => void;
  selectedTF: boolean | null;
  setSelectedTF: (b: boolean) => void;
  fillInput: string;
  setFillInput: (s: string) => void;
  onSubmit: () => void;
}) {
  if (q.question_type === 'multiple_choice') {
    return (
      <>
        <p className="text-lg text-white font-medium mb-5">{q.data.question}</p>
        <div className="space-y-2">
          {q.data.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => setSelectedMC(i)}
              className={`w-full text-left px-4 py-3 rounded-xl border-2 transition ${
                selectedMC === i
                  ? 'bg-violet-500/30 border-violet-300 text-white'
                  : 'bg-white/5 border-white/15 text-white/90 hover:bg-white/10'
              }`}
            >
              <span className="font-mono text-xs text-white/50 mr-2">
                {String.fromCharCode(65 + i)}
              </span>
              {opt}
            </button>
          ))}
        </div>
        <SubmitButton disabled={selectedMC === null} onClick={onSubmit} />
      </>
    );
  }

  if (q.question_type === 'true_false') {
    return (
      <>
        <p className="text-lg text-white font-medium mb-5">{q.data.statement}</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setSelectedTF(true)}
            className={`py-6 rounded-xl border-2 font-bold text-lg transition ${
              selectedTF === true
                ? 'bg-emerald-500/30 border-emerald-300 text-white'
                : 'bg-white/5 border-white/15 text-white/90 hover:bg-emerald-500/10'
            }`}
          >
            ✓ Verdadero
          </button>
          <button
            onClick={() => setSelectedTF(false)}
            className={`py-6 rounded-xl border-2 font-bold text-lg transition ${
              selectedTF === false
                ? 'bg-red-500/30 border-red-300 text-white'
                : 'bg-white/5 border-white/15 text-white/90 hover:bg-red-500/10'
            }`}
          >
            ✗ Falso
          </button>
        </div>
        <SubmitButton disabled={selectedTF === null} onClick={onSubmit} />
      </>
    );
  }

  // fill_blank
  return (
    <>
      <p className="text-lg text-white font-medium mb-5">{q.data.sentence_with_blank}</p>
      <input
        type="text"
        autoFocus
        value={fillInput}
        onChange={(e) => setFillInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && fillInput.trim()) onSubmit();
        }}
        placeholder="Escribe tu respuesta…"
        className="w-full px-4 py-3 rounded-xl bg-white/10 border-2 border-white/20 text-white placeholder:text-white/40 focus:outline-none focus:border-violet-300"
      />
      <p className="text-xs text-white/50 mt-2">
        Acepta variantes (sin distinguir mayúsculas o tildes).
      </p>
      <SubmitButton disabled={fillInput.trim().length === 0} onClick={onSubmit} />
    </>
  );
}

function SubmitButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mt-5 w-full bg-white text-violet-600 py-3 rounded-xl font-bold disabled:bg-white/30 disabled:text-white/60 disabled:cursor-not-allowed transition"
    >
      Confirmar
    </button>
  );
}

// ============================================================
// Subcomponente: feedback con source quote
// ============================================================

function FeedbackView({
  isCorrect,
  message,
  sourceQuote,
  onNext,
  isLast,
}: {
  isCorrect: boolean;
  message: string;
  sourceQuote?: string;
  onNext: () => void;
  isLast: boolean;
}) {
  return (
    <div className="space-y-4">
      <div
        className={`flex items-start gap-3 p-4 rounded-xl border-2 ${
          isCorrect
            ? 'bg-emerald-500/20 border-emerald-400/50'
            : 'bg-red-500/20 border-red-400/50'
        }`}
      >
        {isCorrect ? (
          <CheckCircle2 className="w-6 h-6 text-emerald-300 flex-shrink-0 mt-0.5" />
        ) : (
          <XCircle className="w-6 h-6 text-red-300 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white mb-1">
            {isCorrect ? '¡Correcto!' : 'Incorrecto'}
          </h3>
          <p className="text-sm text-white/90">{message}</p>
        </div>
      </div>

      {sourceQuote && (
        <div className="rounded-xl bg-white/10 border border-white/20 p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-white/60 mb-2">
            <BookOpen className="w-3.5 h-3.5" />
            Del material de tu profesor
          </div>
          <p className="text-sm italic text-white/90">"{sourceQuote}"</p>
        </div>
      )}

      <button
        onClick={onNext}
        className="w-full bg-white text-violet-600 py-3 rounded-xl font-bold hover:bg-white/90 transition"
      >
        {isLast ? 'Terminar lección' : 'Siguiente pregunta →'}
      </button>
    </div>
  );
}
