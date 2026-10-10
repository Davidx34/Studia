'use client';

// Sesion F.3: no hay pantalla de "settings" todavia, asi que el toggle de
// sonido vive directo en el header (visible siempre, un click).

import { Volume2, VolumeX } from 'lucide-react';
import { useSoundEnabled } from '@/lib/sound/useSoundFx';

export function SoundToggle() {
  const [enabled, setEnabled] = useSoundEnabled();
  const Icon = enabled ? Volume2 : VolumeX;
  return (
    <button
      type="button"
      onClick={() => setEnabled(!enabled)}
      aria-pressed={enabled}
      aria-label="Sonido"
      title={enabled ? 'Sonido activado' : 'Sonido desactivado'}
      className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-fg hover:brightness-110 cursor-pointer transition-[filter] duration-200 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
