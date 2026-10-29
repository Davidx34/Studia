'use client';

// Toñito en las pantallas de espera y de estado (lección preparándose, error suave, refuerzo completado). Si el espacio tiene un clip corto publicado
// (B1 a B3, ver STATE_SLOTS en src/lib/tonito/scenes.ts), muestra el video en una tarjeta cuadrada; si no, o si el video no puede cargarse o el
// estudiante pidió menos movimiento, muestra la pose de siempre (TonitoCharacter). Nunca queda en blanco ni rompe la pantalla.
//
// Los clips son verticales 9:16 con Toñito en el cuadrado central: la tarjeta cuadrada recorta al centro ('cover').

import { useState } from 'react';
import { TonitoCharacter } from './TonitoCharacter';
import { TonitoClip, useClipPlan } from './TonitoClip';
import { clipAvailable, resolveSceneClip, sceneUsesVideo } from '@/lib/tonito/clips';
import { useSceneClips } from '@/lib/tonito/sceneClips';
import type { StateSlot } from '@/lib/tonito/scenes';
import type { TonitoAnimation, TonitoMood } from '@/stores/useTonitoStore';

interface Props {
  slot: StateSlot;
  // La pose de respaldo: la misma que había antes de que existiera el clip.
  mood: TonitoMood;
  animation: TonitoAnimation;
  gradient: [string, string];
  size: number;
}

export function TonitoStateClip({ slot, mood, animation, gradient, size }: Props) {
  const { ready, rows } = useSceneClips();
  const [failed, setFailed] = useState(false);
  const clip = ready ? resolveSceneClip(slot, rows) : undefined;
  const plan = useClipPlan(clip);

  const video = !!clip && clipAvailable(clip) && sceneUsesVideo(clip, plan, failed);
  if (!video || !clip) return <TonitoCharacter mood={mood} animation={animation} gradient={gradient} size={size} />;

  return (
    <div className="relative overflow-hidden rounded-2xl" style={{ width: size, height: size }} data-tonito-state-clip={slot}>
      <TonitoClip clip={clip} fit="cover" className="absolute inset-0 h-full w-full" onFailed={() => setFailed(true)} />
    </div>
  );
}
