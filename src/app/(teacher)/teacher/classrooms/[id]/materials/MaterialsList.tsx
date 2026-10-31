'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText,
  FileSpreadsheet,
  File as FileIcon,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Trash2,
  Edit3,
  X,
  Check,
  Clock,
  Link as LinkIcon,
  Sparkles,
} from 'lucide-react';
import { MIME_INFO } from '@/lib/materials/constants';
import { formatBytes } from '@/lib/materials/file-helpers';
import {
  reprocessMaterial,
  renameMaterial,
  deleteMaterial,
} from '@/lib/actions/materials';
import type { TeachingMaterial } from '@/types/database';
import { describeExtraction } from '@/lib/materials/extractionLabel';
import { isStalledProcessing } from '@/lib/materials/processingState';

export default function MaterialsList({
  classroomId,
  materials,
}: {
  classroomId: string;
  materials: TeachingMaterial[];
}) {
  if (materials.length === 0) {
    return (
      <div className="text-center py-12 rounded-2xl bg-surface border border-line-strong border-dashed">
        <p className="text-sm text-fg-muted">
          Aún no hay materiales subidos. Arrastra archivos arriba para empezar.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line shadow-card bg-surface backdrop-blur-xl overflow-hidden">
      {materials.map((m, idx) => (
        <MaterialRow
          key={m.id}
          material={m}
          isLast={idx === materials.length - 1}
        />
      ))}
    </div>
  );
}

function MaterialRow({
  material,
  isLast,
}: {
  material: TeachingMaterial;
  isLast: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(material.display_name ?? material.filename);
  const [busy, setBusy] = useState(false);

  const isExternal = material.source_type !== 'file';
  const mimeInfo = material.mime_type
    ? MIME_INFO[material.mime_type] ?? { ext: '?', label: material.mime_type }
    : material.source_type === 'notebooklm'
    ? { ext: 'notebooklm', label: 'NotebookLM' }
    : { ext: 'link', label: 'Link' };
  const Icon = pickIcon(material);
  const extraction = describeExtraction(material.extraction_method, material.extraction_report);
  // Un procesamiento en segundo plano que murio sin avisar se ofrece como "interrumpido" para reintentarlo.
  const stalled = isStalledProcessing(material.processing_status, material.processing_started_at);

  async function handleRename() {
    if (!name.trim() || name === (material.display_name ?? material.filename)) {
      setEditing(false);
      return;
    }
    setBusy(true);
    await renameMaterial(material.id, name);
    setEditing(false);
    setBusy(false);
    router.refresh();
  }

  async function handleReprocess() {
    setBusy(true);
    await reprocessMaterial(material.id);
    setBusy(false);
    router.refresh();
  }

  async function handleDelete() {
    if (
      !confirm(
        `¿Borrar "${material.display_name ?? material.filename}"? Se perderán las preguntas generadas en base a este material.`
      )
    )
      return;
    setBusy(true);
    await deleteMaterial(material.id);
    // No setBusy(false): la fila desaparece tras el refresh
    router.refresh();
  }

  return (
    <div
      className={`flex flex-wrap sm:flex-nowrap items-start gap-3 px-4 py-3 ${
        isLast ? '' : 'border-b border-line-strong'
      } group`}
      title={material.extracted_text_preview ?? undefined}
    >
      <div className="w-9 h-9 rounded-xl bg-surface-2 border border-line-strong flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-fg-muted" />
      </div>

      <div className="flex-1 min-w-0 basis-40">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') setEditing(false);
              }}
              autoFocus
              maxLength={200}
              className="flex-1 px-2 py-1 rounded-md bg-bg border border-line-strong text-sm text-fg focus:outline-none focus:border-primary"
            />
            <button
              onClick={handleRename}
              disabled={busy}
              className="p-1 rounded hover:bg-surface-2 text-success"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={busy}
              className="p-1 rounded hover:bg-surface-2 text-fg-muted"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="text-sm font-medium text-fg truncate">
            {material.display_name ?? material.filename}
          </div>
        )}

        <div className="flex items-center gap-2 mt-0.5 text-xs text-fg-muted flex-wrap">
          <span className="uppercase">{mimeInfo.ext}</span>
          {!isExternal && (
            <>
              <span>·</span>
              <span>{formatBytes(material.size_bytes ?? 0)}</span>
            </>
          )}
          {material.chunk_count != null && material.chunk_count > 0 && (
            <>
              <span>·</span>
              <span>{material.chunk_count} chunks</span>
            </>
          )}
          {material.estimated_difficulty != null && (
            <>
              <span>·</span>
              <span>Dificultad {material.estimated_difficulty}/10</span>
            </>
          )}
        </div>

        {material.processing_status === 'failed' && material.processing_error && (
          <p className="text-xs text-danger mt-1">⚠ {material.processing_error}</p>
        )}

        {material.processing_status === 'completed' && extraction && (
          <p className={`text-xs mt-1 ${extraction.tone === 'warn' ? 'text-accent-text' : 'text-success'}`}>
            {extraction.tone === 'warn' ? '⚠' : '✓'} {extraction.text}
          </p>
        )}
      </div>

      <StatusBadge status={material.processing_status} stalled={stalled} />

      {/* Visibles siempre en pantallas tactiles y al enfocar con teclado; solo al pasar el cursor en pantallas grandes. */}
      <div className="ml-auto flex items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition motion-reduce:transition-none">
        {(material.processing_status === 'failed' ||
          material.processing_status === 'completed') && (
          <button
            onClick={handleReprocess}
            disabled={busy}
            title="Reprocesar"
            aria-label="Reprocesar"
            className="p-2 rounded-lg text-fg-muted hover:text-primary-text hover:bg-primary/10 transition"
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" />
            ) : (
              <RefreshCw aria-hidden="true" className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        {(material.processing_status === 'pending' || stalled) && (
          <button
            onClick={handleReprocess}
            disabled={busy}
            title={stalled ? 'Se interrumpió: reintentar' : 'Reintentar'}
            aria-label={stalled ? 'Se interrumpió: reintentar' : 'Reintentar'}
            className="p-2 rounded-lg text-accent-text hover:bg-accent/10 transition"
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" />
            ) : (
              <RefreshCw aria-hidden="true" className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            disabled={busy}
            title="Renombrar"
            aria-label="Renombrar"
            className="p-2 rounded-lg text-fg-muted hover:text-primary-text hover:bg-primary/10 transition"
          >
            <Edit3 aria-hidden="true" className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={busy}
          title="Eliminar"
          aria-label="Eliminar"
          className="p-2 rounded-lg text-fg-muted hover:text-danger hover:bg-danger/10 transition"
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Trash2 aria-hidden="true" className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

function pickIcon(material: TeachingMaterial) {
  if (material.source_type === 'notebooklm') return Sparkles;
  if (material.source_type === 'link') return LinkIcon;
  const mime = material.mime_type ?? '';
  if (mime.includes('pdf')) return FileText;
  if (mime.includes('spreadsheet') || mime.includes('excel')) return FileSpreadsheet;
  if (mime.includes('word')) return FileText;
  return FileIcon;
}

function StatusBadge({ status, stalled = false }: { status: TeachingMaterial['processing_status']; stalled?: boolean }) {
  if (stalled) {
    return (
      <span title="El procesamiento se interrumpió. Usa Reintentar." className="inline-flex items-center gap-1 text-xs text-accent-text">
        <AlertCircle aria-hidden="true" className="w-3.5 h-3.5" /> Interrumpido
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span
        title="Procesado"
        className="inline-flex items-center gap-1 text-xs text-success"
      >
        <CheckCircle2 aria-hidden="true" className="w-3.5 h-3.5" />
        <span className="sr-only">Procesado</span>
      </span>
    );
  }
  if (status === 'processing') {
    return (
      <span
        title="Procesando…"
        className="inline-flex items-center gap-1 text-xs text-primary-text"
      >
        <Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" />
        <span className="sr-only">Procesando</span>
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span
        title="En cola"
        className="inline-flex items-center gap-1 text-xs text-accent-text"
      >
        <Clock aria-hidden="true" className="w-3.5 h-3.5" />
        <span className="sr-only">En cola</span>
      </span>
    );
  }
  return (
    <span title="Falló" className="inline-flex items-center gap-1 text-xs text-danger">
      <AlertCircle aria-hidden="true" className="w-3.5 h-3.5" />
      <span className="sr-only">Falló</span>
    </span>
  );
}
