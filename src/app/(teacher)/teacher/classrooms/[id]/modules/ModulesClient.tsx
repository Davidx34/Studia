'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Map,
  Sparkles,
  Loader2,
  AlertCircle,
  Trash2,
  Users,
  RefreshCw,
} from 'lucide-react';
import {
  generateClassroomMap,
  regenerateClassroomMap,
  deleteAutoModule,
} from '@/lib/actions/classroom-map';
import type { ContentModule } from '@/types/database';

export default function ModulesClient({
  classroomId,
  modules,
  hasCompletedMaterials,
  completedCounts,
}: {
  classroomId: string;
  modules: ContentModule[];
  hasCompletedMaterials: boolean;
  completedCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const autoModules = modules.filter((m) => (m as any).auto_generated);
  const hasMap = autoModules.length > 0;

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setSuccess(null);
    const r = await generateClassroomMap(classroomId);
    setGenerating(false);
    if (!r.ok) {
      setError(r.error ?? 'Error.');
    } else {
      setSuccess(`Mapa generado: ${r.modulesCreated} módulos.`);
      router.refresh();
    }
  }

  async function handleRegenerate() {
    if (
      !confirm(
        '¿Regenerar el mapa? Esto BORRARÁ los módulos auto-generados existentes y el progreso de los estudiantes en ellos. Las preguntas en cache se invalidarán.'
      )
    )
      return;
    setGenerating(true);
    setError(null);
    setSuccess(null);
    const r = await regenerateClassroomMap(classroomId);
    setGenerating(false);
    if (!r.ok) {
      setError(r.error ?? 'Error.');
    } else {
      setSuccess(`Mapa regenerado: ${r.modulesCreated} módulos.`);
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {/* Header con CTA */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 flex items-start gap-4 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
          <Map className="w-5 h-5 text-violet-300" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-white">
            {hasMap ? 'Mapa de aprendizaje generado' : 'Sin mapa generado todavía'}
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">
            {hasMap
              ? `${autoModules.length} módulos generados por IA basados en el material que subiste.`
              : 'Sube material en la pestaña "Materiales" y luego genera el mapa con un click.'}
          </p>
        </div>
        <div className="flex gap-2">
          {hasMap ? (
            <button
              onClick={handleRegenerate}
              disabled={generating || !hasCompletedMaterials}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Regenerar mapa
            </button>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={generating || !hasCompletedMaterials}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-violet-500 hover:bg-violet-600 text-white disabled:bg-slate-700 disabled:cursor-not-allowed transition"
              title={
                !hasCompletedMaterials
                  ? 'Necesitas al menos un material procesado'
                  : 'Generar mapa'
              }
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Generar mapa
            </button>
          )}
        </div>
      </div>

      {!hasCompletedMaterials && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 flex items-start gap-2 text-sm">
          <AlertCircle className="w-4 h-4 text-amber-300 mt-0.5 flex-shrink-0" />
          <p className="text-amber-200">
            Aún no hay materiales procesados en esta clase. Sube un PDF/DOCX/XLSX
            en la pestaña "Materiales", espera a que termine de procesarse y vuelve
            acá.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 flex items-start gap-2 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-300">
          {success}
        </div>
      )}

      {/* Lista de módulos */}
      {modules.length > 0 ? (
        <div className="space-y-2">
          {modules.map((m) => (
            <ModuleRow
              key={m.id}
              module={m}
              completedBy={completedCounts[m.id] ?? 0}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 rounded-2xl bg-slate-900/30 border border-slate-800 border-dashed">
          <p className="text-sm text-slate-500">No hay módulos en esta clase aún.</p>
        </div>
      )}
    </div>
  );
}

function ModuleRow({
  module,
  completedBy,
}: {
  module: ContentModule;
  completedBy: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isAuto = (module as any).auto_generated;

  function handleDelete() {
    if (
      !confirm(
        `¿Borrar "${module.title}"? Se perderá el progreso de los estudiantes en este módulo y las preguntas asociadas.`
      )
    )
      return;
    startTransition(async () => {
      await deleteAutoModule(module.id);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 flex items-start gap-3 group">
      <div className="w-9 h-9 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-mono text-slate-400 flex-shrink-0">
        {module.order_index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-white">{module.title}</h3>
          {isAuto && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30">
              IA
            </span>
          )}
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
            Dif {module.difficulty_level}
          </span>
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
            {module.estimated_time_minutes} min
          </span>
        </div>
        {module.description && (
          <p className="text-xs text-slate-400 mt-1 line-clamp-2">{module.description}</p>
        )}
        <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            {completedBy} {completedBy === 1 ? 'estudiante completó' : 'estudiantes completaron'}
          </span>
          {(module.prerequisites?.length ?? 0) > 0 && (
            <span>· Requiere {module.prerequisites.length} prereq</span>
          )}
        </div>
      </div>

      {isAuto && (
        <button
          onClick={handleDelete}
          disabled={pending}
          title="Eliminar módulo"
          className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition flex-shrink-0"
        >
          {pending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Trash2 className="w-3.5 h-3.5" />
          )}
        </button>
      )}
    </div>
  );
}
