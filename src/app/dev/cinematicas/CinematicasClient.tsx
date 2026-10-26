'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CINEMATIC_TYPES, CinematicScene, sceneClipId, type CinematicType } from '@/components/cinematics/CinematicScene';
import { MEDIA_BASE, isExternalMediaBase, mediaUrl } from '@/lib/tonito/media';
import { TONITO_CLIPS, clipAvailable, resolveSceneClip, type SceneClipRow, type TonitoClipDef } from '@/lib/tonito/clips';
import { useSceneClips } from '@/lib/tonito/sceneClips';

const LABELS: Record<CinematicType, string> = {
  welcome: 'Bienvenida',
  lesson_start: 'Inicio de lección',
  module_complete_good: 'Módulo completado (buen puntaje)',
  module_complete_low: 'Módulo completado (puntaje bajo)',
  streak: 'Racha',
};

// Que dice cada escena, y de donde sale su clip (la base manda sobre el codigo).
function state(row: SceneClipRow | undefined, clip: TonitoClipDef | undefined, usable: boolean): string {
  if (row && !row.active) return 'apagado (active = false): se ve la pose animada';
  if (!clip) return 'sin video: se ve la pose animada';
  if (!usable) return `clip "${clip.id}" listo pero sin base remota de medios: se ve la pose`;
  return row ? `video publicado: ${clip.id}` : `video del código: ${clip.id}`;
}

export default function CinematicasClient() {
  const [playing, setPlaying] = useState<CinematicType | null>(null);
  const [run, setRun] = useState(0);
  const { ready, rows } = useSceneClips();

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
          const codeId = sceneClipId(type);
          const row = rows?.find((r) => r.scene === type);
          const clip = resolveSceneClip(type, rows, codeId ? TONITO_CLIPS[codeId] : undefined);
          const usable = clipAvailable(clip);
          return (
            <li key={type} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{LABELS[type]}</p>
                  <p className="text-xs text-slate-500">
                    <code>{type}</code> ·{' '}
                    {!ready ? 'leyendo la base…' : state(row, clip, usable)}
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

      <p className="mt-4 text-xs text-slate-500">
        Para publicar, apagar o encender un clip: <code>npm run clip:publish</code>, <code>clip:off</code>, <code>clip:on</code> y <code>clip:list</code> (guía:
        docs/TONITO_CINEMATICAS.md). Los cambios llegan a los estudiantes en pocos minutos, sin redesplegar.
      </p>

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
