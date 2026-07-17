'use client';

// Sesion F.1: cinematicas full-screen con Toñito. 5 escenas, cada una con
// entrada, dialogo secuenciado, y salida. Se pueden saltar en cualquier
// momento (no bloquean al estudiante). Usa TonitoFullBody (F.2) y
// useSoundFx (F.3, tonos sintetizados) para reforzar la emocion de cada
// momento sin depender de assets que no tenemos.

import { useEffect, useState } from 'react';
import { TonitoFullBody, type CinematicAnimation } from '@/components/tonito/TonitoFullBody';
import type { TonitoMood } from '@/stores/useTonitoStore';
import { useSoundFx } from '@/lib/sound/useSoundFx';

export type CinematicType =
  | 'welcome'
  | 'lesson_start'
  | 'module_complete_good'
  | 'module_complete_low'
  | 'streak';

interface CinematicProps {
  type: CinematicType;
  studentName?: string;
  moduleTitle?: string;
  score?: number;
  xpEarned?: number;
  streak?: number;
  onComplete: () => void;
}

interface SceneConfig {
  bg: string;
  mood: TonitoMood;
  animation: CinematicAnimation;
  lines: (p: CinematicProps) => string[];
  sfx: 'whoosh' | 'fanfare' | 'levelUp' | 'bell';
  confetti: boolean;
  ctaLabel: string;
}

const SCENES: Record<CinematicType, SceneConfig> = {
  welcome: {
    bg: 'from-violet-700 via-purple-700 to-indigo-800',
    mood: 'excited',
    animation: 'enter',
    sfx: 'whoosh',
    confetti: false,
    ctaLabel: '¡Empecemos!',
    lines: (p) => [
      `¡Hola, ${p.studentName || 'estudiante'}! Bienvenido a Stud.ia`,
      'Soy Toñito, tu compañero de aprendizaje',
      'Juntos vamos a descubrir que aprender es épico',
    ],
  },
  lesson_start: {
    bg: 'from-slate-900 via-indigo-950 to-slate-900',
    mood: 'excited',
    animation: 'victoryJump',
    sfx: 'whoosh',
    confetti: false,
    ctaLabel: 'Vamos',
    lines: (p) => [p.moduleTitle || 'Nuevo módulo', 'Este va a ser increíble', '¿Listo para aprender algo épico?'],
  },
  module_complete_good: {
    bg: 'from-amber-600 via-orange-600 to-rose-600',
    mood: 'celebrating',
    animation: 'victoryJump',
    sfx: 'fanfare',
    confetti: true,
    ctaLabel: 'Continuar',
    lines: (p) => ['¡¡¡FELICIDADES!!!', '¡LO HICISTE!', `Sacaste ${p.score ?? 0}%. ¡Sos increíble!`],
  },
  module_complete_low: {
    bg: 'from-sky-800 via-cyan-800 to-slate-800',
    mood: 'encouraging',
    animation: 'breathing',
    sfx: 'bell',
    confetti: false,
    ctaLabel: 'Continuar',
    lines: (p) => [`Buen intento, ${p.studentName || ''}`, `Sacaste ${p.score ?? 0}%. Estás aprendiendo`, 'Vamos, la próxima será mejor'],
  },
  streak: {
    bg: 'from-red-700 via-orange-600 to-amber-500',
    mood: 'celebrating',
    animation: 'dance',
    sfx: 'levelUp',
    confetti: true,
    ctaLabel: '¡Seguir!',
    lines: (p) => ['¡¡¡RACHA!!!', `${p.streak ?? 0} días seguidos`, '¡Sos imparable!'],
  },
};

export function CinematicScene(props: CinematicProps) {
  const { type, xpEarned, onComplete } = props;
  const scene = SCENES[type];
  const [lineIdx, setLineIdx] = useState(0);
  const [showCta, setShowCta] = useState(false);
  const [exiting, setExiting] = useState(false);
  const { play } = useSoundFx();
  const lines = scene.lines(props);

  useEffect(() => {
    play(scene.sfx);
    if (scene.confetti) setTimeout(() => play('confetti'), 300);
    const timers: NodeJS.Timeout[] = [];
    lines.forEach((_, i) => {
      timers.push(setTimeout(() => setLineIdx(i + 1), 700 + i * 900));
    });
    timers.push(setTimeout(() => setShowCta(true), 700 + lines.length * 900 + 300));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const handleContinue = () => {
    setExiting(true);
    play('click');
    setTimeout(onComplete, 350);
  };

  return (
    <div
      className={`fixed inset-0 z-[400] flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br ${scene.bg} ${
        exiting ? 'cinematic-fade-out' : 'cinematic-fade-in'
      }`}
      role="dialog"
      aria-label="Escena animada de Toñito"
    >
      <button
        onClick={handleContinue}
        className="absolute top-4 right-4 text-xs text-white/60 hover:text-white/90 px-3 py-1.5 rounded-full bg-black/20 transition"
      >
        Saltar ✕
      </button>

      {scene.confetti && <ConfettiBurst />}

      <div className={!exiting ? 'tonito-enter-bounce' : 'tonito-exit'}>
        <TonitoFullBody mood={scene.mood} animation={scene.animation} size="fullscreen" />
      </div>

      <div className="mt-6 max-w-lg px-6 text-center space-y-2 min-h-[4.5rem]">
        {lines.slice(0, lineIdx).map((line, i) => (
          <p
            key={i}
            className={`cinematic-dialogue-in font-bold text-white ${i === lines.length - 1 ? 'text-2xl' : 'text-lg text-white/85'}`}
          >
            {line}
          </p>
        ))}
      </div>

      {typeof xpEarned === 'number' && xpEarned > 0 && lineIdx >= lines.length && (
        <p className="cinematic-dialogue-in mt-3 text-3xl font-bold text-yellow-300">+{xpEarned} XP</p>
      )}

      {showCta && (
        <button
          onClick={handleContinue}
          className="cinematic-dialogue-in mt-8 px-8 py-3 rounded-2xl bg-white text-slate-900 font-bold shadow-2xl hover:scale-105 active:scale-95 transition-transform"
        >
          {scene.ctaLabel}
        </button>
      )}
    </div>
  );
}

function ConfettiBurst() {
  const pieces = Array.from({ length: 28 }).map((_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.6,
    duration: 1.8 + Math.random() * 1.2,
    color: ['#a855f7', '#3b82f6', '#fbbf24', '#f472b6'][i % 4],
  }));
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="absolute top-[-5%] w-2 h-3 rounded-sm"
          style={{
            left: `${p.left}%`,
            background: p.color,
            animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s forwards`,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(540deg); opacity: 0.2; }
        }
      `}</style>
    </div>
  );
}
