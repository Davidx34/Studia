'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Loader2, AlertCircle, CheckCircle2, Link as LinkIcon, FileUp, Sparkles } from 'lucide-react';
import {
  getUploadSignedUrl,
  confirmMaterialUpload,
  addLinkMaterial,
  addNotebookLMMaterial,
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

type UploadTab = 'file' | 'link' | 'notebooklm';

export default function MaterialUploader({ classroomId }: { classroomId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState<UploadProgress[]>([]);
  // NotebookLM es la via recomendada para videos y fuentes densas: queda como primera pestaña y es la que abre por defecto.
  const [tab, setTab] = useState<UploadTab>('notebooklm');
  const [externalUrl, setExternalUrl] = useState('');
  const [externalBusy, setExternalBusy] = useState(false);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [notebookTitle, setNotebookTitle] = useState('');
  const [notebookMarkdown, setNotebookMarkdown] = useState('');
  const [notebookBusy, setNotebookBusy] = useState(false);
  const [notebookError, setNotebookError] = useState<string | null>(null);

  function openPicker() {
    inputRef.current?.click();
  }

  async function handleAddExternal(e: React.FormEvent) {
    e.preventDefault();
    const url = externalUrl.trim();
    if (!url) return;
    setExternalBusy(true);
    setExternalError(null);

    const result = await addLinkMaterial(classroomId, url);

    setExternalBusy(false);
    if (!result.ok) {
      setExternalError(result.error ?? 'No se pudo procesar el link.');
      return;
    }
    setExternalUrl('');
    router.refresh();
  }

  async function handleAddNotebookLM(e: React.FormEvent) {
    e.preventDefault();
    if (!notebookTitle.trim() || !notebookMarkdown.trim()) return;
    setNotebookBusy(true);
    setNotebookError(null);

    const result = await addNotebookLMMaterial(classroomId, notebookTitle, notebookMarkdown);

    setNotebookBusy(false);
    if (!result.ok) {
      setNotebookError(result.error ?? 'No se pudo procesar el contenido.');
      return;
    }
    setNotebookTitle('');
    setNotebookMarkdown('');
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
      <div className="flex gap-1 border-b border-line-strong">
        {(
          [
            { id: 'notebooklm' as const, label: 'NotebookLM', icon: Sparkles, hint: 'Recomendado' },
            { id: 'file' as const, label: 'Archivo', icon: FileUp, hint: null },
            { id: 'link' as const, label: 'Link', icon: LinkIcon, hint: null },
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
                  ? 'border-primary text-primary-text'
                  : 'border-transparent text-fg-muted hover:text-fg-muted'
              }`}
            >
              <TabIcon className="w-3.5 h-3.5" />
              {t.label}
              {t.hint && <span className="ml-1 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary-text">{t.hint}</span>}
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
              ? 'border-primary bg-primary/5'
              : 'border-line-strong bg-surface hover:border-line-strong hover:bg-surface'
          }`}
        >
          <Upload
            className={`w-10 h-10 mx-auto mb-3 ${
              dragActive ? 'text-primary-text' : 'text-fg-muted'
            }`}
          />
          <h3 className="text-sm font-semibold text-fg mb-1">
            Arrastra archivos o haz clic para seleccionar
          </h3>
          <p className="text-xs text-fg-muted">
            PDF, DOCX, XLSX, Markdown o TXT · Máx {formatBytes(MAX_FILE_SIZE_BYTES)} por archivo
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

      {tab === 'link' && (
        <form onSubmit={handleAddExternal} className="rounded-2xl border-2 border-dashed border-line-strong bg-surface p-6 space-y-3">
          <p className="text-xs text-fg-muted">
            Pega el link de un artículo o página web. Se extraerá el contenido igual que un documento.
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              required
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder="https://..."
              className="flex-1 px-3 py-2 rounded-lg bg-bg border border-line-strong text-sm text-fg placeholder-fg-muted focus:outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={externalBusy || !externalUrl.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary hover:brightness-110 text-on-primary disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {externalBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Agregar
            </button>
          </div>
          {externalError && (
            <div className="flex items-center gap-2 text-xs text-danger">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {externalError}
            </div>
          )}
        </form>
      )}

      {tab === 'notebooklm' && (
        <form onSubmit={handleAddNotebookLM} className="rounded-2xl border-2 border-dashed border-line-strong bg-surface p-6 space-y-3">
          <div className="text-xs text-fg-muted space-y-2">
            <p>
              La forma más confiable de usar un <strong className="text-fg">video</strong> (o cualquier fuente densa): lo
              resumes en{' '}
              <a
                href="https://notebooklm.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-text underline hover:text-primary-text"
              >
                NotebookLM
              </a>{' '}
              y pegas aquí el resultado. Tú controlas qué contenido entra.
            </p>
            <ol className="list-decimal pl-5 space-y-0.5 text-fg-muted">
              <li>Crea un cuaderno en NotebookLM y agrega el video (o PDF, enlaces) como fuente.</li>
              <li>Pídele un resumen detallado en Markdown, con títulos y listas.</li>
              <li>Copia el resultado y pégalo abajo con un título.</li>
            </ol>
            <p className="text-fg-muted">También puedes guardarlo como archivo .md y subirlo desde la pestaña Archivo.</p>
          </div>
          <input
            type="text"
            required
            value={notebookTitle}
            onChange={(e) => setNotebookTitle(e.target.value)}
            placeholder="Título del material (ej: Clase 4 - Elasticidad)"
            className="w-full px-3 py-2 rounded-lg bg-bg border border-line-strong text-sm text-fg placeholder-fg-muted focus:outline-none focus:border-primary"
          />
          <textarea
            required
            value={notebookMarkdown}
            onChange={(e) => setNotebookMarkdown(e.target.value)}
            placeholder="Pega aquí el markdown generado por NotebookLM…"
            rows={8}
            className="w-full px-3 py-2 rounded-lg bg-bg border border-line-strong text-sm text-fg placeholder-fg-muted focus:outline-none focus:border-primary font-mono resize-y"
          />
          <button
            type="submit"
            disabled={notebookBusy || !notebookTitle.trim() || !notebookMarkdown.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary hover:brightness-110 text-on-primary disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {notebookBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Agregar
          </button>
          {notebookError && (
            <div className="flex items-center gap-2 text-xs text-danger">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {notebookError}
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
              className="rounded-xl border border-line shadow-card bg-surface backdrop-blur-xl p-3"
            >
              <div className="flex items-center gap-2 text-sm">
                {row.status === 'done' ? (
                  <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                ) : row.status === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />
                ) : (
                  <Loader2 className="w-4 h-4 text-primary-text animate-spin flex-shrink-0" />
                )}
                <span className="text-fg truncate flex-1">{row.filename}</span>
                <span className="text-xs text-fg-muted">{labelStatus(row.status)}</span>
              </div>
              {row.status !== 'error' && row.status !== 'done' && (
                <div className="mt-2 h-1 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${row.pct}%` }}
                  />
                </div>
              )}
              {row.status === 'error' && row.error && (
                <p className="text-xs text-danger mt-1 ml-6">{row.error}</p>
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
