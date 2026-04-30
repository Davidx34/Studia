'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { generateQuestion, evaluateAnswer, type GeneratedQuestion } from '@/lib/gemini/api';
import { evaluateAchievements } from '@/lib/achievements/evaluate';
import { useGameStore } from '@/stores/useGameStore';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft, Sparkles, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface Props {
  module: any;
  streakDays: number;
  previousScore: number | null;
}

const QUESTIONS_PER_LESSON = 5;

type LessonPhase = 'loading' | 'question' | 'feedback' | 'completed';

export function LessonClient({ module, streakDays, previousScore }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { addXP, addCoins } = useGameStore();
  const { onCorrectAnswer, onWrongAnswer, showMessage, setMood } = useTonitoStore();

  const [phase, setPhase] = useState<LessonPhase>('loading');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<GeneratedQuestion | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackIsCorrect, setFeedbackIsCorrect] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [questionStartTime, setQuestionStartTime] = useState<number>(Date.now());
  const [totalTime, setTotalTime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // ── Cargar siguiente pregunta ──
  const loadNextQuestion = useCallback(async () => {
    setPhase('loading');
    setSelectedAnswer(null);
    setFeedback(null);
    setError(null);
    setMood('thinking');

    try {
      const result = await generateQuestion(module.id);
      setCurrentQuestion(result.data);
      setQuestionStartTime(Date.now());
      setPhase('question');
      setMood('happy');
    } catch (err) {
      console.error('Error generating question:', err);
      setError('No pudimos cargar la pregunta. ¿Quieres intentar de nuevo?');
      setMood('sad');
    }
  }, [module.id, setMood]);

  // ── Inicialización ──
  useEffect(() => {
    showMessage(`¡Empecemos con "${module.title}"! 📚`, 4000);
    loadNextQuestion();
  }, [module.title, loadNextQuestion, showMessage]);

  // ── Manejar selección ──
  const handleSelect = async (idx: number) => {
    if (selectedAnswer !== null || !currentQuestion) return;
    setSelectedAnswer(idx);

    const isCorrect = idx === currentQuestion.correctIndex;
    const elapsed = Math.floor((Date.now() - questionStartTime) / 1000);
    setTotalTime((t) => t + elapsed);

    if (isCorrect) {
      setCorrectCount((c) => c + 1);
      onCorrectAnswer();
    } else {
      onWrongAnswer();
    }

    // Pedir feedback de Gemini en background mientras mostramos UI inmediata
    setFeedbackIsCorrect(isCorrect);
    setPhase('feedback');

    try {
      const result = await evaluateAnswer(
        module.id,
        currentQuestion.question,
        currentQuestion.options,
        currentQuestion.correctIndex,
        idx
      );
      setFeedback(result.message);
    } catch (err) {
      console.error('Error evaluating:', err);
      // Fallback al texto de explanation que viene con la pregunta
      setFeedback(currentQuestion.explanation);
    }
  };

  // ── Continuar tras feedback ──
  const handleContinue = async () => {
    if (questionIndex + 1 >= QUESTIONS_PER_LESSON) {
      await completeLesson();
    } else {
      setQuestionIndex((i) => i + 1);
      loadNextQuestion();
    }
  };

  // ── Completar lección ──
  const completeLesson = async () => {
    setPhase('completed');
    const score = Math.round((correctCount / QUESTIONS_PER_LESSON) * 100);

    // Calcular XP usando la función de la DB
    const { data: xpEarned } = await supabase.rpc('calculate_xp', {
      p_base_xp: module.base_xp_reward,
      p_streak_days: streakDays,
      p_difficulty: module.difficulty_level,
      p_score: score,
      p_attempts: 1,
      p_time_seconds: totalTime,
      p_estimated_minutes: module.estimated_time_minutes,
    });

    const finalXP = xpEarned || module.base_xp_reward;
    const finalCoins = Math.floor(finalXP * 0.4);

    // Actualizar store local (optimistic UI)
    await addXP(finalXP);
    addCoins(finalCoins);

    // Persistir progreso
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from('student_progress')
        .update({
          status: 'completed',
          completion_percentage: 100,
          score,
          best_score: previousScore !== null ? Math.max(previousScore, score) : score,
          attempts: 1,
          time_spent_seconds: totalTime,
          earned_xp: finalXP,
          earned_coins: finalCoins,
          completed_at: new Date().toISOString(),
        })
        .eq('student_id', user.id)
        .eq('module_id', module.id);

      // Actualizar streak
      await supabase.rpc('check_and_update_streak', { p_user_id: user.id });

      // Evaluar achievements (los nuevos llegan vía Realtime al notification bridge)
      await evaluateAchievements();
    }
  };

  // ── Render por fase ──
  const progressPct = ((questionIndex + (phase === 'feedback' || phase === 'completed' ? 1 : 0)) / QUESTIONS_PER_LESSON) * 100;

  return (
    <div className="space-y-4 min-h-[600px]">
      {/* Header con progreso */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/map')}
          className="p-2 rounded-xl bg-white/10 border border-white/20 hover:bg-white/20 transition"
          aria-label="Volver al mapa"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
        <div className="flex-1">
          <div className="text-xs text-white/60 font-semibold uppercase tracking-wider">
            {module.category} · Nivel {module.difficulty_level}
          </div>
          <div className="text-lg font-bold text-white">{module.title}</div>
        </div>
      </div>

      {/* Barra de progreso */}
      <div className="h-3 bg-white/10 rounded-full overflow-hidden border border-white/15">
        <div
          className="h-full bg-gradient-to-r from-yellow-300 via-orange-400 to-pink-500 transition-all duration-700 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Contenido por fase */}
      {phase === 'loading' && (
        <div className="flex flex-col items-center justify-center py-20 text-white/70">
          <Loader2 className="w-10 h-10 animate-spin mb-3" />
          <p className="text-sm">Toñito está pensando...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/20 border border-red-400/40 rounded-2xl p-4 text-white text-center">
          <p className="mb-3">{error}</p>
          <button
            onClick={loadNextQuestion}
            className="px-4 py-2 bg-white/20 rounded-xl hover:bg-white/30 transition font-semibold"
          >
            Reintentar
          </button>
        </div>
      )}

      {phase === 'question' && currentQuestion && (
        <div className="animate-slide-up">
          <div className="text-xs font-semibold text-white/60 mb-2">
            Pregunta {questionIndex + 1} de {QUESTIONS_PER_LESSON}
          </div>

          {/* Tarjeta de pregunta */}
          <div className="backdrop-blur-2xl bg-white/15 border border-white/25 rounded-3xl p-6 sm:p-8 mb-4 shadow-2xl">
            <h2 className="text-xl sm:text-2xl font-bold text-white leading-snug">
              {currentQuestion.question}
            </h2>
          </div>

          {/* Opciones */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {currentQuestion.options.map((option, idx) => {
              const isSelected = selectedAnswer === idx;
              const letters = ['A', 'B', 'C', 'D'];
              return (
                <button
                  key={idx}
                  onClick={() => handleSelect(idx)}
                  disabled={selectedAnswer !== null}
                  className={`group text-left p-4 rounded-2xl border-2 transition-all backdrop-blur-xl ${
                    isSelected
                      ? 'bg-white/30 border-white/50 scale-[0.98]'
                      : 'bg-white/10 border-white/20 hover:bg-white/20 hover:border-white/40 hover:scale-[1.02] active:scale-[0.98]'
                  } ${selectedAnswer !== null && !isSelected ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-white/20 border border-white/30 flex items-center justify-center font-bold text-white text-sm flex-shrink-0">
                      {letters[idx]}
                    </div>
                    <span className="font-medium text-white flex-1">{option}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {phase === 'feedback' && currentQuestion && selectedAnswer !== null && (
        <div className="animate-slide-up">
          {/* Banner de resultado */}
          <div
            className={`rounded-3xl p-6 mb-4 backdrop-blur-2xl border-2 ${
              feedbackIsCorrect
                ? 'bg-emerald-500/20 border-emerald-400/50'
                : 'bg-rose-500/20 border-rose-400/50'
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              {feedbackIsCorrect ? (
                <CheckCircle2 className="w-8 h-8 text-emerald-300" />
              ) : (
                <XCircle className="w-8 h-8 text-rose-300" />
              )}
              <div className="font-bold text-xl text-white">
                {feedbackIsCorrect ? '¡Correcto!' : 'No es correcto'}
              </div>
            </div>
            {!feedbackIsCorrect && (
              <p className="text-white/90 text-sm mb-3">
                La respuesta correcta era:{' '}
                <span className="font-bold">
                  {currentQuestion.options[currentQuestion.correctIndex]}
                </span>
              </p>
            )}
            <div className="bg-black/20 rounded-2xl p-4 mt-3">
              {feedback ? (
                <p className="text-white text-sm leading-relaxed">{feedback}</p>
              ) : (
                <div className="flex items-center gap-2 text-white/60 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Toñito está preparando la explicación...
                </div>
              )}
            </div>
          </div>

          <button
            onClick={handleContinue}
            className="w-full py-4 bg-gradient-to-r from-yellow-400 to-orange-500 text-white font-bold rounded-2xl shadow-xl hover:scale-[1.02] active:scale-[0.98] transition text-lg"
          >
            {questionIndex + 1 >= QUESTIONS_PER_LESSON ? 'Ver resultados ✨' : 'Siguiente pregunta →'}
          </button>
        </div>
      )}

      {phase === 'completed' && (
        <div className="animate-slide-up text-center py-8">
          <div className="text-6xl mb-4 animate-bounce">🎉</div>
          <h2 className="text-3xl font-bold text-white mb-2">¡Lección completada!</h2>
          <p className="text-white/70 mb-6">
            Acertaste {correctCount} de {QUESTIONS_PER_LESSON} preguntas
          </p>

          <div className="grid grid-cols-3 gap-3 max-w-md mx-auto mb-6">
            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-4">
              <div className="text-2xl font-bold text-white">
                {Math.round((correctCount / QUESTIONS_PER_LESSON) * 100)}
              </div>
              <div className="text-xs text-white/60">Puntaje</div>
            </div>
            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-4">
              <div className="text-2xl font-bold text-yellow-300">
                +{module.base_xp_reward}
              </div>
              <div className="text-xs text-white/60">XP base</div>
            </div>
            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-4">
              <div className="text-2xl font-bold text-amber-300">
                {Math.floor(totalTime / 60)}:{(totalTime % 60).toString().padStart(2, '0')}
              </div>
              <div className="text-xs text-white/60">Tiempo</div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <Link
              href="/map"
              className="flex-1 py-3 px-6 bg-white/15 border border-white/25 text-white font-semibold rounded-2xl hover:bg-white/25 transition"
            >
              Volver al mapa
            </Link>
            <Link
              href="/dashboard"
              className="flex-1 py-3 px-6 bg-gradient-to-r from-yellow-400 to-orange-500 text-white font-bold rounded-2xl hover:scale-[1.02] transition"
            >
              Al inicio
            </Link>
          </div>
        </div>
      )}


      <style jsx>{`
        @keyframes slide-up {
          0% { opacity: 0; transform: translateY(12px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.4s ease-out; }
      `}</style>
    </div>
  );
}
