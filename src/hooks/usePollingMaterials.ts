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
//   - Para automaticamente cuando todos los materials están en completed/failed
//     (o se dieron por interrumpidos, ver processingState.ts).
//   - Robusto a errores: si la query falla, mantiene el último estado y reintenta.
//
// Antes la siguiente consulta solo se programaba cuando el estado CAMBIABA (el efecto dependia de `materials`), asi
// que si nada cambiaba tras la primera consulta el polling se detenia en silencio. No se notaba porque la subida
// de un PDF esperaba a que terminara el procesamiento; ahora el procesamiento es en segundo plano y puede tardar
// minutos, asi que la consulta se reprograma siempre mientras haya algo activo.

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  POLLING_INTERVAL_MS,
  POLLING_BACKOFF_AFTER_RETRIES,
  POLLING_BACKOFF_MS,
} from '@/lib/materials/constants';
import { isStalledProcessing } from '@/lib/materials/processingState';
import type { TeachingMaterial } from '@/types/database';

export function hasActiveProcessing(materials: TeachingMaterial[], now: number): boolean {
  return materials.some(
    (m) =>
      (m.processing_status === 'pending' || m.processing_status === 'processing') &&
      !isStalledProcessing(m.processing_status, m.processing_started_at, now)
  );
}

export function usePollingMaterials(
  classroomId: string,
  initialMaterials: TeachingMaterial[]
) {
  const [materials, setMaterials] = useState<TeachingMaterial[]>(initialMaterials);
  const [now, setNow] = useState(() => Date.now());
  const supabase = useRef(createClient());
  const retriesWithoutChange = useRef(0);
  const lastFingerprint = useRef('');

  // router.refresh() (tras subir o reprocesar) entrega una lista nueva desde el servidor: useState ignora los props
  // nuevos, asi que se sincroniza aqui. Sin esto un material recien subido no aparecia hasta recargar la pagina.
  useEffect(() => {
    setMaterials(initialMaterials);
    lastFingerprint.current = '';
    retriesWithoutChange.current = 0;
    setNow(Date.now());
  }, [initialMaterials]);

  const isPolling = hasActiveProcessing(materials, now);

  useEffect(() => {
    if (!isPolling) {
      retriesWithoutChange.current = 0;
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      const interval =
        retriesWithoutChange.current >= POLLING_BACKOFF_AFTER_RETRIES ? POLLING_BACKOFF_MS : POLLING_INTERVAL_MS;
      timer = setTimeout(tick, interval);
    };

    async function tick() {
      try {
        const { data, error } = await supabase.current
          .from('teaching_materials')
          .select('*')
          .eq('classroom_id', classroomId)
          .order('created_at', { ascending: false });

        if (cancelled) return;
        if (!error && data) {
          // Fingerprint = concat de id+status para detectar cambios
          const fp = (data as TeachingMaterial[]).map((m) => `${m.id}:${m.processing_status}:${m.chunk_count ?? 0}`).join('|');
          if (fp === lastFingerprint.current) {
            retriesWithoutChange.current += 1;
          } else {
            retriesWithoutChange.current = 0;
            lastFingerprint.current = fp;
            setMaterials(data as TeachingMaterial[]);
          }
        }
      } catch {
        // Mantener el último estado en error de red
      }
      if (cancelled) return;
      // Re-render aunque nada cambie: asi un procesamiento que se quedo colgado pasa a verse "interrumpido".
      setNow(Date.now());
      schedule();
    }

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isPolling, classroomId]);

  return { materials, isPolling, setMaterials, now };
}
