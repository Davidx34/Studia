'use client';
import { useEffect, useState } from 'react';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { CHECK_ERROR, textOrNull, type GameCheck } from './serverCheck';

interface Intervention {
  action_code: string;
  description: string;
  // Solo en el modo del navegador: con calificacion en el servidor la solucion y las consecuencias NO viajan.
  is_solution?: boolean;
  consequence?: string;
}

interface GameData {
  crisis_scenario: string;
  telemetry_data: string[];
  interventions: Intervention[];
  post_mortem_report?: string;
}

const TIME_LIMIT = 45;

// Minijuego 5 del catalogo (Cuarto de Crisis): escenario de alta tension con
// sintomas a analizar y 3 protocolos de intervencion (solo 1 soluciona el
// problema). Cuenta con temporizador — si se acaba el tiempo, la crisis se
// pierde igual que si se elige mal (es un simulacro de un solo intento).
//
// Con `check` (calificacion en el servidor) la solucion y las consecuencias llegan DESPUES de elegir. El temporizador sigue siendo del navegador (el servidor no lo
// vigila); al acabarse se informa al servidor como "sin eleccion" para que la pregunta quede cerrada como fallada.
export function CuartoCrisisGame({
  gameData,
  disabled,
  onComplete,
  check,
}: {
  gameData: GameData;
  disabled: boolean;
  onComplete: (correct: boolean) => void;
  check?: GameCheck;
}) {
  const interventions = gameData.interventions || [];
  const onCorrectAnswer = useTonitoStore((s) => s.onCorrectAnswer);
  const onWrongAnswer = useTonitoStore((s) => s.onWrongAnswer);
  const showMessage = useTonitoStore((s) => s.showMessage);
  const setMood = useTonitoStore((s) => s.setMood);

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [finished, setFinished] = useState<'won' | 'lost' | null>(null);
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ consequences: Record<string, string>; explanation: string | null } | null>(null);

  const locked = disabled || finished !== null || checking;

  function finish(correct: boolean) {
    if (correct) {
      onCorrectAnswer();
      setFinished('won');
    } else {
      onWrongAnswer();
      setFinished('lost');
    }
    onComplete(correct);
  }

  function readReveal(reveal: Record<string, unknown> | undefined, fallbackExplanation: string | null | undefined) {
    const raw = reveal?.consequences;
    const consequences: Record<string, string> = {};
    if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') consequences[k] = v;
    setRevealed({ consequences, explanation: textOrNull(reveal?.explanation) ?? fallbackExplanation ?? null });
  }

  useEffect(() => {
    if (locked) return;
    if (timeLeft <= 0) {
      if (!check) {
        onWrongAnswer();
        setFinished('lost');
        onComplete(false);
        return;
      }
      // Servidor: se informa que no hubo eleccion. Si no se puede, el tiempo igual se acabo: se cierra como fallada en el navegador.
      setChecking(true);
      void check({ selectedCode: null }).then((verdict) => {
        setChecking(false);
        if (verdict) readReveal(verdict.reveal, verdict.explanation);
        finish(false);
      });
      return;
    }
    if (timeLeft === 15) {
      setMood('encouraging');
      showMessage('¡El tiempo corre! ⏰', 2000);
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, locked]);

  async function handleSelect(iv: Intervention) {
    if (locked) return;
    setSelectedCode(iv.action_code);
    setError(null);
    if (!check) {
      finish(iv.is_solution === true);
      return;
    }
    setChecking(true);
    const verdict = await check({ selectedCode: iv.action_code });
    setChecking(false);
    if (!verdict) {
      setSelectedCode(null);
      setError(CHECK_ERROR);
      return;
    }
    readReveal(verdict.reveal, verdict.explanation);
    finish(verdict.correct);
  }

  const selected = interventions.find((iv) => iv.action_code === selectedCode);
  const consequence = selected ? (revealed ? revealed.consequences[selected.action_code] : selected.consequence) : undefined;
  const explanation = revealed ? revealed.explanation : gameData.post_mortem_report;
  const timeUrgent = timeLeft <= 10;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-danger text-xs font-semibold uppercase tracking-wide">🚨 Cuarto de Crisis</p>
        <div
          className={
            'px-3 py-1.5 rounded-lg font-mono font-bold text-sm border-2 transition-colors ' +
            (finished
              ? 'bg-surface-2 border-line-strong text-fg-muted'
              : timeUrgent
              ? 'bg-danger/10 border-danger text-fg animate-pulse'
              : 'bg-surface-2 border-line-strong text-fg')
          }
        >
          ⏱️ {timeLeft}s
        </div>
      </div>

      <p className="text-fg-muted text-sm">{gameData.crisis_scenario}</p>

      <div className="bg-surface/60 border border-line-strong rounded-lg p-3 space-y-1">
        <p className="text-xs text-fg-muted font-semibold uppercase">Telemetría</p>
        {(gameData.telemetry_data || []).map((t, i) => (
          <p key={i} className="text-sm text-fg">📊 {t}</p>
        ))}
      </div>

      <div className="space-y-2">
        {interventions.map((iv) => {
          const isSelected = selectedCode === iv.action_code;
          return (
            <button
              key={iv.action_code}
              onClick={() => handleSelect(iv)}
              disabled={locked}
              className={
                'w-full text-left p-4 rounded-lg border-2 text-sm font-medium transition-all ' +
                (isSelected
                  ? finished === 'won'
                    ? 'bg-success/15 border-success text-fg'
                    : finished === 'lost'
                    ? 'bg-danger/15 border-danger text-fg'
                    : 'bg-primary/10 border-primary text-fg'
                  : finished !== null
                  ? 'bg-surface-2 border-line-strong text-fg-muted'
                  : 'bg-surface-2 border-line-strong text-fg hover:border-primary')
              }
            >
              <span className="font-mono text-xs text-primary-text mr-2">[{iv.action_code}]</span>
              {iv.description}
            </button>
          );
        })}
      </div>

      {checking && <p className="text-fg-muted text-sm" aria-live="polite">Comprobando…</p>}
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}

      {finished === 'won' && (
        <div className="bg-success/10 border border-success p-4 rounded-lg">
          <p className="text-success font-bold">✅ {consequence}</p>
          {explanation && <p className="text-fg text-sm mt-1">{explanation}</p>}
        </div>
      )}

      {finished === 'lost' && (
        <div className="bg-primary/10 border border-primary/40 p-4 rounded-lg">
          <p className="text-primary-text font-bold">
            {selected ? consequence : '⏰ Se acabó el tiempo. La crisis no fue contenida.'}
          </p>
          {explanation && <p className="text-fg text-sm mt-1">{explanation}</p>}
        </div>
      )}
    </div>
  );
}
