'use client';

// Tomar una evaluacion y ver la retroalimentacion (decision 3D). Las preguntas llegan SIN claves por /api/exam; el servidor califica y devuelve cuales acerto y fallo, con la explicacion, el corte,
// el modulo y el material con su cita. Recargar retoma la misma sesion; las respuestas se guardan como borrador en esta pestana (sessionStorage) por si se recarga.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MathText } from '@/components/MathText';
import { answeredCount, buildPayload, isAnswered, restoreDraft, withAnswer, withMatch, type FormState } from '@/lib/blueprint/examForm';
import type { ExamFeedback } from '@/lib/blueprint/examFeedback';
import type { PresentedQuestion } from '@/lib/blueprint/examSession';

const FIELD = 'w-full min-h-[44px] rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-base text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const LETTERS = 'ABCDEFGH';

type Phase = 'intro' | 'loading' | 'taking' | 'submitting' | 'done';
interface Session {
  id: string;
  expiresAt: string;
  resumed: boolean;
  questions: PresentedQuestion[];
}
interface Result {
  attemptNumber: number | null;
  scorePercent: number;
  mastered: boolean;
  alreadyClosed: boolean;
  feedback: ExamFeedback;
}

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch('/api/exam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, data: { error: 'No hay conexion con el servidor. Revisa tu red e intenta de nuevo.' } };
  }
}

