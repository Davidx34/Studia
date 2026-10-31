'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { evaluateAchievements } from '@/lib/achievements/evaluate';
import { normalizeAnswer } from '@/lib/lesson/normalize';
import { reportShadow } from '@/lib/grading/shadowClient';
import type { MatchVerdict } from '@/components/LessonQuestionMatch';
import { LessonQuestionMatch } from '@/components/LessonQuestionMatch';
import { ElDescifrador } from '@/components/minigames/ElDescifrador';
import { TimelineGame } from '@/components/minigames/TimelineGame';
import { CategoriesGame } from '@/components/minigames/CategoriesGame';
import { FlashcardGame } from '@/components/minigames/FlashcardGame';
import { ImpostorCognitivoGame } from '@/components/minigames/ImpostorCognitivoGame';
import type { GameCheck } from '@/components/minigames/serverCheck';
import { AlquimiaConceptualGame } from '@/components/minigames/AlquimiaConceptualGame';
import { CuartoCrisisGame } from '@/components/minigames/CuartoCrisisGame';
import { JuicioConocimientoGame } from '@/components/minigames/JuicioConocimientoGame';
import { RemediationPrompt } from '@/components/lesson/RemediationPrompt';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { CinematicScene, type CinematicType } from '@/components/cinematics/CinematicScene';
import { useSoundFx } from '@/lib/sound/useSoundFx';
import { TonitoStateClip } from '@/components/tonito/TonitoStateClip';
import { MathText } from '@/components/MathText';
import { SourceHintBox } from '@/components/lesson/SourceHintBox';
import type { SourceHint } from '@/lib/grading/sourceHint';
import { isValidQuestion } from '@/lib/lesson/validateQuestion';
import type { ContentModule } from '@/types/database';
import { CheckCircle2 } from 'lucide-react';
import { ChoiceQuestion, AnswerFeedback, choiceResult, correctChoiceText, type ChoiceKind, type ChoiceValue } from '@/components/lesson/ChoiceQuestion';
import { Button } from '@/components/ui/Button';
import { ModuleMedia } from '@/components/lesson/ModuleMedia';
import { Card, Badge } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { cn } from '@/components/ui/cn';

const REMEDIATION_ACCURACY_THRESHOLD = 70;
const REMEDIATION_TRIGGER_SCORE = 80;

// Un 202 de /api/generate-questions significa "otra peticion ya esta generando este
// modulo", no un fallo: se espera y se reintenta. Antes solo se miraba res.ok y un 202
// (sin preguntas) caia directo a la pantalla de "No pude preparar esta leccion".
const BUSY_RETRY_MS = 3000;
const BUSY_MAX_ATTEMPTS = 60; // ~3 min: lo que tarda en caducar el bloqueo (LOCK_TTL_MS)

// Shape "hidratada" de una pregunta tal como la usa esta pagina (mezcla de
// filas cacheadas de lesson_questions y preguntas recien generadas que aun
// no tienen id) -- mismo shape que produce rowToQuestion() en
// /api/generate-questions/route.ts, no el tipo LessonQuestion de la DB
// (esa tiene opts/ok/pairs/etc como Json generico, no los arrays/tipos
// concretos que el render necesita).
type LessonPageQuestion = {
  id?: string;
  type: string;
  q: string;
  exp?: string | null;
  // Solo con calificacion en servidor y tras fallar: pasaje del material donde repasar lo que faltaba.
  src?: SourceHint | null;
  concept_tag?: string | null;
  opts?: string[];
  ok?: number | boolean;
  answers?: string[];
  pairs?: { term: string; def: string }[];
  keywords?: string[];
  game_type?: string;
  game_data?: any;
  // Calificacion en el servidor: la pregunta llega SIN claves; lo correcto se revela al responder.
  serverGraded?: boolean;
  terms?: string[]; // match (servidor): terminos
  defs?: string[]; // match (servidor): definiciones mezcladas
};

// Respuesta de /api/lesson/answer.
type ServerAnswer = {
  correct: boolean;
  final: boolean;
  tries: number;
  triesLeft?: number;
  detail?: { matched?: number; total?: number; perTerm?: boolean[] };
  reveal?: { ok?: number | boolean; answers?: string[]; keywords?: string[]; defs?: string[] } & Record<string, unknown>; // los minijuegos revelan otros campos (ver gameGrading.ts)
  explanation?: string | null;
  source?: SourceHint | null;
};

const CHECK_ERROR = 'No pude comprobar tu respuesta. Revisa tu conexion e intenta de nuevo.';

type ModuleWithClassroom = ContentModule & { classrooms: { id: string; name: string } | null };
type WeakConcept = { tag: string; accuracy: number };
type RemediationPhase = 'none' | 'offered' | 'active' | 'completed';
type FillBlankFeedback = 'correct' | 'retry' | 'revealed' | null;

