'use client';

import { HardDrive } from 'lucide-react';
import MaterialUploader from './MaterialUploader';
import MaterialsList from './MaterialsList';
import { usePollingMaterials } from '@/hooks/usePollingMaterials';
import { formatBytes } from '@/lib/materials/file-helpers';
import { MAX_FILE_SIZE_BYTES } from '@/lib/materials/constants';
import type { TeachingMaterial } from '@/types/database';

const STORAGE_QUOTA_BYTES = 100 * 1024 * 1024; // 100 MB cuota visual por clase

export default function MaterialsClient({
  classroomId,
  initialMaterials,
}: {
  classroomId: string;
  initialMaterials: TeachingMaterial[];
}) {
  const { materials, isPolling } = usePollingMaterials(classroomId, initialMaterials);

  const totalBytes = materials.reduce((sum, m) => sum + (m.size_bytes ?? 0), 0);
  const usedPct = Math.min(100, Math.round((totalBytes / STORAGE_QUOTA_BYTES) * 100));

  return (
    <div className="space-y-6">
      {/* Header con uso */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
          <HardDrive className="w-5 h-5 text-violet-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white">
            {materials.length} {materials.length === 1 ? 'archivo' : 'archivos'} ·{' '}
            {formatBytes(totalBytes)} de {formatBytes(STORAGE_QUOTA_BYTES)}
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-violet-500 transition-all"
              style={{ width: `${usedPct}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            Tamaño máximo por archivo: {formatBytes(MAX_FILE_SIZE_BYTES)}
          </div>
        </div>
        {isPolling && (
          <div className="text-xs text-amber-300 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Procesando…
          </div>
        )}
      </div>

      {/* Uploader */}
      <MaterialUploader classroomId={classroomId} />

      {/* Lista */}
      <MaterialsList classroomId={classroomId} materials={materials} />
    </div>
  );
}
