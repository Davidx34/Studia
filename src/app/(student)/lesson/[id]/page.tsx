'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { evaluateAchievements } from '@/lib/achievements/evaluate';
import { normalizeAnswer } from '@/lib/lesson/normalize';
import { LessonQuestionMatch } from '@/components/LessonQuestionMatch';
import { ElDescifrador } from '@/components/minigames/ElDescifrador';
import { TimelineGame } from '@/components/minigames/TimelineGame';
import { CategoriesGame } from '@/components/minigames/CategoriesGame';
import { FlashcardGame } from '@/components/minigames/FlashcardGame';
import { useTonitoStore } from '@/stores/useTonitoStore';

export default function LessonPage() {
  const params = useParams();
  const router = useRouter();
  const moduleId = params.id;
  const supabase = createClient();
  const [mod, setMod] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [selected, setSelected] = useState(null);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [matchAnswers, setMatchAnswers] = useState({});
  const [shortAnswerText, setShortAnswerText] = useState('');
  const [shortAnswerMatchedCount, setShortAnswerMatchedCount] = useState(0);
  const [fillBlankText, setFillBlankText] = useState('');
  const [fillBlankAttempts, setFillBlankAttempts] = useState(0);
  const [fillBlankFeedback, setFillBlankFeedback] = useState(null); // 'correct' | 'retry' | 'revealed'

  useEffect(() => {
    const load = async () => {
      const { data: modData } = await supabase
        .from('content_modules')
        .select('*, classrooms(id, name)')
        .eq('id', moduleId)
        .single();
      if (!modData) { router.push('/dashboard'); return; }
      setMod(modData);
      await generateQuestions(modData);
    };
    load();
  }, []);

  const generateQuestions = async (modData) => {
    const { setMood, showMessage } = useTonitoStore.getState();
    setMood('thinking');
    showMessage('Espera, estoy preparando preguntas especiales...', 0);
    try {
      // La seleccion de contexto relevante (RAG via match_material_chunks) ahora
      // vive en el servidor (/api/generate-questions), que ya tiene acceso al
      // GEMINI_API_KEY necesario para generar el embedding de busqueda.
      const { data: aiConfig } = await supabase
        .from('classroom_ai_config')
        .select('*')
        .eq('classroom_id', modData.classroom_id)
        .single();

      const res = await fetch('/api/generate-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId, moduleTitle: modData.title, aiConfig })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.questions?.length > 0) {
          setQuestions(data.questions);
          setLoading(false);
          setMood('happy');
          showMessage('¡Listo! Vamos a aprender 🚀');
          return;
        }
      }
    } catch (e) {
      console.warn('Error generando preguntas:', e);
    }

    setQuestions([
      { type: 'multiple_choice', q: 'Pregunta 1 sobre ' + modData.title, opts: ['A. Opcion A', 'B. Opcion B', 'C. Opcion C', 'D. Opcion D'], ok: 0, exp: 'Correcto.' },
      { type: 'true_false', q: 'Este modulo es importante para el aprendizaje', ok: true, exp: 'Si, es fundamental.' },
      { type: 'multiple_choice', q: 'Pregunta 3 sobre ' + modData.title, opts: ['A. Opcion A', 'B. Opcion B', 'C. Opcion C', 'D. Opcion D'], ok: 2, exp: 'Correcto.' },
    ]);
    setLoading(false);
    setMood('happy');
    showMessage('¡Listo! Vamos a aprender 🚀');
  };

  // Registra cada intento de respuesta en question_attempts (granularidad por pregunta,
  // no solo al completar el modulo), para poder agregar aciertos/errores por concept_tag.
  // Las preguntas de fallback (sin conexion a Cohere) no tienen id real en lesson_questions,
  // asi que se omiten en vez de violar la FK.
  const recordAttempt = async (question, wasCorrect, answerGiven) => {
    if (!question?.id) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('question_attempts').insert({
        student_id: user.id,
        question_id: question.id,
        module_id: moduleId,
        classroom_id: mod.classroom_id,
        concept_tag: question.concept_tag ?? null,
        was_correct: wasCorrect,
        answer_given: answerGiven ?? null,
      });
    } catch (e) {
      console.warn('Error registrando intento:', e);
    }
  };

  const handleAnswer = (answer) => {
    if (answered) return;
    setSelected(answer);
    setAnswered(true);
    const q = questions[idx];
    if (q.type === 'multiple_choice') {
      const correct = answer === q.ok;
      if (correct) setScore(s => s + 1);
      recordAttempt(q, correct, { selectedIndex: answer });
    }
    if (q.type === 'true_false') {
      const correct = answer === q.ok;
      if (correct) setScore(s => s + 1);
      recordAttempt(q, correct, { selected: answer });
    }
    if (q.type === 'short_answer') setScore(s => s + 1);
  };

  const handleShortAnswerSubmit = () => {
    const q = questions[idx];
    const norm = normalizeAnswer(shortAnswerText);
    const matched = (q.keywords || []).filter((k) => norm.includes(normalizeAnswer(k))).length;
    setShortAnswerMatchedCount(matched);
    const allKeywordsMatched = (q.keywords?.length || 0) > 0 && matched === q.keywords.length;
    recordAttempt(q, allKeywordsMatched, { text: shortAnswerText });
    handleAnswer('answered');
  };

  const handleFillBlankSubmit = () => {
    const q = questions[idx];
    const norm = normalizeAnswer(fillBlankText);
    const total = q.answers?.length || 0;
    const matched = (q.answers || []).filter((a) => norm.includes(normalizeAnswer(a))).length;
    const allMatched = total > 0 && matched === total;

    if (allMatched) {
      setFillBlankFeedback('correct');
      setAnswered(true);
      setSelected('filled');
      setScore((s) => s + 1);
      recordAttempt(q, true, { text: fillBlankText });
      return;
    }

    const nextAttempts = fillBlankAttempts + 1;
    setFillBlankAttempts(nextAttempts);
    if (nextAttempts >= 2) {
      setFillBlankFeedback('revealed');
      setAnswered(true);
      setSelected('filled');
      recordAttempt(q, false, { text: fillBlankText });
    } else {
      setFillBlankFeedback('retry');
    }
  };

  const nextQuestion = () => {
    if (idx < questions.length - 1) {
      setIdx(idx + 1);
      setAnswered(false);
      setSelected(null);
      setMatchAnswers({});
      setShortAnswerText('');
      setShortAnswerMatchedCount(0);
      setFillBlankText('');
      setFillBlankAttempts(0);
      setFillBlankFeedback(null);
    } else {
      setDone(true);
      saveProgress(score);
    }
  };

  const saveProgress = async (finalScore) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const scorePercent = Math.round((finalScore / questions.length) * 100);
      const now = new Date().toISOString();

      const { data: existing } = await supabase
        .from('student_progress')
        .select('status, attempts, best_score, started_at')
        .eq('student_id', user.id)
        .eq('module_id', moduleId)
        .maybeSingle();

      const alreadyCompleted = existing?.status === 'completed';

      await supabase.from('student_progress').upsert({
        student_id: user.id,
        module_id: moduleId,
        status: 'completed',
        completion_percentage: 100,
        score: scorePercent,
        best_score: Math.max(existing?.best_score ?? 0, scorePercent),
        attempts: (existing?.attempts ?? 0) + 1,
        earned_xp: mod.base_xp_reward,
        started_at: existing?.started_at ?? now,
        completed_at: now,
        last_attempt_at: now,
      }, { onConflict: 'student_id,module_id' });

      // El XP solo se otorga la primera vez que se completa el modulo, para evitar farmear reintentos.
      if (!alreadyCompleted) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('total_xp')
          .eq('id', user.id)
          .single();
        await supabase
          .from('profiles')
          .update({ total_xp: (profile?.total_xp ?? 0) + (mod.base_xp_reward ?? 0) })
          .eq('id', user.id);
      }

      // Verificar y otorgar logros (el modal de desbloqueo aparece via Realtime).
      await evaluateAchievements();
    } catch (e) {
      console.warn('Error guardando progreso:', e);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-64 text-white p-8">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4"></div>
      <p className="text-lg">Generando preguntas personalizadas...</p>
    </div>
  );

  if (!mod) return <div className="text-white p-8">No encontrado</div>;

  if (done) return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="bg-green-600 p-8 text-white rounded-lg text-center">
        <h1 className="text-4xl font-bold mb-4">Completado!</h1>
        <p className="text-2xl mb-2">{score}/{questions.length} correctas</p>
        <p className="text-lg mb-2 opacity-80">{Math.round((score/questions.length)*100)}% de acierto</p>
        <p className="text-lg mb-8">+{mod.base_xp_reward} XP ganados</p>
        <button onClick={() => router.back()} className="bg-white text-green-600 px-8 py-3 rounded-lg font-bold">Volver</button>
      </div>
    </div>
  );

  const q = questions[idx];
  const progress = ((idx + 1) / questions.length) * 100;

  const renderQuestion = () => {
    if (q.type === 'multiple_choice') return (
      <div className="space-y-3">
        {q.opts.map((o, i) => (
          <button key={i} onClick={() => handleAnswer(i)} disabled={answered}
            className={"w-full p-4 rounded-lg text-left font-medium border-2 transition-all " + (
              selected === i ? (i === q.ok ? 'bg-green-600 text-white border-green-400' : 'bg-red-600 text-white border-red-400')
              : answered && i === q.ok ? 'bg-green-600 text-white border-green-400'
              : 'bg-gray-700 text-gray-200 hover:bg-gray-600 border-transparent'
            )}>{o}</button>
        ))}
      </div>
    );

    if (q.type === 'true_false') return (
      <div className="grid grid-cols-2 gap-4">
        {[true, false].map((val) => (
          <button key={String(val)} onClick={() => handleAnswer(val)} disabled={answered}
            className={"p-6 rounded-lg text-center font-bold text-xl border-2 transition-all " + (
              selected === val ? (val === q.ok ? 'bg-green-600 text-white border-green-400' : 'bg-red-600 text-white border-red-400')
              : answered && val === q.ok ? 'bg-green-600 text-white border-green-400'
              : 'bg-gray-700 text-white hover:bg-gray-600 border-transparent'
            )}>{val ? 'Verdadero' : 'Falso'}</button>
        ))}
      </div>
    );

    if (q.type === 'fill_blank') return (
      <div className="space-y-4">
        <p className="text-gray-300 text-sm">Escribe las palabras que faltan en los espacios</p>
        <div className="bg-gray-700 p-4 rounded-lg text-white text-lg">{q.q}</div>
        <textarea className="w-full bg-gray-700 text-white rounded-lg p-4 border border-gray-600 focus:border-purple-500 outline-none resize-none h-24"
          placeholder="Escribe aqui las palabras que faltan..." disabled={answered}
          value={fillBlankText} onChange={(e) => setFillBlankText(e.target.value)} />
        {fillBlankFeedback === 'retry' && (
          <div className="bg-red-900 border border-red-500 p-3 rounded-lg text-red-200 text-sm font-medium">
            Intenta de nuevo, te falta al menos una palabra clave.
          </div>
        )}
        {!answered ? (
          <button onClick={handleFillBlankSubmit} disabled={!fillBlankText.trim()}
            className="w-full p-4 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-purple-600">
            Enviar respuesta
          </button>
        ) : fillBlankFeedback === 'correct' ? (
          <div className="bg-green-900 border border-green-500 p-4 rounded-lg">
            <p className="text-green-300 font-medium">¡Correcto! 🎉</p>
          </div>
        ) : (
          <div className="bg-blue-900 border border-blue-500 p-4 rounded-lg">
            <p className="text-blue-300 font-medium">Respuesta: {q.answers?.join(', ')}</p>
          </div>
        )}
      </div>
    );

    if (q.type === 'match') return (
      <LessonQuestionMatch
        key={idx}
        pairs={q.pairs || []}
        disabled={answered}
        onComplete={(correct) => {
          setAnswered(true);
          setSelected('matched');
          if (correct) setScore((s) => s + 1);
          recordAttempt(q, correct, null);
        }}
      />
    );

    if (q.type === 'el_descifrador') return (
      <ElDescifrador
        key={idx}
        gameData={q.game_data || {}}
        disabled={answered}
        onComplete={(correct) => {
          setAnswered(true);
          setSelected('descifrado');
          if (correct) setScore((s) => s + 1);
          recordAttempt(q, correct, null);
        }}
      />
    );

    if (q.type === 'linea_del_tiempo') return (
      <TimelineGame
        key={idx}
        gameData={q.game_data || {}}
        disabled={answered}
        onComplete={(correct) => {
          setAnswered(true);
          setSelected('ordenado');
          if (correct) setScore((s) => s + 1);
          recordAttempt(q, correct, null);
        }}
      />
    );

    if (q.type === 'categorias_rapidas') return (
      <CategoriesGame
        key={idx}
        gameData={q.game_data || {}}
        disabled={answered}
        onComplete={(correct) => {
          setAnswered(true);
          setSelected('clasificado');
          if (correct) setScore((s) => s + 1);
          recordAttempt(q, correct, null);
        }}
      />
    );

    if (q.type === 'flashcard_rapida') return (
      <FlashcardGame
        key={idx}
        gameData={q.game_data || {}}
        disabled={answered}
        onComplete={(correct) => {
          setAnswered(true);
          setSelected('emparejado');
          if (correct) setScore((s) => s + 1);
          recordAttempt(q, correct, null);
        }}
      />
    );

    if (q.type === 'short_answer') return (
      <div className="space-y-4">
        <textarea className="w-full bg-gray-700 text-white rounded-lg p-4 border border-gray-600 focus:border-purple-500 outline-none resize-none h-32"
          placeholder="Escribe tu respuesta aqui..." disabled={answered}
          value={shortAnswerText} onChange={(e) => setShortAnswerText(e.target.value)} />
        {!answered ? (
          <button onClick={handleShortAnswerSubmit} disabled={!shortAnswerText.trim()}
            className="w-full p-4 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-purple-600">
            Enviar respuesta
          </button>
        ) : (
          <div className="bg-blue-900 border border-blue-500 p-4 rounded-lg space-y-1">
            <p className="text-blue-300 font-medium">
              {shortAnswerMatchedCount > 0
                ? `✅ Mencionaste ${shortAnswerMatchedCount} de ${q.keywords?.length || 0} palabras clave`
                : 'Palabras clave esperadas:'}
            </p>
            <p className="text-blue-100 text-sm">{q.keywords?.join(', ')}</p>
          </div>
        )}
      </div>
    );

    return null;
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">{mod.title}</h1>
        <p className="text-gray-300 text-sm mb-4">{mod.description}</p>
        <div className="flex justify-between text-sm text-gray-400 mb-2">
          <span>Pregunta {idx + 1} de {questions.length}</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all" style={{width: progress + '%'}}></div>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-8 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs bg-purple-700 text-white px-2 py-1 rounded">
            {q.type === 'multiple_choice' ? 'Opcion Multiple' :
             q.type === 'true_false' ? 'Verdadero/Falso' :
             q.type === 'fill_blank' ? 'Completar Frase' :
             q.type === 'match' ? 'Conectar Conceptos' :
             q.type === 'short_answer' ? 'Respuesta Corta' :
             q.type === 'el_descifrador' ? '🔤 El Descifrador' :
             q.type === 'linea_del_tiempo' ? '📅 Línea del Tiempo' :
             q.type === 'categorias_rapidas' ? '⏱️ Categorías Rápidas' :
             q.type === 'flashcard_rapida' ? '🃏 Flashcard Rápida' : 'Pregunta'}
          </span>
        </div>
        <p className="text-white font-bold text-lg mb-6">{q.q}</p>
        {renderQuestion()}
        {answered && q.exp && (
          <div className="mt-6 p-4 bg-blue-900 bg-opacity-50 border-l-4 border-blue-400 rounded">
            <p className="text-blue-200 font-medium">Explicacion:</p>
            <p className="text-blue-100 mt-1">{q.exp}</p>
          </div>
        )}
      </div>

      {answered && (
        <button onClick={nextQuestion}
          className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-4 rounded-xl hover:opacity-90 transition text-lg">
          {idx < questions.length - 1 ? 'Siguiente Pregunta' : 'Terminar Modulo'}
        </button>
      )}
    </div>
  );
}