export default function LessonPage() {
  const params = useParams();
  const router = useRouter();
  const moduleId = params.id as string;
  const supabase = createClient();
  const [mod, setMod] = useState<ModuleWithClassroom | null>(null);
  const [questions, setQuestions] = useState<LessonPageQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [selected, setSelected] = useState<number | boolean | string | null>(null);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  // Review 360 §3.6: si la generacion falla no se inventan preguntas, se dice.
  const [generationFailed, setGenerationFailed] = useState(false);
  const [shortAnswerText, setShortAnswerText] = useState('');
  const [shortAnswerMatchedCount, setShortAnswerMatchedCount] = useState(0);
  const [fillBlankText, setFillBlankText] = useState('');
  const [fillBlankAttempts, setFillBlankAttempts] = useState(0);
  const [fillBlankFeedback, setFillBlankFeedback] = useState<FillBlankFeedback>(null);
  // Calificacion en el servidor: intento abierto, respuesta en vuelo y error de conexion.
  const attemptIdRef = useRef<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  // Repaso dirigido automatico (Sesion E.1).
  const [moduleFinishing, setModuleFinishing] = useState(false);
  const [remediationPhase, setRemediationPhase] = useState<RemediationPhase>('none');
  const [weakConcepts, setWeakConcepts] = useState<WeakConcept[]>([]);
  const [remediationLoading, setRemediationLoading] = useState(false);
  const [remediationRowId, setRemediationRowId] = useState<string | null>(null);

  // Cinematicas (Sesion F.1): cola simple, se muestran en secuencia.
  const [cinematicQueue, setCinematicQueue] = useState<CinematicType[]>([]);
  const [showIntro, setShowIntro] = useState(true);
  const [studentName, setStudentName] = useState('');
  const [streakForCinematic, setStreakForCinematic] = useState(0);

  useEffect(() => {
    const load = async () => {
      const { data: modData } = await supabase
        .from('content_modules')
        .select('*, classrooms(id, name)')
        .eq('id', moduleId)
        .single();
      if (!modData) { router.push('/dashboard'); return; }
      setMod(modData as ModuleWithClassroom);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('full_name, username').eq('id', user.id).single();
        setStudentName(profile?.full_name?.split(' ')[0] || profile?.username || '');
      }
      await generateQuestions(modData as ModuleWithClassroom);
    };
    load();
  }, []);

  const generateQuestions = async (modData: ModuleWithClassroom) => {
    const { setMood, showMessage } = useTonitoStore.getState();
    setMood('thinking');
    showMessage('Espera, estoy preparando preguntas especiales...', 0);
    try {
      // La seleccion de contexto relevante (RAG via match_material_chunks) ahora
      // vive en el servidor (/api/generate-questions), que ya tiene acceso al
      // GEMINI_API_KEY necesario para generar el embedding de busqueda.
      // La configuracion de IA de la clase la lee el SERVIDOR a partir del moduleId
      // (ver /api/generate-questions): ya no se lee aqui ni viaja en la peticion.
      const requestQuestions = () => fetch('/api/generate-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId, moduleTitle: modData.title })
      });

      let res = await requestQuestions();
      for (let attempt = 0; res.status === 202 && attempt < BUSY_MAX_ATTEMPTS; attempt++) {
        showMessage('Otra persona esta preparando esta leccion. Esperamos un momento...', 0);
        await new Promise((r) => setTimeout(r, BUSY_RETRY_MS));
        res = await requestQuestions();
      }

      if (res.ok && res.status !== 202) {
        const data = await res.json();
        if (data.questions?.length > 0) {
          attemptIdRef.current = data.attemptId ?? null;
          setQuestions(data.questions);
          setLoading(false);
          lessonStartedAtRef.current = Date.now();
          markInProgress();
          setMood('happy');
          showMessage('¡Listo! Vamos a aprender 🚀');
          return;
        }
      }
    } catch (e) {
      console.warn('Error generando preguntas:', e);
    }

    // Review 360 (2026-09-13), §3.6: aqui habia un fallback que le servia al
    // estudiante 3 preguntas de relleno literales ("Pregunta 1 sobre <modulo>"
    // con opciones "A. Opcion A" ... "D. Opcion D"), indistinguibles de una
    // leccion real. Peor: el flujo seguia completo hasta saveProgress, asi que
    // se otorgaba el XP del modulo por responder "A. Opcion A"; y como esas
    // preguntas no tienen id en lesson_questions, recordAttempt las descartaba
    // (`if (!question?.id) return`), de modo que el profesor no tenia forma de
    // enterarse de que habia pasado.
    //
    // Un producto educativo no puede fingir contenido: si la generacion falla,
    // falla visible, sin XP y sin progreso, con la opcion de reintentar.
    console.error('[GENERACION_FALLIDA]', { moduleId, moduleTitle: modData.title });
    setGenerationFailed(true);
    setLoading(false);
    setMood('sad');
    showMessage('No pude preparar esta leccion. ¿Probamos de nuevo?', 0);
  };

  // Marca el modulo como empezado en cuanto el estudiante ve la primera
  // pregunta. Antes de este cambio, saveProgress escribia SIEMPRE
  // status:'completed'/completion_percentage:100 y no existia ni una sola
  // escritura de 'in_progress' en todo el codigo -- las 10 filas de
  // student_progress en produccion estaban en 'completed' por construccion.
  // Consecuencia: el producto no podia ver donde abandona un estudiante, que
  // es la informacion mas valiosa que tiene una herramienta educativa, y el
  // estado "en progreso" del mapa (LearningMap) representaba algo que nunca
  // habia ocurrido en produccion. Ver review 360 §3.5.
  const markInProgress = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: existing } = await supabase
        .from('student_progress')
        .select('status, started_at')
        .eq('student_id', user.id)
        .eq('module_id', moduleId)
        .maybeSingle();

      // Un modulo ya completado no vuelve a 'in_progress' por reintentarlo:
      // eso borraria el hecho de que el estudiante ya lo habia terminado.
      if (existing?.status === 'completed') return;

      const now = new Date().toISOString();
      await supabase.from('student_progress').upsert({
        student_id: user.id,
        module_id: moduleId,
        status: 'in_progress',
        completion_percentage: 0,
        started_at: existing?.started_at ?? now,
        last_attempt_at: now,
      }, { onConflict: 'student_id,module_id' });
    } catch (e) {
      console.warn('Error marcando modulo en progreso:', e);
    }
  };

  // Tiempo real dedicado a la leccion. student_progress.time_spent_seconds se
  // LEE en 4 lugares del panel del profesor (classroom-progress.ts:209 tiempo
  // total, :216-219 grafico de minutos por semana, :263 tiempo por estudiante)
  // y no se escribia en NINGUNO: las 10 filas de produccion tenian 0. El
  // docente abria "Progreso" y veia "0 min" para todo el curso, que es
  // justamente la pantalla que mas importa para justificar la herramienta.
  // Ver review 360 §3.5.
  //
  // Se mide desde que el estudiante ve la primera pregunta (no desde que entra
  // a la pantalla de carga) y se acumula sobre lo ya registrado, para que un
  // segundo intento sume en vez de pisar. El tope evita que una pestaña
  // olvidada abierta toda la noche contamine la metrica del profesor: es
  // preferible subestimar el tiempo a reportar 9 horas de "estudio".
  const lessonStartedAtRef = useRef<number | null>(null);
  const MAX_SESSION_SECONDS = 2 * 60 * 60;

  const elapsedSeconds = (): number => {
    if (lessonStartedAtRef.current === null) return 0;
    const secs = Math.round((Date.now() - lessonStartedAtRef.current) / 1000);
    return Math.max(0, Math.min(secs, MAX_SESSION_SECONDS));
  };

  // Racha de fallos seguidos (cualquier tipo de pregunta) para que Toñito
  // reaccione con tono compasivo tras 3+ fallos, en vez de solo animar cada uno.
  const wrongStreakRef = useRef(0);
  const { play } = useSoundFx();

  // Registra cada intento de respuesta en question_attempts (granularidad por pregunta,
  // no solo al completar el modulo), para poder agregar aciertos/errores por concept_tag.
  // Las preguntas de fallback (sin conexion a Cohere) no tienen id real en lesson_questions,
  // asi que se omiten en vez de violar la FK.
  // Sonido y animo de Tonito segun el resultado (no escribe nada).
  const reactToResult = (wasCorrect: boolean) => {
    play(wasCorrect ? 'coin' : 'error');
    if (wasCorrect) {
      wrongStreakRef.current = 0;
    } else {
      wrongStreakRef.current += 1;
      useTonitoStore.getState().onConsecutiveFails(wrongStreakRef.current);
    }
  };

  // Pide al servidor que califique una respuesta. null = no se pudo comprobar (red, sesion, intento cerrado...).
  const gradeOnServer = async (q: LessonPageQuestion, answer: unknown): Promise<ServerAnswer | null> => {
    if (!attemptIdRef.current || !q.id) return null;
    try {
      const res = await fetch('/api/lesson/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: attemptIdRef.current, questionId: q.id, answer }),
      });
      return res.ok ? ((await res.json()) as ServerAnswer) : null;
    } catch {
      return null;
    }
  };

  // Al cerrarse una pregunta el servidor revela la respuesta y la explicacion: se funden en la pregunta para que el
  // render de siempre (que lee ok / answers / keywords / exp) las muestre.
  const applyReveal = (index: number, r: ServerAnswer) => {
    const { ok, answers, keywords } = r.reveal ?? {};
    setQuestions((prev) =>
      prev.map((x, i) => (i === index ? { ...x, ...(ok !== undefined ? { ok } : {}), ...(answers ? { answers } : {}), ...(keywords ? { keywords } : {}), exp: r.explanation ?? x.exp, src: r.source ?? null } : x))
    );
  };

  const recordAttempt = async (question: LessonPageQuestion, wasCorrect: boolean, answerGiven: any) => {
    reactToResult(wasCorrect);
    if (!question?.id) return;
    // Modo sombra: el servidor califica en paralelo y registra si coincide con este veredicto (no cambia nada visible).
    reportShadow(question.id, answerGiven, wasCorrect);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('question_attempts').insert({
        student_id: user.id,
        question_id: question.id,
        module_id: moduleId,
        // classroom_id es NOT NULL en la DB -- mod! es seguro aqui porque el
        // gate de "loading" ya garantiza que mod esta cargado antes de que
        // cualquier handler que llegue a recordAttempt pueda ejecutarse.
        classroom_id: mod!.classroom_id!,
        concept_tag: question.concept_tag ?? null,
        was_correct: wasCorrect,
        answer_given: answerGiven ?? null,
        // Review 360 §3.3: game_type existe desde la migracion 028 y estaba
        // en NULL en las 78 filas de question_attempts de produccion, porque
        // recordAttempt nunca lo escribia -- ni siquiera en los 8 call sites
        // que SI vienen de un minijuego. Resultado: cero medicion de si
        // alguien jugo un minijuego alguna vez, sobre 1300 lineas de codigo
        // que son la diferenciacion del producto.
        game_type: question.game_type ?? null,
      });
    } catch (e) {
      console.warn('Error registrando intento:', e);
    }
  };

  // Minijuegos con calificacion en el servidor: el juego manda lo que eligio el jugador y recibe el veredicto con lo que se revela. Sin la funcion, el juego se califica en el
  // navegador como siempre.
  const gameCheck = (q: LessonPageQuestion): GameCheck | undefined =>
    q.serverGraded
      ? async (answer) => {
          const r = await gradeOnServer(q, answer);
          return r ? { correct: r.correct, reveal: r.reveal, explanation: r.explanation ?? null } : null;
        }
      : undefined;
  // El servidor ya registro el intento de una pregunta que califica el (question_attempts); desde el navegador solo se reacciona al resultado.
  const finishGame = (q: LessonPageQuestion, correct: boolean) => {
    if (q.serverGraded) reactToResult(correct);
    else recordAttempt(q, correct, null);
  };

  const handleAnswer = async (answer: number | boolean | string) => {
    if (answered || checking) return;
    const q = questions[idx];
    if (q.serverGraded && (q.type === 'multiple_choice' || q.type === 'true_false')) {
      setChecking(true);
      setCheckError(null);
      setSelected(answer);
      const r = await gradeOnServer(q, q.type === 'multiple_choice' ? { selectedIndex: answer } : { selected: answer });
      setChecking(false);
      if (!r) {
        setSelected(null);
        setCheckError(CHECK_ERROR);
        return;
      }
      applyReveal(idx, r);
      setAnswered(true);
      if (r.correct) setScore((s) => s + 1);
      reactToResult(r.correct);
      return;
    }
    setSelected(answer);
    setAnswered(true);
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

  const handleShortAnswerSubmit = async () => {
    const q = questions[idx];
    if (q.serverGraded) {
      if (checking) return;
      setChecking(true);
      setCheckError(null);
      const r = await gradeOnServer(q, { text: shortAnswerText });
      setChecking(false);
      if (!r) {
        setCheckError(CHECK_ERROR);
        return;
      }
      applyReveal(idx, r);
      setShortAnswerMatchedCount(r.detail?.matched ?? 0);
      setSelected('answered');
      setAnswered(true);
      if (r.correct) setScore((s) => s + 1);
      reactToResult(r.correct);
      return;
    }
    const norm = normalizeAnswer(shortAnswerText);
    const matched = (q.keywords || []).filter((k) => norm.includes(normalizeAnswer(k))).length;
    setShortAnswerMatchedCount(matched);
    const allKeywordsMatched = (q.keywords?.length || 0) > 0 && matched === (q.keywords?.length ?? 0);
    recordAttempt(q, allKeywordsMatched, { text: shortAnswerText });
    handleAnswer('answered');
  };

  const handleFillBlankSubmit = async () => {
    const q = questions[idx];
    if (q.serverGraded) {
      if (checking) return;
      setChecking(true);
      setCheckError(null);
      const r = await gradeOnServer(q, { text: fillBlankText });
      setChecking(false);
      if (!r) {
        setCheckError(CHECK_ERROR);
        return;
      }
      if (r.final) {
        applyReveal(idx, r);
        setFillBlankFeedback(r.correct ? 'correct' : 'revealed');
        setAnswered(true);
        setSelected('filled');
        if (r.correct) setScore((s) => s + 1);
        reactToResult(r.correct);
      } else {
        setFillBlankAttempts((a) => a + 1);
        setFillBlankFeedback('retry');
      }
      return;
    }
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
      setShortAnswerText('');
      setShortAnswerMatchedCount(0);
      setFillBlankText('');
      setFillBlankAttempts(0);
      setFillBlankFeedback(null);
      setCheckError(null);
    } else if (remediationPhase === 'active') {
      completeRemediation();
    } else {
      finishModule();
    }
  };

  // Busca los conceptos donde el estudiante acerto <70% en ESTE modulo
  // (no en toda la clase), para ofrecer un repaso dirigido si aplica.
  const fetchWeakConcepts = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data } = await supabase
      .from('question_attempts')
      .select('concept_tag, was_correct')
      .eq('student_id', user.id)
      .eq('module_id', moduleId);
    if (!data || data.length === 0) return [];

    const byTag = new Map<string, { correct: number; total: number }>();
    for (const row of data) {
      if (!row.concept_tag) continue;
      const entry = byTag.get(row.concept_tag) ?? { correct: 0, total: 0 };
      entry.total += 1;
      if (row.was_correct) entry.correct += 1;
      byTag.set(row.concept_tag, entry);
    }

    return Array.from(byTag.entries())
      .map(([tag, { correct, total }]) => ({ tag, accuracy: Math.round((correct / total) * 100) }))
      .filter((c) => c.accuracy < REMEDIATION_ACCURACY_THRESHOLD)
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 3);
  };

  // Termina el modulo original: guarda progreso como siempre, y si el score
  // general fue bajo Y hay conceptos especificos debiles, ofrece un repaso
  // dirigido en vez de ir directo a la pantalla de "Completado!".
  const finishModule = async () => {
    setModuleFinishing(true);
    const scorePercent = Math.round((score / questions.length) * 100);
    await saveProgress(score);
    useTonitoStore.getState().onModuleComplete(scorePercent);

    const queue: CinematicType[] = [scorePercent >= 70 ? 'module_complete_good' : 'module_complete_low'];
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('streak_days').eq('id', user.id).single();
        const streakDays = profile?.streak_days ?? 0;
        const today = new Date().toISOString().split('T')[0];
        const shownKey = `studia_streak_cinematic_${today}`;
        const isMilestone = streakDays === 3 || (streakDays >= 5 && streakDays % 5 === 0);
        if (isMilestone && typeof window !== 'undefined' && !localStorage.getItem(shownKey)) {
          localStorage.setItem(shownKey, '1');
          setStreakForCinematic(streakDays);
          queue.push('streak');
        }
      }
    } catch (e) {
      console.warn('Error evaluando racha para cinematica:', e);
    }

    if (scorePercent < REMEDIATION_TRIGGER_SCORE) {
      try {
        const weak = await fetchWeakConcepts();
        if (weak.length > 0) {
          setWeakConcepts(weak);
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: row } = await supabase
              .from('student_remediations')
              .insert({
                student_id: user.id,
                module_id: moduleId,
                classroom_id: mod!.classroom_id!, // ver nota de invariante en recordAttempt
                concept_tags: weak.map((w) => w.tag),
                was_offered: true,
              })
              .select('id')
              .single();
            setRemediationRowId(row?.id ?? null);
          }
          setRemediationPhase('offered');
          setModuleFinishing(false);
          return;
        }
      } catch (e) {
        console.warn('Error evaluando repaso dirigido:', e);
      }
    }
    setCinematicQueue(queue);
    setModuleFinishing(false);
    setDone(true);
  };

  const handleRemediationSkip = () => {
    setRemediationPhase('none');
    setDone(true);
  };

  const handleRemediationAccept = async () => {
    setRemediationLoading(true);
    try {
      if (remediationRowId) {
        await supabase.from('student_remediations').update({ was_accepted: true }).eq('id', remediationRowId);
      }
      const res = await fetch('/api/generate-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moduleId,
          moduleTitle: mod!.title, // ver nota de invariante en recordAttempt
          remediationConcepts: weakConcepts.map((w) => w.tag),
        }),
      });
      const data = res.ok ? await res.json() : null;
      if (data?.questions?.length > 0) {
        setQuestions(data.questions);
        setIdx(0);
        setScore(0);
        setAnswered(false);
        setSelected(null);
        setRemediationPhase('active');
        useTonitoStore.getState().setMood('encouraging');
        useTonitoStore.getState().showMessage('¡Vamos, reforcemos esto juntos! 💪', 3000);
        return;
      }
    } catch (e) {
      console.warn('Error generando repaso:', e);
    } finally {
      setRemediationLoading(false);
    }
    // Si no se pudo generar el repaso, no bloqueamos al estudiante.
    setRemediationPhase('none');
    setDone(true);
  };

  const completeRemediation = async () => {
    const scorePercent = Math.round((score / questions.length) * 100);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        if (remediationRowId) {
          await supabase
            .from('student_remediations')
            .update({
              was_completed: true,
              score_percent: scorePercent,
              completed_at: new Date().toISOString(),
            })
            .eq('id', remediationRowId);
        }
      }
    } catch (e) {
      console.warn('Error completando repaso:', e);
    }
    setRemediationPhase('completed');
    useTonitoStore.getState().onModuleComplete(100);
  };

  const saveProgress = async (finalScore: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const scorePercent = Math.round((finalScore / questions.length) * 100);
      const now = new Date().toISOString();

      const { data: existing } = await supabase
        .from('student_progress')
        .select('status, attempts, best_score, started_at, time_spent_seconds')
        .eq('student_id', user.id)
        .eq('module_id', moduleId)
        .maybeSingle();

      await supabase.from('student_progress').upsert({
        student_id: user.id,
        module_id: moduleId,
        status: 'completed',
        completion_percentage: 100,
        score: scorePercent,
        best_score: Math.max(existing?.best_score ?? 0, scorePercent),
        attempts: (existing?.attempts ?? 0) + 1,
        // Acumula sobre lo ya registrado: un segundo intento suma tiempo en
        // vez de pisar el del primero (review 360 §3.5).
        time_spent_seconds: (existing?.time_spent_seconds ?? 0) + elapsedSeconds(),
        started_at: existing?.started_at ?? now,
        completed_at: now,
        last_attempt_at: now,
      }, { onConflict: 'student_id,module_id' });

      // Verificar y otorgar logros (el modal de desbloqueo aparece via Realtime).
      await evaluateAchievements();
    } catch (e) {
      console.warn('Error guardando progreso:', e);
    }
  };

  if (loading) return (
    <div role="status" className="flex flex-col items-center justify-center min-h-64 text-fg p-8">
      <div className="tonito-breathing">
        <TonitoStateClip slot="wait_thinking" mood="thinking" animation="idle" gradient={['#6C5CE7', '#00D2D3']} size={110} />
      </div>
      <p className="text-lg font-semibold mt-4">Estoy preparando preguntas especiales…</p>
      <p className="text-sm text-fg-muted mt-1">Solo un momento. La primera vez puede tardar hasta un minuto.</p>
    </div>
  );

  if (!mod) return <div className="text-fg p-8">No encontrado</div>;

  // Review 360 §3.6: antes de este cambio, un fallo de generacion se disfrazaba
  // de leccion con preguntas de relleno y otorgaba XP igual. Ahora se dice, no
  // se guarda progreso ni XP, y se ofrece reintentar.
  if (generationFailed) return (
    <div role="alert" className="flex flex-col items-center justify-center min-h-64 text-fg p-8 text-center premium-fade-in-up">
      <TonitoStateClip slot="soft_error" mood="sad" animation="idle" gradient={['#6C5CE7', '#00D2D3']} size={110} />
      <h2 className="text-xl font-semibold mt-4">No pude preparar esta lección</h2>
      <p className="text-sm text-fg-muted mt-2 max-w-sm">
        Hubo un problema generando las preguntas de <strong>{mod.title}</strong>. No es culpa
        tuya, y tu progreso no se vio afectado.
      </p>
      <div className="flex flex-wrap justify-center gap-3 mt-6">
        <Button
          variant="accent"
          onClick={() => {
            setGenerationFailed(false);
            setLoading(true);
            generateQuestions(mod);
          }}
        >
          Intentar de nuevo
        </Button>
        <Button variant="secondary" onClick={() => router.push('/dashboard')}>
          Volver al inicio
        </Button>
      </div>
    </div>
  );

  if (showIntro) return (
    <CinematicScene
      type="lesson_start"
      moduleTitle={mod.title}
      studentName={studentName}
      onComplete={() => setShowIntro(false)}
    />
  );

  if (cinematicQueue.length > 0) return (
    <CinematicScene
      type={cinematicQueue[0]}
      studentName={studentName}
      score={Math.round((score / questions.length) * 100)}
      streak={streakForCinematic}
      onComplete={() => setCinematicQueue((q) => q.slice(1))}
    />
  );

  if (remediationPhase === 'offered') return (
    <RemediationPrompt
      weakConcepts={weakConcepts}
      loading={remediationLoading}
      onAccept={handleRemediationAccept}
      onSkip={handleRemediationSkip}
    />
  );

  if (remediationPhase === 'completed') return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:p-8">
      <Card className="p-8 text-center bg-success/10 border-success/40">
        <h1 className="text-3xl font-bold text-fg mb-4">¡Repaso completado! 🎉</h1>
        <p className="text-lg text-fg mb-2">Ahora estás listo para lo siguiente.</p>
        <div className="mb-8" />
        <Button size="lg" onClick={() => router.back()}>Volver</Button>
      </Card>
    </div>
  );

  if (done) return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:p-8">
      <Card className="p-8 text-center bg-success/10 border-success/40">
        <h1 className="text-4xl font-bold text-fg mb-4">¡Completado!</h1>
        <p className="text-2xl text-fg mb-2">{score}/{questions.length} correctas</p>
        <p className="text-lg text-fg-muted mb-2">{Math.round((score / questions.length) * 100)}% de acierto</p>
        <div className="mb-8" />
        <Button size="lg" onClick={() => router.back()}>Volver</Button>
      </Card>
    </div>
  );

  const q = questions[idx];
  const progress = ((idx + 1) / questions.length) * 100;

  // Da a TS un punto real de narrowing para "q" (isValidQuestion ya trata
  // undefined como invalido en runtime, pero no es un type predicate).
  if (!q) return <div className="text-fg p-8">No hay pregunta para mostrar.</div>;

  const questionCheck = isValidQuestion(q);
  if (!questionCheck.valid) {
    console.error('[QUESTION_VALIDATION_ERROR]', {
      questionId: q?.id,
      type: q?.type,
      error: questionCheck.error,
      gameData: q?.game_data,
      timestamp: new Date().toISOString(),
    });
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 sm:p-8">
        <Card role="alert" className="p-8 text-center space-y-4">
          <TonitoStateClip slot="soft_error" mood="sad" animation="shake" gradient={['#6C5CE7', '#00D2D3']} size={90} />
          <h2 className="text-xl font-bold text-fg">Ups, hubo un problema con esta pregunta</h2>
          <p className="text-fg-muted text-sm">{questionCheck.error}</p>
          <p className="text-fg-muted text-xs">Esto no debería pasar. Ya lo registramos.</p>
          <Button onClick={nextQuestion}>Saltar a la siguiente →</Button>
        </Card>
      </div>
    );
  }

  // Resultado de una pregunta de opcion unica (opcion multiple o verdadero/falso), una vez respondida.
  const isChoice = q.type === 'multiple_choice' || q.type === 'true_false';
  const result = isChoice ? choiceResult(answered, selected, q.ok) : null;
  const correctText = isChoice ? correctChoiceText(q.type as ChoiceKind, q.opts || [], q.ok as ChoiceValue | undefined) : null;

  const renderQuestion = () => {
    if (q.type === 'multiple_choice' || q.type === 'true_false') return (
      <ChoiceQuestion
        kind={q.type as ChoiceKind}
        options={q.opts || []}
        selected={selected}
        answered={answered}
        correct={q.ok as ChoiceValue | undefined}
        pending={checking}
        onAnswer={(v) => handleAnswer(v)}
      />
    );

    if (q.type === 'fill_blank') return (
      <div className="space-y-4">
        <p className="text-fg-muted text-sm">Escribe las palabras que faltan en los espacios</p>
        <div className="bg-surface-2 p-4 rounded-xl text-fg text-lg"><MathText content={q.q} /></div>
        <textarea
          aria-label="Palabras que faltan"
          className="w-full min-h-[96px] bg-surface-2 text-fg text-base rounded-xl p-4 border border-line-strong placeholder:text-fg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          placeholder="Escribe aqui las palabras que faltan..." disabled={answered || checking}
          value={fillBlankText} onChange={(e) => setFillBlankText(e.target.value)} />
        {fillBlankFeedback === 'retry' && (
          <div role="alert" className="bg-danger/10 border border-danger/40 p-3 rounded-xl text-fg text-sm font-medium">
            Intenta de nuevo, te falta al menos una palabra clave.
          </div>
        )}
        {!answered ? (
          <Button size="lg" className="w-full" onClick={handleFillBlankSubmit} disabled={!fillBlankText.trim() || checking} loading={checking}>
            {checking ? 'Comprobando…' : 'Enviar respuesta'}
          </Button>
        ) : fillBlankFeedback === 'correct' ? (
          <div className="bg-success/10 border border-success/40 p-4 rounded-xl flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />
            <p className="text-fg font-medium">¡Correcto! 🎉</p>
          </div>
        ) : (
          <div className="bg-primary/10 border border-primary/30 p-4 rounded-xl">
            <p className="text-fg font-medium">Respuesta: <MathText content={q.answers?.join(', ') || ''} /></p>
          </div>
        )}
      </div>
    );

    if (q.type === 'match' && q.serverGraded) return (
      <LessonQuestionMatch
        key={idx}
        terms={q.terms || []}
        defs={q.defs || []}
        disabled={answered}
        check={async (given): Promise<MatchVerdict | null> => {
          const r = await gradeOnServer(q, { defs: given });
          if (!r) return null;
          if (r.final) applyReveal(idx, r);
          return { correct: r.correct, final: r.final, triesLeft: r.triesLeft, perTerm: r.detail?.perTerm, revealDefs: r.reveal?.defs };
        }}
        onComplete={(correct) => {
          setAnswered(true);
          setSelected('matched');
          if (correct) setScore((s) => s + 1);
          reactToResult(correct);
        }}
      />
    );

    if (q.type === 'match') return (
      <LessonQuestionMatch
        key={idx}
        pairs={q.pairs || []}
        disabled={answered}
        onComplete={(correct, pairing) => {
          setAnswered(true);
          setSelected('matched');
          if (correct) setScore((s) => s + 1);
          recordAttempt(q, correct, { pairing });
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

    if (q.type === 'impostor_cognitivo') return (
      <ImpostorCognitivoGame
        key={idx}
        gameData={q.game_data || {}}
        disabled={answered}
        check={gameCheck(q)}
        onComplete={(correct) => {
          setAnswered(true);
          setSelected('acusado');
          if (correct) setScore((s) => s + 1);
          finishGame(q, correct);
        }}
      />
    );

    if (q.type === 'alquimia_conceptual') return (
      <AlquimiaConceptualGame
        key={idx}
        gameData={q.game_data || {}}
        disabled={answered}
        check={gameCheck(q)}
        onComplete={(correct) => {
          setAnswered(true);
          setSelected('fusionado');
          if (correct) setScore((s) => s + 1);
          finishGame(q, correct);
        }}
      />
    );

    if (q.type === 'cuarto_crisis') return (
      <CuartoCrisisGame
        key={idx}
        gameData={q.game_data || {}}
        disabled={answered}
        check={gameCheck(q)}
        onComplete={(correct) => {
          setAnswered(true);
          setSelected('resuelto');
          if (correct) setScore((s) => s + 1);
          finishGame(q, correct);
        }}
      />
    );

    if (q.type === 'juicio_conocimiento') return (
      <JuicioConocimientoGame
        key={idx}
        gameData={q.game_data || {}}
        disabled={answered}
        check={gameCheck(q)}
        onComplete={(correct) => {
          setAnswered(true);
          setSelected('objetado');
          if (correct) setScore((s) => s + 1);
          finishGame(q, correct);
        }}
      />
    );

    if (q.type === 'short_answer') return (
      <div className="space-y-4">
        <textarea
          aria-label="Tu respuesta"
          className="w-full min-h-[128px] bg-surface-2 text-fg text-base rounded-xl p-4 border border-line-strong placeholder:text-fg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          placeholder="Escribe tu respuesta aqui..." disabled={answered || checking}
          value={shortAnswerText} onChange={(e) => setShortAnswerText(e.target.value)} />
        {!answered ? (
          <Button size="lg" className="w-full" onClick={handleShortAnswerSubmit} disabled={!shortAnswerText.trim() || checking} loading={checking}>
            {checking ? 'Comprobando…' : 'Enviar respuesta'}
          </Button>
        ) : (
          <div className="bg-primary/10 border border-primary/30 p-4 rounded-xl space-y-1">
            <p className="text-fg font-medium">
              {shortAnswerMatchedCount > 0
                ? `Mencionaste ${shortAnswerMatchedCount} de ${q.keywords?.length || 0} palabras clave`
                : 'Palabras clave esperadas:'}
            </p>
            <p className="text-fg-muted text-sm"><MathText content={q.keywords?.join(', ') || ''} /></p>
          </div>
        )}
      </div>
    );

    return null;
  };

  const TYPE_LABELS: Record<string, string> = {
    multiple_choice: 'Opción múltiple',
    true_false: 'Verdadero / Falso',
    fill_blank: 'Completar frase',
    match: 'Conectar conceptos',
    short_answer: 'Respuesta corta',
    el_descifrador: 'El Descifrador',
    linea_del_tiempo: 'Línea del tiempo',
    categorias_rapidas: 'Categorías rápidas',
    flashcard_rapida: 'Flashcard rápida',
    impostor_cognitivo: 'El Impostor Cognitivo',
    alquimia_conceptual: 'Alquimia conceptual',
    cuarto_crisis: 'Cuarto de crisis',
    juicio_conocimiento: 'El juicio al conocimiento',
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:p-8">
      <div className="mb-6">
        {remediationPhase === 'active' && (
          <Badge tone="primary" className="mb-2 font-bold">
            Repaso rápido
          </Badge>
        )}
        <h1 className="text-2xl font-bold text-fg mb-1 text-balance">{mod.title}</h1>
        <p className="text-fg-muted text-sm mb-4">{mod.description}</p>
        <div className="flex justify-between text-sm text-fg-muted mb-2">
          <span>Pregunta {idx + 1} de {questions.length}</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <ProgressBar value={progress} label={`Pregunta ${idx + 1} de ${questions.length}`} />
      </div>

      <ModuleMedia moduleId={mod.id} defaultOpen={idx === 0} />

      <Card className="p-5 sm:p-8 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Badge tone="primary">{TYPE_LABELS[q.type] ?? 'Pregunta'}</Badge>
        </div>
        <p className="text-fg font-bold text-lg mb-6"><MathText content={q.q} /></p>
        {renderQuestion()}

        {/* Resultado de la pregunta: se ANUNCIA a lectores de pantalla y no depende solo del color. */}
        <AnswerFeedback result={result} correctText={correctText} />

        <div aria-live="polite" role="status">
          {checkError && (
            <p role="alert" className="mt-4 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm font-medium text-fg">
              {checkError}
            </p>
          )}
        </div>

        {answered && q.exp && (
          <div className="mt-6 p-4 bg-primary/10 border-l-4 border-primary rounded-lg">
            <p className="text-primary-text font-medium">Explicación:</p>
            <p className="text-fg mt-1"><MathText content={q.exp} /></p>
          </div>
        )}

        {answered && <SourceHintBox source={q.src} />}
      </Card>

      {answered && (
        <Button size="lg" className="w-full text-lg" onClick={nextQuestion} disabled={moduleFinishing} loading={moduleFinishing} autoFocus>
          {moduleFinishing
            ? 'Guardando...'
            : idx < questions.length - 1
            ? 'Siguiente pregunta'
            : remediationPhase === 'active'
            ? 'Terminar repaso'
            : 'Terminar módulo'}
        </Button>
      )}
    </div>
  );
}
