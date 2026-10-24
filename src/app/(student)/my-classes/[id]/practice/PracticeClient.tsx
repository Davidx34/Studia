'use client';

// Modo practica: repasar preguntas que el estudiante YA respondio, sin presion.
// No escribe NADA: ni question_attempts (por eso no suma racha ni cuenta para el profesor), ni monedas, ni repaso espaciado.
// Comprueba en el navegador con la misma funcion de calificacion de las lecciones. Las claves que llegan aqui son de
// preguntas que el estudiante ya cerro (se le revelaron entonces); ver src/lib/practice/session.ts.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Lightbulb, RotateCcw, XCircle } from 'lucide-react';
import { MathText } from '@/components/MathText';
import { Button } from '@/components/ui/Button';
import { Card, Badge } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { AnswerFeedback, ChoiceQuestion, correctChoiceText, type ChoiceValue } from '@/components/lesson/ChoiceQuestion';
import { LessonQuestionMatch } from '@/components/LessonQuestionMatch';
import { gradeAnswer } from '@/lib/grading/gradeAnswer';
import type { PracticeQuestion } from '@/lib/practice/session';

const TYPE_LABELS: Record<string, string> = {
  multiple_choice: 'Opción múltiple',
  true_false: 'Verdadero o falso',
  fill_blank: 'Completar frase',
  short_answer: 'Respuesta corta',
  match: 'Conectar conceptos',
};

type Phase = 'answering' | 'retry' | 'done';

