'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CINEMATIC_TYPES, CinematicScene, sceneClipId, type CinematicType } from '@/components/cinematics/CinematicScene';
import { MEDIA_BASE, isExternalMediaBase, mediaUrl } from '@/lib/tonito/media';
import { TONITO_CLIPS, clipAvailable } from '@/lib/tonito/clips';

const LABELS: Record<CinematicType, string> = {
  welcome: 'Bienvenida',
  lesson_start: 'Inicio de lección',
  module_complete_good: 'Módulo completado (buen puntaje)',
  module_complete_low: 'Módulo completado (puntaje bajo)',
  streak: 'Racha',
};

export default function CinematicasClient() {
  const [playing, setPlaying] = useState<CinematicType | null>(null);
  const [run, setRun] = useState(0);

  return (
    <main className="mx-auto max-w-2xl p-4 text-slate-900">
      <Link href="/dev/dashboard" className="text-sm text-indigo-700 underline">
        ← Panel de desarrollo
      </Link>
      <h1 className="mt-3 text-xl font-bold">Cinemáticas</h1>
      <p className="mt-1 text-sm text-slate-600">
        Reproduce cada escena como la ve el estudiante. Si una escena tiene clip registrado y tu pantalla lo permite, se ve con video; si no, con la
        pose animada de siempre. Para probar la pantalla de un celular, usa el modo móvil del navegador.
      </p>
      <p className="mt-2 text-xs text-slate-500">
        Base de medios: <code>{MEDIA_BASE}</code> {isExternalMediaBase() ? '(remota)' : '(carpeta local: los clips no se piden)'}
      </p>

      <ul className="mt-4 space-y-3">
        {CINEMATIC_TYPES.map((type) => {
          const clipId = sceneClipId(type);
          const clip = clipId ? TONITO_CLIPS[clipId] : undefined;
          const usable = clipAvailable(clip);
          return (
            <li key={type} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{LABELS[type]}</p>
                  <p className="text-xs text-slate-500">
                    <code>{type}</code> ·{' '}
                    {clipId ? (clip ? (usable ? `video: ${clipId}` : `clip "${clipId}" registrado pero sin base remota`) : `clipId "${clipId}" SIN registrar`) : 'sin video (pose animada)'}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white"
                  onClick={() => {
                    setRun((n) => n + 1);
                    setPlaying(type);
                  }}
                >
                  Reproducir
                </button>
              </div>
              {clip && usable && (
                <p className="mt-2 break-all text-xs text-slate-500">
                  <a className="text-indigo-700 underline" href={mediaUrl(clip.src)} target="_blank" rel="noreferrer">
                    {clip.src}
                  </a>{' '}
                  · {clip.width}×{clip.height}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <h2 className="mt-6 text-sm font-semibold">Clips registrados sin escena</h2>
      <ul className="mt-1 text-sm text-slate-600">
        {Object.values(TONITO_CLIPS)
          .filter((c) => !CINEMATIC_TYPES.some((t) => sceneClipId(t) === c.id))
          .map((c) => (
            <li key={c.id}>
              <code>{c.id}</code> ({c.src})
            </li>
          ))}
        {Object.values(TONITO_CLIPS).every((c) => CINEMATIC_TYPES.some((t) => sceneClipId(t) === c.id)) && <li>Ninguno: todos tienen escena.</li>}
      </ul>

      {playing && (
        <CinematicScene
          key={run}
          type={playing}
          studentName="Ana"
          moduleTitle="Límites y continuidad"
          score={92}
          streak={7}
          onComplete={() => setPlaying(null)}
        />
      )}
    </main>
  );
}
