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
} from 'lucide-react';
import { MIME_INFO } from '@/lib/materials/constants';
import { formatBytes } from '@/lib/materials/file-helpers';
import {
  reprocessMaterial,
  renameMaterial,
  deleteMaterial,
} from '@/lib/actions/materials';
import type { TeachingMaterial } from '@/types/database';

export default function MaterialsList({
  classroomId,
  materials,
}: {
  classroomId: string;
  materials: TeachingMaterial[];
}) {
  if (materials.length === 0) {
    return (
      <div className="text-center py-12 rounded-2xl bg-slate-900/40 border border-slate-800 border-dashed">
        <p className="text-sm text-slate-500">
          Aún no hay materiales subidos. Arrastra archivos arriba para empezar.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
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

  const mimeInfo = MIME_INFO[material.mime_type] ?? { ext: '?', label: material.mime_type };
  const Icon = pickIcon(material.mime_type);

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
      className={`flex items-start gap-3 px-4 py-3 ${
        isLast ? '' : 'border-b border-slate-800'
      } group`}
      title={material.extracted_text_preview ?? undefined}
    >
      <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-slate-300" />
      </div>

      <div className="flex-1 min-w-0">
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
              className="flex-1 px-2 py-1 rounded-md bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-violet-500"
            />
            <button
              onClick={handleRename}
              disabled={busy}
              className="p-1 rounded hover:bg-slate-800 text-emerald-400"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={busy}
              className="p-1 rounded hover:bg-slate-800 text-slate-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="text-sm font-medium text-white truncate">
            {material.display_name ?? material.filename}
          </div>
        )}

        <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 flex-wrap">
          <span className="uppercase">{mimeInfo.ext}</span>
          <span>·</span>
          <span>{formatBytes(material.size_bytes)}</span>
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
          <p className="text-xs text-red-300 mt-1">⚠ {material.processing_error}</p>
        )}
      </div>

      <StatusBadge status={material.processing_status} />

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
        {(material.processing_status === 'failed' ||
          material.processing_status === 'completed') && (
          <button
            onClick={handleReprocess}
            disabled={busy}
            title="Reprocesar"
            className="p-2 rounded-lg text-slate-500 hover:text-violet-300 hover:bg-violet-500/10 transition"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        {material.processing_status === 'pending' && (
          <button
            onClick={handleReprocess}
            disabled={busy}
            title="Reintentar"
            className="p-2 rounded-lg text-amber-400 hover:bg-amber-500/10 transition"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            disabled={busy}
            title="Renombrar"
            className="p-2 rounded-lg text-slate-500 hover:text-violet-300 hover:bg-violet-500/10 transition"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={busy}
          title="Eliminar"
          className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition"
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Trash2 className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

function pickIcon(mime: string) {
  if (mime.includes('pdf')) return FileText;
  if (mime.includes('spreadsheet') || mime.includes('excel')) return FileSpreadsheet;
  if (mime.includes('word')) return FileText;
  return FileIcon;
}

function StatusBadge({ status }: { status: TeachingMaterial['processing_status'] }) {
  if (status === 'completed') {
    return (
      <span
        title="Procesado"
        className="inline-flex items-center gap-1 text-xs text-emerald-400"
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
      </span>
    );
  }
  if (status === 'processing') {
    return (
      <span
        title="Procesando…"
        className="inline-flex items-center gap-1 text-xs text-violet-400"
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span
        title="En cola"
        className="inline-flex items-center gap-1 text-xs text-amber-400"
      >
        <Clock className="w-3.5 h-3.5" />
      </span>
    );
  }
  return (
    <span title="Falló" className="inline-flex items-center gap-1 text-xs text-red-400">
      <AlertCircle className="w-3.5 h-3.5" />
    </span>
  );
}
