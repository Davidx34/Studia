'use client';

// Sesion F.2: version "cinematica" de Toñito. Reusa las mismas imagenes de
// TonitoCharacter (no hay poses full-body dibujadas todavia) pero las
// muestra grandes con animaciones de entrada/salida/celebracion pensadas
// para pantalla completa. Facil de swapear despues por arte real sin tocar
// los llamadores.

import { memo } from 'react';
import { TonitoCharacter } from './TonitoCharacter';
import type { TonitoMood } from '@/stores/useTonitoStore';

export type CinematicAnimation = 'enter' | 'dance' | 'victoryJump' | 'spin360' | 'breathing' | 'exit' | 'none';

const sizeMap = { small: 80, medium: 140, large: 220, fullscreen: 300 } as const;

const cinematicClass: Record<CinematicAnimation, string> = {
  enter: 'tonito-enter-bounce',
  dance: 'tonito-dance',
  victoryJump: 'tonito-victory-jump',
  spin360: 'tonito-spin-360',
  breathing: 'tonito-breathing',
  exit: 'tonito-exit',
  none: '',
};

interface Props {
  mood: TonitoMood;
  animation?: CinematicAnimation;
  size?: keyof typeof sizeMap;
  gradient?: [string, string];
}

function TonitoFullBodyBase({ mood, animation = 'enter', size = 'large', gradient = ['#6C5CE7', '#00D2D3'] }: Props) {
  return (
    <div className={cinematicClass[animation]}>
      <TonitoCharacter mood={mood} animation="idle" gradient={gradient} size={sizeMap[size]} />
    </div>
  );
}

export const TonitoFullBody = memo(TonitoFullBodyBase);
