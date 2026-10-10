'use client';
import { useEffect, useState } from 'react';
import { useTonitoStore } from '@/stores/useTonitoStore';

interface Intervention {
  action_code: string;
  description: string;
  is_solution: boolean;
  consequence: string;
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
export function CuartoCrisisGame({
  gameData,
  disabled,
  onComplete,
}: {
  gameData: GameData;
  disabled: boolean;
  onComplete: (correct: boolean) => void;
}) {
  const interventions = gameData.interventions || [];
  const onCorrectAnswer = useTonitoStore((s) => s.onCorrectAnswer);
  const onWrongAnswer = useTonitoStore((s) => s.onWrongAnswer);
  const showMessage = useTonitoStore((s) => s.showMessage);
  const setMood = useTonitoStore((s) => s.setMood);

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [finished, setFinished] = useState<'won' | 'lost' | null>(null);
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);

  const locked = disabled || finished !== null;

  useEffect(() => {
    if (locked) return;
    if (timeLeft <= 0) {
      onWrongAnswer();
      setFinished('lost');
      onComplete(false);
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

  function handleSelect(iv: Intervention) {
    if (locked) return;
    setSelectedCode(iv.action_code);
    if (iv.is_solution) {
      onCorrectAnswer();
      setFinished('won');
      onComplete(true);
    } else {
      onWrongAnswer();
      setFinished('lost');
      onComplete(false);
    }
  }

  const selected = interventions.find((iv) => iv.action_code === selectedCode);
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
                    : 'bg-danger/15 border-danger text-fg'
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

      {finished === 'won' && (
        <div className="bg-success/10 border border-success p-4 rounded-lg">
          <p className="text-success font-bold">✅ {selected?.consequence}</p>
          {gameData.post_mortem_report && (
            <p className="text-fg text-sm mt-1">{gameData.post_mortem_report}</p>
          )}
        </div>
      )}

      {finished === 'lost' && (
        <div className="bg-primary/10 border border-primary/40 p-4 rounded-lg">
          <p className="text-primary-text font-bold">
            {selected ? selected.consequence : '⏰ Se acabó el tiempo. La crisis no fue contenida.'}
          </p>
          {gameData.post_mortem_report && (
            <p className="text-fg text-sm mt-1">{gameData.post_mortem_report}</p>
          )}
        </div>
      )}
    </div>
  );
}
