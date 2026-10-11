'use client';

// Imagenes y videos que el profesor importo para este modulo (paso 4). Se muestran en un bloque plegable sobre la
// pregunta: no estorban y el estudiante decide si abrirlo.
//
// Cuidado del plan gratuito (salida de datos): las imagenes cargan perezosas y los videos NO se descargan ni se
// reproducen solos (preload="none"). Accesibilidad: cada imagen lleva su texto alternativo y los videos, controles.

import { useEffect, useMemo, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Card } from '@/components/ui/Card';

interface MediaItem {
  id: string;
  kind: 'image' | 'video';
  storage_path: string;
  alt_text: string;
  caption: string | null;
}

const BUCKET = 'class-media';

export function ModuleMedia({ moduleId, defaultOpen }: { moduleId: string; defaultOpen: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('class_media' as any)
        .select('id, kind, storage_path, alt_text, caption')
        .eq('module_id', moduleId)
        .order('position')
        .order('created_at');
      const rows = ((data as unknown) as MediaItem[]) ?? [];
      if (cancelled || rows.length === 0) return;
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.storage_path), 3600);
      if (cancelled) return;
      const map: Record<string, string> = {};
      (signed ?? []).forEach((s) => {
        if (s.path && s.signedUrl) map[s.path] = s.signedUrl;
      });
      setUrls(map);
      setItems(rows);
    })().catch(() => {
      /* sin medios o sin red: la leccion funciona igual */
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, moduleId]);

  const visible = items.filter((i) => urls[i.storage_path]);
  if (visible.length === 0) return null;

  return (
    <Card className="mb-6 overflow-hidden">
      <details open={defaultOpen}>
        <summary className="cursor-pointer list-none min-h-[44px] px-4 py-3 flex items-center gap-2 font-semibold text-fg">
          <ImageIcon aria-hidden="true" className="w-4 h-4 text-primary-text" />
          Material visual ({visible.length})
        </summary>
        <ul className="px-4 pb-4 space-y-4 border-t border-line pt-4">
          {visible.map((m) => (
            <li key={m.id}>
              <figure className="space-y-2">
                {m.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls[m.storage_path]} alt={m.alt_text} loading="lazy" className="w-full max-h-[420px] object-contain rounded-xl bg-surface-2" />
                ) : (
                  <video src={urls[m.storage_path]} controls preload="none" playsInline aria-label={m.alt_text} className="w-full max-h-[420px] rounded-xl bg-surface-2" />
                )}
                {m.caption && <figcaption className="text-sm text-fg-muted">{m.caption}</figcaption>}
              </figure>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
