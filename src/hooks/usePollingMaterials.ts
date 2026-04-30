'use client';

// Polling hook para refrescar la lista de materials mientras hay items
// en estado pending o processing.
// Fase 11.C · Stud.ia
//
// Estrategia:
//   - Cada POLLING_INTERVAL_MS (5s) re-fetch de la lista de la clase.
//   - Si hay >= POLLING_BACKOFF_AFTER_RETRIES intentos consecutivos sin cambios,
//     baja el intervalo a POLLING_BACKOFF_MS (10s) hasta que algo cambie o se
//     completen todos.
//   - Para automaticamente cuando todos los materials están en completed/failed.
//   - Robusto a errores: si la query falla, mantiene el último estado y reintenta.

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  POLLING_INTERVAL_MS,
  POLLING_BACKOFF_AFTER_RETRIES,
  POLLING_BACKOFF_MS,
} from '@/lib/materials/constants';
import type { TeachingMaterial } from '@/types/database';

export function usePollingMaterials(
  classroomId: string,
  initialMaterials: TeachingMaterial[]
) {
  const [materials, setMaterials] = useState<TeachingMaterial[]>(initialMaterials);
  const [isPolling, setIsPolling] = useState(false);
  const supabase = useRef(createClient());
  const retriesWithoutChange = useRef(0);
  const lastFingerprint = useRef('');

  useEffect(() => {
    // ¿Hay items en estado activo?
    const hasActive = materials.some(
      (m) => m.processing_status === 'pending' || m.processing_status === 'processing'
    );

    if (!hasActive) {
      setIsPolling(false);
      retriesWithoutChange.current = 0;
      return;
    }

    setIsPolling(true);
    let cancelled = false;

    async function tick() {
      try {
        const { data, error } = await supabase.current
          .from('teaching_materials')
          .select('*')
          .eq('classroom_id', classroomId)
          .order('created_at', { ascending: false });

        if (cancelled || error || !data) return;

        // Fingerprint = concat de id+status para detectar cambios
        const fp = (data as TeachingMaterial[])
          .map((m) => `${m.id}:${m.processing_status}:${m.chunk_count ?? 0}`)
          .join('|');

        if (fp === lastFingerprint.current) {
          retriesWithoutChange.current += 1;
        } else {
          retriesWithoutChange.current = 0;
          lastFingerprint.current = fp;
          setMaterials(data as TeachingMaterial[]);
        }
      } catch {
        // Mantener el último estado en error de red
      }
    }

    const interval =
      retriesWithoutChange.current >= POLLING_BACKOFF_AFTER_RETRIES
        ? POLLING_BACKOFF_MS
        : POLLING_INTERVAL_MS;

    const timer = setTimeout(tick, interval);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [materials, classroomId]);

  return { materials, isPolling, setMaterials };
}
