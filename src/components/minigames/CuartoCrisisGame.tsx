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
        <p className="text-red-300 text-xs font-semibold uppercase tracking-wide">🚨 Cuarto de Crisis</p>
        <div
          className={
            'px-3 py-1.5 rounded-lg font-mono font-bold text-sm border-2 transition-colors ' +
            (finished
              ? 'bg-gray-800 border-gray-700 text-gray-400'
              : timeUrgent
              ? 'bg-red-900 border-red-500 text-red-200 animate-pulse'
              : 'bg-gray-800 border-gray-600 text-gray-200')
          }
        >
          ⏱️ {timeLeft}s
        </div>
      </div>

      <p className="text-gray-300 text-sm">{gameData.crisis_scenario}</p>

      <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-3 space-y-1">
        <p className="text-xs text-gray-400 font-semibold uppercase">Telemetría</p>
        {(gameData.telemetry_data || []).map((t, i) => (
          <p key={i} className="text-sm text-amber-200">📊 {t}</p>
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
                    ? 'bg-green-700 border-green-400 text-white'
                    : 'bg-red-700 border-red-400 text-white'
                  : finished !== null
                  ? 'bg-gray-800 border-gray-700 text-gray-400'
                  : 'bg-gray-700 border-gray-600 text-gray-100 hover:border-purple-400')
              }
            >
              <span className="font-mono text-xs text-purple-300 mr-2">[{iv.action_code}]</span>
              {iv.description}
            </button>
          );
        })}
      </div>

      {finished === 'won' && (
        <div className="bg-green-900 border border-green-500 p-4 rounded-lg">
          <p className="text-green-300 font-bold">✅ {selected?.consequence}</p>
          {gameData.post_mortem_report && (
            <p className="text-green-100 text-sm mt-1">{gameData.post_mortem_report}</p>
          )}
        </div>
      )}

      {finished === 'lost' && (
        <div className="bg-blue-900 border border-blue-500 p-4 rounded-lg">
          <p className="text-blue-300 font-bold">
            {selected ? selected.consequence : '⏰ Se acabó el tiempo. La crisis no fue contenida.'}
          </p>
          {gameData.post_mortem_report && (
            <p className="text-blue-100 text-sm mt-1">{gameData.post_mortem_report}</p>
          )}
        </div>
      )}
    </div>
  );
}
