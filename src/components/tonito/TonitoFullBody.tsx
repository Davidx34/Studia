'use client';

// Sesion F.2: version "cinematica" de Toñito. Reusa las mismas imagenes de
// TonitoCharacter (no hay poses full-body dibujadas todavia) pero las
// muestra grandes con animaciones de entrada/salida/celebracion pensadas
// para pantalla completa. Facil de swapear despues por arte real sin tocar
// los llamadores.

import { memo } from 'react';
import { TonitoCharacter } from './TonitoCharacter';
import type { TonitoMood } from '@/stores/useTonitoStore';

export type CinematicAnimation =
  | 'enter'
  | 'dance'
  | 'victoryJump'
  | 'spin360'
  | 'breathing'
  | 'exit'
  | 'none'
  // Mejora 1: variantes "full-body" con mas peso/anticipacion.
  | 'enterEpic'
  | 'danceFull'
  | 'victoryJumpFull'
  | 'reflection'
  | 'compassionHug'
  | 'celebrationFull';

// "cinema" (Mejora 1) es el tamaño mas grande, pensado para cinematicas de
// pantalla completa donde Toñito domina la escena.
const sizeMap = { small: 80, medium: 140, large: 220, fullscreen: 300, cinema: 380 } as const;

const cinematicClass: Record<CinematicAnimation, string> = {
  enter: 'tonito-enter-bounce',
  dance: 'tonito-dance',
  victoryJump: 'tonito-victory-jump',
  spin360: 'tonito-spin-360',
  breathing: 'tonito-breathing',
  exit: 'tonito-exit',
  none: '',
  enterEpic: 'tonito-enter-epic',
  danceFull: 'tonito-dance-full',
  victoryJumpFull: 'tonito-victory-jump-full',
  reflection: 'tonito-reflection',
  compassionHug: 'tonito-compassion-hug',
  celebrationFull: 'tonito-celebration-full',
};

// Duracion base (ms) de cada animacion, tal como esta definida en
// globals.css — usada para que "intensity" pueda escalarla sin duplicar
// los keyframes.
const baseDurationMs: Record<CinematicAnimation, number> = {
  enter: 700,
  dance: 500,
  victoryJump: 900,
  spin360: 1100,
  breathing: 2400,
  exit: 350,
  none: 0,
  enterEpic: 900,
  danceFull: 700,
  victoryJumpFull: 1100,
  reflection: 2600,
  compassionHug: 1800,
  celebrationFull: 1400,
};

// Controla que tan rapido/marcada se siente la animacion: "intense" acorta
// la duracion (movimiento mas brusco/energico), "calm" la alarga.
const intensityScale = { calm: 1.4, normal: 1, intense: 0.75 } as const;

interface Props {
  mood: TonitoMood;
  animation?: CinematicAnimation;
  size?: keyof typeof sizeMap;
  gradient?: [string, string];
  intensity?: keyof typeof intensityScale;
}

function TonitoFullBodyBase({
  mood,
  animation = 'enter',
  size = 'large',
  gradient = ['#6C5CE7', '#00D2D3'],
  intensity = 'normal',
}: Props) {
  const duration = baseDurationMs[animation] * intensityScale[intensity];
  return (
    <div
      className={cinematicClass[animation]}
      style={intensity !== 'normal' && duration > 0 ? { animationDuration: `${duration}ms` } : undefined}
    >
      <TonitoCharacter mood={mood} animation="idle" gradient={gradient} size={sizeMap[size]} />
    </div>
  );
}

export const TonitoFullBody = memo(TonitoFullBodyBase);
