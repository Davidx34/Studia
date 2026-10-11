'use client';

// Paso 4: el profesor importa a mano las imagenes y videos que genero fuera (Flow, Gemini, etc.).
// Las imagenes se reducen en el navegador (lado mayor 1600 px, WebP) para cuidar el plan gratuito de Supabase.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImagePlus, Loader2, Trash2, Film, AlertCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { confirmMediaUpload, deleteMedia, getMediaUploadUrl, updateMedia } from '@/lib/actions/media';
import {
  MAX_CLASS_MEDIA_BYTES,
  MAX_CLASS_MEDIA_COUNT,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  IMAGE_MAX_SIDE_PX,
  fitWithin,
  formatMB,
  kindOfMime,
} from '@/lib/media/mediaGuards';

interface MediaRow {
  id: string;
  kind: 'image' | 'video';
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  alt_text: string;
  caption: string | null;
  module_id: string | null;
  created_at: string;
}

const BUCKET = 'class-media';

// PNG/JPG -> WebP escalado. Si el resultado no es mas chico que el original, se conserva el original.
async function compressImage(file: File): Promise<File> {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') return file;
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, IMAGE_MAX_SIDE_PX);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  for (const q of [0.85, 0.7, 0.55]) {
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/webp', q));
    if (blob && blob.size <= MAX_IMAGE_BYTES) {
      const out = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
      return out.size < file.size || file.size > MAX_IMAGE_BYTES ? out : file;
    }
  }
  return file;
}

