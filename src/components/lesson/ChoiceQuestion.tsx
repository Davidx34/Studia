import { CheckCircle2, XCircle } from 'lucide-react';
import { MathText } from '@/components/MathText';
import { cn } from '@/components/ui/cn';

export type ChoiceKind = 'multiple_choice' | 'true_false';
export type ChoiceValue = number | boolean;

type OptionState = 'idle' | 'right' | 'wrong';

// Estado visual de una opcion tras responder: la correcta SIEMPRE se revela; la elegida y equivocada se marca.
export function optionState(answered: boolean, isChosen: boolean, isRight: boolean): OptionState {
  if (!answered) return 'idle';
  if (isChosen && !isRight) return 'wrong';
  if (isRight) return 'right';
  return 'idle';
}

// Resultado de una pregunta de opcion unica una vez respondida; null si aun no se responde.
export function choiceResult(answered: boolean, selected: unknown, correct: unknown): boolean | null {
  return answered ? selected === correct : null;
}

export function correctChoiceText(kind: ChoiceKind, options: string[], correct: ChoiceValue | undefined): string | null {
  if (kind === 'true_false') return correct ? 'Verdadero' : 'Falso';
  return typeof correct === 'number' ? (options[correct] ?? null) : null;
}

const base =
  'w-full min-h-[48px] p-4 rounded-xl text-left font-medium border-2 text-fg cursor-pointer ' +
  'transition-colors duration-200 motion-reduce:transition-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg ' +
  'disabled:cursor-default';

const STATE_CLASS: Record<OptionState, string> = {
  right: 'bg-success/15 border-success',
  wrong: 'bg-danger/15 border-danger',
  idle: 'bg-surface-2 border-line-strong enabled:hover:border-primary',
};

// El color nunca es el unico mensaje: lleva icono y texto para lectores de pantalla.
function Mark({ state }: { state: OptionState }) {
  if (state === 'right')
    return (
      <>
        <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-success" aria-hidden="true" />
        <span className="sr-only">(correcta)</span>
      </>
    );
  if (state === 'wrong')
    return (
      <>
        <XCircle className="h-5 w-5 flex-shrink-0 text-danger" aria-hidden="true" />
        <span className="sr-only">(tu respuesta, incorrecta)</span>
      </>
    );
  return null;
}

export function ChoiceQuestion({
  kind,
  options,
  selected,
  answered,
  correct,
  onAnswer,
}: {
  kind: ChoiceKind;
  options: string[];
  selected: unknown;
  answered: boolean;
  correct: ChoiceValue | undefined;
  onAnswer: (value: ChoiceValue) => void;
}) {
  if (kind === 'true_false') {
    return (
      <div role="group" aria-label="Verdadero o falso" className="grid grid-cols-2 gap-4">
        {[true, false].map((val) => {
          const state = optionState(answered, selected === val, val === correct);
          return (
            <button
              key={String(val)}
              type="button"
              onClick={() => onAnswer(val)}
              disabled={answered}
              className={cn(base, STATE_CLASS[state], 'flex items-center justify-center gap-2 p-6 text-center font-bold text-xl')}
            >
              {val ? 'Verdadero' : 'Falso'}
              <Mark state={state} />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div role="group" aria-label="Opciones de respuesta" className="space-y-3">
      {options.map((o, i) => {
        const state = optionState(answered, selected === i, i === correct);
        return (
          <button
            key={i}
            type="button"
            onClick={() => onAnswer(i)}
            disabled={answered}
            className={cn(base, STATE_CLASS[state], 'flex items-center justify-between gap-3')}
          >
            <span>
              <MathText content={o} />
            </span>
            <Mark state={state} />
          </button>
        );
      })}
    </div>
  );
}

// Banda de resultado, anunciada por lectores de pantalla. Va SIEMPRE montada (aria-live solo anuncia cambios de una region
// que ya existia) y se llena al responder.
export function AnswerFeedback({ result, correctText }: { result: boolean | null; correctText: string | null }) {
  return (
    <div aria-live="polite" role="status">
      {result !== null && (
        <div className={cn('mt-5 flex items-start gap-2 rounded-xl border p-4', result ? 'border-success/40 bg-success/10' : 'border-danger/40 bg-danger/10')}>
          {result ? <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-success" aria-hidden="true" /> : <XCircle className="h-5 w-5 flex-shrink-0 text-danger" aria-hidden="true" />}
          <p className="text-fg font-medium">
            {result ? (
              '¡Correcto!'
            ) : (
              <>
                Incorrecto. La respuesta correcta es: <MathText content={correctText ?? ''} />
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
