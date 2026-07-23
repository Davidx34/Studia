'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Loader2, AlertCircle, CheckCircle2, Link as LinkIcon, Video, FileUp } from 'lucide-react';
import {
  getUploadSignedUrl,
  confirmMaterialUpload,
  addLinkMaterial,
  addYoutubeMaterial,
} from '@/lib/actions/materials';
import {
  ACCEPT_ATTRIBUTE,
  MAX_FILE_SIZE_BYTES,
} from '@/lib/materials/constants';
import {
  computeFileHash,
  detectMimeType,
  formatBytes,
  validateFile,
} from '@/lib/materials/file-helpers';

interface UploadProgress {
  filename: string;
  status: 'preparing' | 'uploading' | 'confirming' | 'done' | 'error';
  pct: number;
  error?: string;
}

type UploadTab = 'file' | 'link' | 'youtube';

export default function MaterialUploader({ classroomId }: { classroomId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState<UploadProgress[]>([]);
  const [tab, setTab] = useState<UploadTab>('file');
  const [externalUrl, setExternalUrl] = useState('');
  const [externalBusy, setExternalBusy] = useState(false);
  const [externalError, setExternalError] = useState<string | null>(null);

  function openPicker() {
    inputRef.current?.click();
  }

  async function handleAddExternal(e: React.FormEvent) {
    e.preventDefault();
    const url = externalUrl.trim();
    if (!url) return;
    setExternalBusy(true);
    setExternalError(null);

    const result = tab === 'youtube' ? await addYoutubeMaterial(classroomId, url) : await addLinkMaterial(classroomId, url);

    setExternalBusy(false);
    if (!result.ok) {
      setExternalError(result.error ?? 'No se pudo procesar el link.');
      return;
    }
    setExternalUrl('');
    router.refresh();
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);

    // Inicializar progreso
    setProgress(arr.map((f) => ({ filename: f.name, status: 'preparing', pct: 0 })));

    for (let i = 0; i < arr.length; i++) {
      const file = arr[i];
      try {
        await uploadOne(file, i);
      } catch (e) {
        setProgress((p) =>
          p.map((row, idx) =>
            idx === i
              ? { ...row, status: 'error', error: (e as Error).message }
              : row
          )
        );
      }
    }

    router.refresh();
  }

  async function uploadOne(file: File, index: number) {
    const updateRow = (patch: Partial<UploadProgress>) =>
      setProgress((p) => p.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));

    // 1. Validación cliente
    const valErr = validateFile(file);
    if (valErr) {
      updateRow({ status: 'error', error: valErr.message });
      return;
    }
    const mimeType = detectMimeType(file);
    if (!mimeType) {
      updateRow({ status: 'error', error: 'Tipo no detectable.' });
      return;
    }

    // 2. SHA-256 (best-effort: si tarda mucho, igual seguimos)
    updateRow({ status: 'preparing', pct: 5 });
    let hash: string | undefined;
    try {
      hash = await computeFileHash(file);
    } catch {
      // No bloqueante
    }

    // 3. Pedir signed URL
    updateRow({ status: 'preparing', pct: 15 });
    const urlResult = await getUploadSignedUrl({
      classroomId,
      filename: file.name,
      mimeType,
      sizeBytes: file.size,
    });
    if (!urlResult.ok || !urlResult.signedUrl || !urlResult.storagePath) {
      updateRow({ status: 'error', error: urlResult.error ?? 'No URL.' });
      return;
    }

    // 4. Upload con XHR para tener progress
    updateRow({ status: 'uploading', pct: 20 });
    await uploadWithProgress(urlResult.signedUrl, file, mimeType, (loaded, total) => {
      const pct = Math.round(20 + (loaded / total) * 70); // 20 → 90
      updateRow({ pct });
    });

    // 5. Confirmar (INSERT row + invocar edge function)
    updateRow({ status: 'confirming', pct: 95 });
    const confirm = await confirmMaterialUpload({
      classroomId,
      storagePath: urlResult.storagePath,
      filename: file.name,
      mimeType,
      sizeBytes: file.size,
      contentHash: hash,
    });
    if (!confirm.ok) {
      updateRow({ status: 'error', error: confirm.error ?? 'No se pudo confirmar.' });
      return;
    }
    updateRow({ status: 'done', pct: 100 });
  }

  function uploadWithProgress(
    url: string,
    file: File,
    mimeType: string,
    onProgress: (loaded: number, total: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', mimeType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload falló (HTTP ${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Error de red en upload.'));
      xhr.send(file);
    });
  }

  function handleDrag(e: React.DragEvent, active: boolean) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(active);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b border-slate-800">
        {(
          [
            { id: 'file' as const, label: 'Archivo', icon: FileUp },
            { id: 'link' as const, label: 'Link', icon: LinkIcon },
            { id: 'youtube' as const, label: 'YouTube', icon: Video },
          ]
        ).map((t) => {
          const TabIcon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition ${
                tab === t.id
                  ? 'border-violet-500 text-violet-300'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              <TabIcon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'file' && (
        <div
          onDragEnter={(e) => handleDrag(e, true)}
          onDragOver={(e) => handleDrag(e, true)}
          onDragLeave={(e) => handleDrag(e, false)}
          onDrop={handleDrop}
          onClick={openPicker}
          className={`rounded-2xl border-2 border-dashed cursor-pointer transition p-8 text-center ${
            dragActive
              ? 'border-violet-500 bg-violet-500/5'
              : 'border-slate-700 bg-slate-900/30 hover:border-slate-600 hover:bg-slate-900/50'
          }`}
        >
          <Upload
            className={`w-10 h-10 mx-auto mb-3 ${
              dragActive ? 'text-violet-300' : 'text-slate-500'
            }`}
          />
          <h3 className="text-sm font-semibold text-white mb-1">
            Arrastra archivos o haz clic para seleccionar
          </h3>
          <p className="text-xs text-slate-500">
            PDF, DOCX o XLSX · Máx {formatBytes(MAX_FILE_SIZE_BYTES)} por archivo
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      )}

      {(tab === 'link' || tab === 'youtube') && (
        <form onSubmit={handleAddExternal} className="rounded-2xl border-2 border-dashed border-slate-700 bg-slate-900/30 p-6 space-y-3">
          <p className="text-xs text-slate-500">
            {tab === 'youtube'
              ? 'Pega el link de un video de YouTube. Se intentará obtener la transcripción automática para generar preguntas.'
              : 'Pega el link de un artículo o página web. Se extraerá el contenido igual que un documento.'}
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              required
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder={tab === 'youtube' ? 'https://www.youtube.com/watch?v=...' : 'https://...'}
              className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500"
            />
            <button
              type="submit"
              disabled={externalBusy || !externalUrl.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-violet-500 hover:bg-violet-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {externalBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Agregar
            </button>
          </div>
          {externalError && (
            <div className="flex items-center gap-2 text-xs text-red-300">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {externalError}
            </div>
          )}
        </form>
      )}

      {/* Progreso */}
      {progress.length > 0 && (
        <div className="space-y-2">
          {progress.map((row, i) => (
            <div
              key={i}
              className="rounded-xl bg-slate-900 border border-slate-800 p-3"
            >
              <div className="flex items-center gap-2 text-sm">
                {row.status === 'done' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : row.status === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                ) : (
                  <Loader2 className="w-4 h-4 text-violet-400 animate-spin flex-shrink-0" />
                )}
                <span className="text-white truncate flex-1">{row.filename}</span>
                <span className="text-xs text-slate-500">{labelStatus(row.status)}</span>
              </div>
              {row.status !== 'error' && row.status !== 'done' && (
                <div className="mt-2 h-1 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-violet-500 transition-all"
                    style={{ width: `${row.pct}%` }}
                  />
                </div>
              )}
              {row.status === 'error' && row.error && (
                <p className="text-xs text-red-300 mt-1 ml-6">{row.error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function labelStatus(s: UploadProgress['status']): string {
  switch (s) {
    case 'preparing':
      return 'Preparando…';
    case 'uploading':
      return 'Subiendo…';
    case 'confirming':
      return 'Registrando…';
    case 'done':
      return 'Listo';
    case 'error':
      return 'Error';
  }
}