// Una pregunta. `onDone` se llama una sola vez, con si acerto a la PRIMERA.
function PracticeCard({ q, last, onNext }: { q: PracticeQuestion; last: boolean; onNext: (firstTry: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>('answering');
  const [firstTry, setFirstTry] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<ChoiceValue | null>(null);
  const [text, setText] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const [correct, setCorrect] = useState<boolean | null>(null);

  const finish = (ok: boolean) => {
    setCorrect(ok);
    setFirstTry((f) => f ?? ok);
    setPhase('done');
  };

  const answerChoice = (value: ChoiceValue) => {
    if (phase === 'done') return;
    const r = gradeAnswer(q, q.type === 'multiple_choice' ? { selectedIndex: value } : { selected: value });
    setSelected(value);
    finish(r.status === 'graded' && r.correct);
  };

  const checkText = () => {
    const r = gradeAnswer(q, { text });
    if (r.status !== 'graded') return;
    if (r.correct) return finish(true);
    setFirstTry((f) => f ?? false);
    const d = r.detail;
    setHint(d && d.total ? `Vas ${d.matched ?? 0} de ${d.total}. Puedes reintentar o ver la respuesta.` : 'Todavía no. Puedes reintentar o ver la respuesta.');
    setPhase('retry');
  };

  const showAnswer = () => {
    setGaveUp(true);
    setCorrect(false);
    setFirstTry((f) => f ?? false);
    setPhase('done');
  };

  const isChoice = q.type === 'multiple_choice' || q.type === 'true_false';
  const isText = q.type === 'fill_blank' || q.type === 'short_answer';
  const expected = q.type === 'fill_blank' ? q.answers : q.keywords;

  return (
    <Card className="p-5 sm:p-8 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Badge tone="primary">{TYPE_LABELS[q.type] ?? 'Pregunta'}</Badge>
      </div>
      <p className="text-fg font-bold text-lg mb-6">
        <MathText content={q.q} />
      </p>

      {isChoice && (
        <>
          <ChoiceQuestion
            kind={q.type as 'multiple_choice' | 'true_false'}
            options={q.opts ?? []}
            selected={selected}
            answered={phase === 'done'}
            correct={q.ok as ChoiceValue | undefined}
            onAnswer={answerChoice}
          />
          <AnswerFeedback
            result={phase === 'done' ? correct : null}
            correctText={correctChoiceText(q.type as 'multiple_choice' | 'true_false', q.opts ?? [], q.ok as ChoiceValue | undefined)}
          />
        </>
      )}

      {isText && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (phase !== 'done' && text.trim()) checkText();
          }}
          className="space-y-3"
        >
          <Field
            label="Tu respuesta"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={phase === 'done'}
            autoComplete="off"
            autoFocus
          />
          {phase !== 'done' && (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!text.trim()}>
                Comprobar
              </Button>
              {phase === 'retry' && (
                <Button type="button" variant="secondary" onClick={showAnswer}>
                  Ver la respuesta
                </Button>
              )}
            </div>
          )}
          <div aria-live="polite" role="status">
            {phase === 'retry' && hint && (
              <p className="flex items-start gap-2 rounded-xl border border-line-strong bg-surface-2 p-3 text-sm text-fg">
                <RotateCcw className="mt-0.5 h-4 w-4 flex-shrink-0 text-fg-muted" aria-hidden="true" />
                {hint}
              </p>
            )}
            {phase === 'done' && (
              <div className={`mt-2 flex items-start gap-2 rounded-xl border p-4 ${correct ? 'border-success/40 bg-success/10' : 'border-danger/40 bg-danger/10'}`}>
                {correct ? <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-success" aria-hidden="true" /> : <XCircle className="h-5 w-5 flex-shrink-0 text-danger" aria-hidden="true" />}
                <p className="text-fg font-medium">
                  {correct ? '¡Correcto!' : gaveUp ? 'Esta era la respuesta:' : 'Revisa la respuesta:'}
                  {!correct && expected && expected.length > 0 && (
                    <>
                      {' '}
                      <MathText content={q.type === 'fill_blank' ? expected.join(', ') : `debe mencionar ${expected.join(', ')}`} />
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
        </form>
      )}

      {q.type === 'match' && q.pairs && (
        <>
          <LessonQuestionMatch pairs={q.pairs} disabled={phase === 'done'} onComplete={(ok) => finish(ok)} />
          <div aria-live="polite" role="status">
            {phase === 'done' && (
              <p className={`mt-4 rounded-xl border p-3 text-sm font-medium text-fg ${correct ? 'border-success/40 bg-success/10' : 'border-danger/40 bg-danger/10'}`}>
                {correct ? '¡Conectaste todo bien!' : 'Estas eran las conexiones correctas, repásalas con calma.'}
              </p>
            )}
          </div>
        </>
      )}

      {phase === 'done' && q.exp && (
        <div className="mt-6 p-4 bg-primary/10 border-l-4 border-primary rounded-lg">
          <p className="text-primary-text font-medium flex items-center gap-2">
            <Lightbulb className="h-4 w-4" aria-hidden="true" /> Explicación:
          </p>
          <p className="text-fg mt-1">
            <MathText content={q.exp} />
          </p>
        </div>
      )}

      {phase === 'done' && (
        <Button size="lg" className="w-full mt-6 text-lg" onClick={() => onNext(firstTry === true)} autoFocus>
          {last ? 'Ver mi resumen' : 'Siguiente pregunta'}
        </Button>
      )}
    </Card>
  );
}

export function PracticeClient({
  questions,
  classroomId,
  classroomName,
  answeredTotal,
  wrongTotal,
}: {
  questions: PracticeQuestion[];
  classroomId: string;
  classroomName: string;
  answeredTotal: number;
  wrongTotal: number;
}) {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const [firstTries, setFirstTries] = useState<boolean[]>([]);
  const finished = idx >= questions.length;
  const progress = questions.length > 0 ? (Math.min(idx, questions.length) / questions.length) * 100 : 0;

  const back = (
    <Link href={`/my-classes/${classroomId}`} className="inline-flex items-center gap-2 min-h-[44px] text-sm font-medium text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Volver a {classroomName}
    </Link>
  );

  if (finished) {
    const good = firstTries.filter(Boolean).length;
    return (
      <div className="theme-scope max-w-2xl mx-auto space-y-6">
        {back}
        <Card className="p-6 sm:p-8 text-center space-y-3">
          <h1 className="text-2xl font-bold text-fg">Práctica terminada</h1>
          <p className="text-fg text-lg">
            Acertaste {good} de {firstTries.length} a la primera.
          </p>
          <p className="text-fg-muted text-sm">Nada de esto cambia tu racha, tus monedas ni lo que ve tu profesor. Practica cuando quieras.</p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Button
              onClick={() => {
                setIdx(0);
                setFirstTries([]);
                router.refresh();
              }}
            >
              Practicar otra vez
            </Button>
            <Link
              href={`/my-classes/${classroomId}`}
              className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl font-semibold text-sm bg-surface-2 text-fg border border-line hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Volver a la clase
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="theme-scope max-w-2xl mx-auto space-y-4">
      {back}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-fg">Práctica sin presión</h1>
          <Badge tone="accent">Modo práctica</Badge>
        </div>
        <p className="text-fg-muted text-sm mt-1">
          No suma racha ni monedas y tu profesor no ve estas respuestas. Puedes reintentar y ver la respuesta cuando quieras.
          {wrongTotal > 0 ? ` Empezamos por lo que más te costó (${wrongTotal} de ${answeredTotal} preguntas).` : ''}
        </p>
        <div className="flex justify-between text-sm text-fg-muted mt-4 mb-2">
          <span>
            Pregunta {idx + 1} de {questions.length}
          </span>
          <span>{Math.round(progress)}%</span>
        </div>
        <ProgressBar value={progress} label={`Pregunta ${idx + 1} de ${questions.length}`} />
      </div>
      <PracticeCard
        key={questions[idx].id}
        q={questions[idx]}
        last={idx === questions.length - 1}
        onNext={(ok) => {
          setFirstTries((f) => [...f, ok]);
          setIdx((i) => i + 1);
        }}
      />
    </div>
  );
}
