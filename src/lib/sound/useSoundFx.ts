'use client';

// Sesion F.3: SFX sintetizados con Web Audio API (sin archivos mp3, que no
// tenemos). Tonos cortos generados con osciladores — no es musica real,
// pero da feedback sonoro inmediato y es trivial de reemplazar despues por
// archivos .mp3 reales (basta con cambiar la implementacion de este hook).

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'studia_sound_enabled';

let sharedCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  return sharedCtx;
}

function tone(
  ctx: AudioContext,
  freq: number,
  startAt: number,
  durationSec: number,
  type: OscillatorType = 'sine',
  peakGain = 0.15
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec + 0.02);
}

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? true : stored === 'true';
}

export function setSoundEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent('studia-sound-toggle', { detail: enabled }));
}

export function useSoundEnabled(): [boolean, (v: boolean) => void] {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    setEnabled(isSoundEnabled());
    const onToggle = (e: Event) => setEnabled((e as CustomEvent).detail);
    window.addEventListener('studia-sound-toggle', onToggle);
    return () => window.removeEventListener('studia-sound-toggle', onToggle);
  }, []);
  const update = useCallback((v: boolean) => setSoundEnabled(v), []);
  return [enabled, update];
}

type SfxName = 'whoosh' | 'coin' | 'error' | 'fanfare' | 'levelUp' | 'bell' | 'confetti' | 'click';

export function useSoundFx() {
  const enabledRef = useRef(true);
  useEffect(() => {
    enabledRef.current = isSoundEnabled();
    const onToggle = (e: Event) => (enabledRef.current = (e as CustomEvent).detail);
    window.addEventListener('studia-sound-toggle', onToggle);
    return () => window.removeEventListener('studia-sound-toggle', onToggle);
  }, []);

  const play = useCallback((name: SfxName) => {
    if (!enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;

    switch (name) {
      case 'whoosh':
        tone(ctx, 220, t0, 0.25, 'sawtooth', 0.06);
        tone(ctx, 440, t0 + 0.05, 0.15, 'sine', 0.05);
        break;
      case 'coin':
        tone(ctx, 988, t0, 0.09, 'square', 0.08);
        tone(ctx, 1319, t0 + 0.08, 0.15, 'square', 0.08);
        break;
      case 'error':
        tone(ctx, 220, t0, 0.15, 'triangle', 0.08);
        tone(ctx, 180, t0 + 0.1, 0.2, 'triangle', 0.07);
        break;
      case 'fanfare':
        [523, 659, 784, 1046].forEach((f, i) => tone(ctx, f, t0 + i * 0.12, 0.3, 'triangle', 0.09));
        break;
      case 'levelUp':
        [392, 523, 659, 784, 1046].forEach((f, i) => tone(ctx, f, t0 + i * 0.08, 0.35, 'square', 0.07));
        break;
      case 'bell':
        tone(ctx, 1568, t0, 0.4, 'sine', 0.08);
        tone(ctx, 2093, t0 + 0.02, 0.35, 'sine', 0.04);
        break;
      case 'confetti':
        for (let i = 0; i < 6; i++) {
          tone(ctx, 800 + Math.random() * 800, t0 + i * 0.04, 0.08, 'sine', 0.03);
        }
        break;
      case 'click':
        tone(ctx, 600, t0, 0.05, 'sine', 0.04);
        break;
    }
  }, []);

  return { play };
}
