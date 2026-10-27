'use client';

// Lee de la base (tabla tonito_scene_clips, migracion 073) que clip usa cada cinematica. Una sola lectura por sesion, con cache de 5
// minutos: publicar un clip nuevo se nota en minutos, sin redesplegar. Si la base no responde, la tabla no existe todavia o tarda mas
// de la cuenta, la cinematica usa el clip que trae el codigo (o la pose de siempre): nunca queda esperando ni se rompe.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { SceneClipRow } from './clips';

const TTL_MS = 5 * 60 * 1000;
// Cuanto espera una cinematica a la base antes de usar el respaldo. Corto: el estudiante esta viendo un fondo de color.
export const WAIT_MS = 1200;

let cache: SceneClipRow[] | null = null;
let fetchedAt = 0;
let inflight: Promise<SceneClipRow[] | null> | null = null;

const fresh = () => cache !== null && Date.now() - fetchedAt < TTL_MS;

export function loadSceneClips(): Promise<SceneClipRow[] | null> {
  if (fresh()) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // La tabla aun no esta en los tipos generados de la base.
      const { data, error } = await (createClient() as any)
        .from('tonito_scene_clips')
        .select('*'); // todas las columnas: tolera que bg_colors (migracion 074) aun no exista
      if (error || !Array.isArray(data)) return cache;
      cache = data as SceneClipRow[];
      fetchedAt = Date.now();
      return cache;
    } catch {
      return cache;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Para las pruebas.
export function resetSceneClipsCache() {
  cache = null;
  fetchedAt = 0;
  inflight = null;
}

// `ready` pasa a true cuando hay respuesta o se acaba la espera; `rows` es null si no se pudo leer.
export function useSceneClips(): { ready: boolean; rows: SceneClipRow[] | null } {
  const [state, setState] = useState<{ ready: boolean; rows: SceneClipRow[] | null }>(() => ({ ready: fresh(), rows: fresh() ? cache : null }));

  useEffect(() => {
    if (state.ready) return;
    let alive = true;
    const timer = setTimeout(() => alive && setState({ ready: true, rows: cache }), WAIT_MS);
    loadSceneClips().then((rows) => {
      if (!alive) return;
      clearTimeout(timer);
      setState({ ready: true, rows });
    });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
