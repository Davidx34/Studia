'use client';

// Sesion F.3: no hay pantalla de "settings" todavia, asi que el toggle de
// sonido vive directo en el header (visible siempre, un click).

import { useSoundEnabled } from '@/lib/sound/useSoundFx';

export function SoundToggle() {
  const [enabled, setEnabled] = useSoundEnabled();
  return (
    <button
      onClick={() => setEnabled(!enabled)}
      title={enabled ? 'Sonido activado' : 'Sonido desactivado'}
      className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition text-lg"
    >
      {enabled ? '🔊' : '🔇'}
    </button>
  );
}
