'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { evaluateAchievements } from '@/lib/achievements/evaluate';

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
    try {
      const { data: material } = await supabase
        .from('teaching_materials')
        .select('id')
        .eq('classroom_id', modData.classroom_id)
        .eq('processing_status', 'completed')
        .limit(1).single();

      let context = modData.description;
      if (material?.id) {
        const { data: chunks } = await supabase
          .from('material_chunks').select('content')
          .eq('material_id', material.id).limit(5);
        if (chunks?.length > 0) context = chunks.map(c => c.content).join(' ');
      }

      const { data: aiConfig } = await supabase
        .from('classroom_ai_config')
        .select('*')
        .eq('classroom_id', modData.classroom_id)
        .single();

      const res = await fetch('/api/generate-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId, context, moduleTitle: modData.title, aiConfig })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.questions?.length > 0) {
          setQuestions(data.questions);
          setLoading(false);
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
  };

  const handleAnswer = (answer) => {
    if (answered) return;
    setSelected(answer);
    setAnswered(true);
    const q = questions[idx];
    if (q.type === 'multiple_choice' && answer === q.ok) setScore(s => s + 1);
    if (q.type === 'true_false' && answer === q.ok) setScore(s => s + 1);
    if (q.type === 'fill_blank') setScore(s => s + 1);
    if (q.type === 'short_answer') setScore(s => s + 1);
  };

  const nextQuestion = () => {
    if (idx < questions.length - 1) {
      setIdx(idx + 1);
      setAnswered(false);
      setSelected(null);
      setMatchAnswers({});
      setShortAnswerText('');
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
        {!answered ? (
          <button onClick={() => handleAnswer('filled')}
            className="w-full p-4 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-700">
            Ver respuesta correcta
          </button>
        ) : (
          <div className="bg-green-900 border border-green-500 p-4 rounded-lg">
            <p className="text-green-300 font-medium">Respuesta: {q.answers?.join(', ')}</p>
          </div>
        )}
      </div>
    );

    if (q.type === 'match') return (
      <div className="space-y-3">
        <p className="text-gray-300 text-sm mb-4">Conecta cada concepto con su definicion</p>
        {q.pairs?.map((pair, i) => (
          <div key={i} className="flex gap-3 items-center">
            <div className="flex-1 bg-purple-800 p-3 rounded-lg text-white text-sm font-medium">{pair.term}</div>
            <div className="text-gray-400">?</div>
            <div className="flex-1 bg-blue-800 p-3 rounded-lg text-white text-sm">{pair.def}</div>
          </div>
        ))}
        {!answered && (
          <button onClick={() => handleAnswer('matched')}
            className="w-full p-4 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-700 mt-4">
            Confirmar conexiones
          </button>
        )}
      </div>
    );

    if (q.type === 'short_answer') return (
      <div className="space-y-4">
        <textarea className="w-full bg-gray-700 text-white rounded-lg p-4 border border-gray-600 focus:border-purple-500 outline-none resize-none h-32"
          placeholder="Escribe tu respuesta aqui..." disabled={answered}
          value={shortAnswerText} onChange={(e) => setShortAnswerText(e.target.value)} />
        {!answered ? (
          <button onClick={() => handleAnswer('answered')} disabled={!shortAnswerText.trim()}
            className="w-full p-4 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-purple-600">
            Enviar respuesta
          </button>
        ) : (
          <div className="bg-blue-900 border border-blue-500 p-4 rounded-lg">
            <p className="text-blue-300 font-medium">Palabras clave esperadas: {q.keywords?.join(', ')}</p>
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
             q.type === 'short_answer' ? 'Respuesta Corta' : 'Pregunta'}
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