const draftKey = (id: string) => `studia-exam-draft-${id}`;
function readDraft(id: string): unknown {
  try {
    const raw = window.sessionStorage.getItem(draftKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeDraft(id: string, state: FormState | null) {
  try {
    if (state === null) window.sessionStorage.removeItem(draftKey(id));
    else window.sessionStorage.setItem(draftKey(id), JSON.stringify(state));
  } catch {
    /* sin almacenamiento: la pantalla funciona igual, solo no guarda el borrador */
  }
}

export default function ExamClient({ classroomId, kind, periodId, title, backHref }: { classroomId: string; kind: 'period' | 'final'; periodId: string | null; title: string; backHref: string }) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [session, setSession] = useState<Session | null>(null);
  const [answers, setAnswers] = useState<FormState>({});
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const questions = session?.questions ?? [];
  const done = useMemo(() => answeredCount(questions, answers), [questions, answers]);
  const missing = questions.length - done;

  // Al cambiar de fase, el foco va al titulo: quien usa lector de pantalla o teclado no se queda en un boton que ya no existe.
  useEffect(() => {
    headingRef.current?.focus();
  }, [phase]);

  const start = async () => {
    setPhase('loading');
    setError(null);
    setConfirming(false);
    const r = await post({ action: 'start', classroomId, kind, periodId: kind === 'period' ? periodId : undefined });
    if (!r.ok) {
      setPhase('intro');
      setError(r.data?.error ?? 'No se pudo abrir la evaluacion.');
      return;
    }
    const qs = r.data.questions as PresentedQuestion[];
    setSession({ id: r.data.sessionId, expiresAt: r.data.expiresAt, resumed: !!r.data.resumed, questions: qs });
    setAnswers(r.data.resumed ? restoreDraft(readDraft(r.data.sessionId), qs) : {});
    setPhase('taking');
  };

  const change = (next: FormState) => {
    setAnswers(next);
    setConfirming(false);
    if (session) writeDraft(session.id, next);
  };

  const submit = async () => {
    if (!session) return;
    if (missing > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    setPhase('submitting');
    setError(null);
    const r = await post({ action: 'submit', sessionId: session.id, answers: buildPayload(questions, answers) });
    if (!r.ok) {
      setPhase('taking');
      setConfirming(false);
      setError(r.data?.error ?? 'No se pudo entregar la evaluacion.');
      return;
    }
    writeDraft(session.id, null);
    setResult({ attemptNumber: r.data.attemptNumber ?? null, scorePercent: r.data.scorePercent, mastered: !!r.data.mastered, alreadyClosed: !!r.data.alreadyClosed, feedback: r.data.feedback });
    setPhase('done');
  };

  const errorBox = error && (
    <p role="alert" className="rounded-xl border border-danger p-3 text-sm text-danger">
      {error}
    </p>
  );

  if (phase === 'intro' || phase === 'loading') {
    return (
      <Card className="space-y-4 p-5">
        <h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-fg focus:outline-none">
          {title}
        </h1>
        <p className="text-fg-muted">
          Contesta con calma: puedes recargar la página sin perder la evaluación. Al terminar verás cuáles acertaste y cuáles fallaste, con una explicación de cada una, el módulo donde se vio y el material en que se apoya.
          Se repite hasta lograr el 100 %.
        </p>
        {errorBox}
        <Button onClick={start} loading={phase === 'loading'}>
          Empezar la evaluación
        </Button>
      </Card>
    );
  }

  if (phase === 'done' && result) {
    const f = result.feedback;
    return (
      <div className="space-y-4">
        <Card className="space-y-3 p-5">
          <h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-fg focus:outline-none">
            Resultado: {title}
          </h1>
          <p className="text-3xl font-extrabold text-fg" aria-label={`Puntaje ${Math.round(result.scorePercent * 100) / 100} por ciento`}>
            {Math.round(result.scorePercent * 100) / 100} %
          </p>
          <p className="text-fg-muted">
            Acertaste {f.correct} de {f.total}
            {result.attemptNumber ? ` · intento ${result.attemptNumber}` : ''}.{' '}
            {result.mastered ? '¡Dominaste esta evaluación! Ya puedes avanzar.' : 'Necesitas 100 % para avanzar: repasa lo que fallaste y vuelve a intentarlo.'}
          </p>
          {result.alreadyClosed && <p className="text-sm text-fg-muted">Esta evaluación ya se había entregado; este es su resultado.</p>}
          {f.toReview.length > 0 && (
            <div>
              <h2 className="text-base font-semibold text-fg">Qué repasar</h2>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-fg-muted">
                {f.toReview.map((t) => (
                  <li key={t.nodeId}>
                    {t.periodName} · {t.moduleTitle}: fallaste {t.wrong} de {t.total}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {!result.mastered && <Button onClick={start}>Intentar de nuevo</Button>}
            <Link href={backHref} className="inline-flex min-h-[44px] items-center rounded-xl border border-line px-4 text-base font-semibold text-fg hover:border-line-strong">
              Volver al recorrido
            </Link>
          </div>
        </Card>

        <section aria-label="Revisión de cada pregunta" className="space-y-3">
          <h2 className="text-lg font-bold text-fg">Cada pregunta</h2>
          <ol className="space-y-3">
            {f.items.map((i) => (
              <li key={i.questionId}>
                <Card className="space-y-2 p-4">
                  <p className={`flex items-center gap-2 text-sm font-semibold ${i.correct ? 'text-fg' : 'text-danger'}`}>
                    {i.correct ? <CheckCircle2 aria-hidden="true" className="h-5 w-5" /> : <XCircle aria-hidden="true" className="h-5 w-5" />}
                    Pregunta {i.position}: {i.correct ? 'Correcta' : 'Incorrecta'}
                  </p>
                  <p className="text-base font-medium text-fg">
                    <MathText content={i.question} />
                  </p>
                  <p className="text-sm text-fg-muted">
                    <span className="font-semibold text-fg">Por qué: </span>
                    <MathText content={i.explanation} />
                  </p>
                  {i.where && (
                    <p className="text-sm text-fg-muted">
                      <span className="font-semibold text-fg">Dónde se vio: </span>
                      {i.where.periodName} · {i.where.moduleTitle}. <span className="font-semibold text-fg">Material: </span>
                      {i.where.materialName} — «<MathText content={i.where.quote} />»
                    </p>
                  )}
                </Card>
              </li>
            ))}
          </ol>
        </section>
      </div>
    );
  }

  // Respondiendo (o entregando).
  const busy = phase === 'submitting';
  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-5">
        <h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-fg focus:outline-none">
          {title}
        </h1>
        <p className="text-sm text-fg-muted">
          {session?.resumed ? 'Retomaste tu evaluación. ' : ''}Tienes hasta las {session ? new Date(session.expiresAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : ''} para entregarla.
        </p>
        <p className="text-sm font-semibold text-fg" role="status" aria-live="polite">
          Contestadas {done} de {questions.length}
        </p>
      </Card>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void submit();
        }}
        className="space-y-4"
      >
        {questions.map((q, n) => (
          <Card key={q.id} className="p-4">
            <fieldset disabled={busy} className="space-y-3">
              <legend className="text-base font-medium text-fg">
                <span className="mr-2 text-fg-muted">{n + 1}.</span>
                <MathText content={q.q} />
                {!isAnswered(q, answers[q.id]) && <span className="sr-only"> (sin contestar)</span>}
              </legend>

              {q.type === 'multiple_choice' && (
                <div className="space-y-2">
                  {(q.opts ?? []).map((o, k) => {
                    const on = (answers[q.id] as any)?.selectedIndex === k;
                    return (
                      <label key={k} className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border p-3 text-base text-fg ${on ? 'border-primary bg-surface-2' : 'border-line'}`}>
                        <input type="radio" name={`q-${q.id}`} checked={on} onChange={() => change(withAnswer(answers, q.id, { selectedIndex: k }))} className="mt-1 h-4 w-4" />
                        <span>
                          <span className="font-semibold">{LETTERS[k] ?? k + 1}.</span> <MathText content={o} />
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              {q.type === 'true_false' && (
                <div className="flex flex-wrap gap-2">
                  {[true, false].map((v) => {
                    const on = (answers[q.id] as any)?.selected === v;
                    return (
                      <label key={String(v)} className={`flex min-h-[44px] flex-1 cursor-pointer items-center gap-3 rounded-xl border p-3 text-base text-fg ${on ? 'border-primary bg-surface-2' : 'border-line'}`}>
                        <input type="radio" name={`q-${q.id}`} checked={on} onChange={() => change(withAnswer(answers, q.id, { selected: v }))} className="h-4 w-4" />
                        {v ? 'Verdadero' : 'Falso'}
                      </label>
                    );
                  })}
                </div>
              )}

              {q.type === 'fill_blank' && (
                <label className="block text-sm text-fg-muted">
                  Tu respuesta (lo que va en el espacio)
                  <input type="text" className={FIELD} value={(answers[q.id] as any)?.text ?? ''} maxLength={200} autoComplete="off" onChange={(e) => change(withAnswer(answers, q.id, { text: e.target.value }))} />
                </label>
              )}

              {q.type === 'short_answer' && (
                <label className="block text-sm text-fg-muted">
                  Tu respuesta
                  <textarea className={`${FIELD} min-h-[96px]`} value={(answers[q.id] as any)?.text ?? ''} maxLength={2000} onChange={(e) => change(withAnswer(answers, q.id, { text: e.target.value }))} />
                </label>
              )}

              {q.type === 'match' && (
                <div className="space-y-3">
                  {(q.terms ?? []).map((t, k) => {
                    const cur = (answers[q.id] as any)?.defs?.[k] ?? '';
                    return (
                      <label key={k} className="block text-sm text-fg-muted">
                        <span className="font-semibold text-fg">
                          <MathText content={t} />
                        </span>
                        <select className={FIELD} value={cur} onChange={(e) => change(withMatch(answers, q, k, e.target.value))}>
                          <option value="">Elige la definición…</option>
                          {(q.defs ?? []).map((d, j) => (
                            <option key={j} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>
          </Card>
        ))}

        {errorBox}
        {confirming && missing > 0 && (
          <p role="alert" className="rounded-xl border border-line-strong p-3 text-sm text-fg">
            Te {missing === 1 ? 'falta 1 pregunta' : `faltan ${missing} preguntas`} por contestar; las que dejes sin contestar cuentan como incorrectas. ¿Entregar de todos modos?
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>
            {confirming && missing > 0 ? 'Entregar de todos modos' : 'Entregar evaluación'}
          </Button>
          {confirming && (
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              Seguir contestando
            </Button>
          )}
          {busy && (
            <span className="inline-flex items-center gap-2 text-sm text-fg-muted" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Calificando…
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