export default function MediaClient({
  classroomId,
  initialMedia,
  modules,
}: {
  classroomId: string;
  initialMedia: MediaRow[];
  modules: { id: string; title: string }[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [media, setMedia] = useState<MediaRow[]>(initialMedia);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const usedBytes = media.reduce((n, m) => n + m.size_bytes, 0);
  const usedPct = Math.min(100, Math.round((usedBytes / MAX_CLASS_MEDIA_BYTES) * 100));

  // URLs firmadas de lectura (1 h) para las vistas previas.
  const signAll = useCallback(
    async (rows: MediaRow[]) => {
      if (rows.length === 0) return;
      const { data } = await supabase.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.storage_path), 3600);
      const map: Record<string, string> = {};
      (data ?? []).forEach((d) => {
        if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
      });
      setUrls((prev) => ({ ...prev, ...map }));
    },
    [supabase]
  );

  useEffect(() => {
    void signAll(media);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = kindOfMime(file.type) === 'image' ? await compressImage(file) : file;
      const input = { classroomId, filename: prepared.name, mimeType: prepared.type, sizeBytes: prepared.size, altText: alt, caption: caption || null };
      const prep = await getMediaUploadUrl(input);
      if (!prep.ok || !prep.storagePath || !prep.token) {
        setError(prep.error ?? 'No se pudo preparar la subida.');
        return;
      }
      const { error: upErr } = await supabase.storage.from(BUCKET).uploadToSignedUrl(prep.storagePath, prep.token, prepared, { contentType: prepared.type });
      if (upErr) {
        setError('No se pudo subir el archivo. Intenta de nuevo.');
        return;
      }
      const done = await confirmMediaUpload({ ...input, storagePath: prep.storagePath, moduleId: moduleId || null });
      if (!done.ok) {
        setError(done.error ?? 'No se pudo registrar el archivo.');
        return;
      }
      setFile(null);
      setAlt('');
      setCaption('');
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
      // Se recarga la lista desde la base (incluye el id nuevo) y se firma su vista previa.
      const { data } = await supabase.from('class_media' as any).select('id, kind, storage_path, mime_type, size_bytes, alt_text, caption, module_id, created_at').eq('classroom_id', classroomId).order('created_at', { ascending: false });
      const rows = ((data as unknown) as MediaRow[]) ?? [];
      setMedia(rows);
      void signAll(rows);
    } catch {
      setError('Algo salió mal al preparar el archivo.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: MediaRow) => {
    if (!confirm('¿Borrar este archivo? Los estudiantes dejarán de verlo.')) return;
    const r = await deleteMedia(classroomId, m.id);
    if (!r.ok) {
      setError(r.error ?? 'No se pudo borrar.');
      return;
    }
    setMedia((prev) => prev.filter((x) => x.id !== m.id));
  };

  const relink = async (m: MediaRow, value: string) => {
    const r = await updateMedia(classroomId, m.id, { moduleId: value || null });
    if (!r.ok) {
      setError(r.error ?? 'No se pudo guardar.');
      return;
    }
    setMedia((prev) => prev.map((x) => (x.id === m.id ? { ...x, module_id: value || null } : x)));
  };

  const inputCls = 'w-full min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500';

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-2">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <ImagePlus className="w-5 h-5 text-violet-300" aria-hidden="true" /> Imágenes y videos
        </h2>
        <p className="text-sm text-slate-400">
          Sube lo que generaste con Flow, Gemini u otra herramienta y asócialo a un módulo: los estudiantes lo verán dentro de la lección.
          Imágenes PNG, JPG o WebP (se reducen solas a máx. {formatMB(MAX_IMAGE_BYTES)}); videos MP4 o WebM de hasta {formatMB(MAX_VIDEO_BYTES)}.
        </p>
        <div>
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>Espacio de la clase</span>
            <span>
              {formatMB(usedBytes)} de {formatMB(MAX_CLASS_MEDIA_BYTES)} · {media.length}/{MAX_CLASS_MEDIA_COUNT} archivos
            </span>
          </div>
          <div role="progressbar" aria-label="Espacio usado" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedPct} className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className={`h-full ${usedPct > 85 ? 'bg-amber-400' : 'bg-violet-500'}`} style={{ width: `${usedPct}%` }} />
          </div>
        </div>
      </div>

      <form onSubmit={upload} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-3">
        <div>
          <label htmlFor="media-file" className="block text-sm font-medium text-slate-200 mb-1">Archivo</label>
          <input
            id="media-file"
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-300 file:mr-3 file:min-h-[44px] file:rounded-lg file:border-0 file:bg-violet-600 file:px-4 file:text-white"
          />
        </div>
        <div>
          <label htmlFor="media-alt" className="block text-sm font-medium text-slate-200 mb-1">Descripción (obligatoria)</label>
          <input id="media-alt" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={300} placeholder="Qué se ve, para quien no pueda verlo" className={inputCls} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="media-caption" className="block text-sm font-medium text-slate-200 mb-1">Pie de foto (opcional)</label>
            <input id="media-caption" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} className={inputCls} />
          </div>
          <div>
            <label htmlFor="media-module" className="block text-sm font-medium text-slate-200 mb-1">Módulo</label>
            <select id="media-module" value={moduleId} onChange={(e) => setModuleId(e.target.value)} className={inputCls}>
              <option value="">Sin módulo (solo en la clase)</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
            </select>
          </div>
        </div>
        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm text-red-300">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /> {error}
          </p>
        )}
        <button
          type="submit"
          disabled={!file || alt.trim().length < 3 || busy}
          className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-medium"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Subir
        </button>
      </form>

      {media.length === 0 ? (
        <p className="text-slate-400 text-sm">Aún no hay archivos.</p>
      ) : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {media.map((m) => (
            <li key={m.id} className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden">
              <div className="aspect-video bg-slate-950 flex items-center justify-center">
                {urls[m.storage_path] ? (
                  m.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={urls[m.storage_path]} alt={m.alt_text} loading="lazy" className="w-full h-full object-contain" />
                  ) : (
                    <video src={urls[m.storage_path]} controls preload="none" aria-label={m.alt_text} className="w-full h-full" />
                  )
                ) : (
                  <Film className="w-8 h-8 text-slate-600" aria-hidden="true" />
                )}
              </div>
              <div className="p-3 space-y-2">
                <p className="text-sm text-slate-200">{m.alt_text}</p>
                {m.caption && <p className="text-xs text-slate-400">{m.caption}</p>}
                <p className="text-xs text-slate-500">{m.kind === 'image' ? 'Imagen' : 'Video'} · {formatMB(m.size_bytes)}</p>
                <label className="block text-xs text-slate-400">
                  Módulo
                  <select value={m.module_id ?? ''} onChange={(e) => void relink(m, e.target.value)} className={inputCls + ' mt-1'}>
                    <option value="">Sin módulo</option>
                    {modules.map((mod) => (
                      <option key={mod.id} value={mod.id}>{mod.title}</option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => void remove(m)} className="inline-flex items-center gap-1.5 min-h-[44px] text-sm text-red-300 hover:text-red-200">
                  <Trash2 className="w-4 h-4" aria-hidden="true" /> Borrar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
