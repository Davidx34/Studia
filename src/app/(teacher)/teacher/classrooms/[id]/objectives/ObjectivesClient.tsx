'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Target,
  Plus,
  Loader2,
  AlertCircle,
  Trash2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Pencil,
  Rocket,
  FileText,
  Clock,
} from 'lucide-react';
import {
  createLearningObjective,
  updateLearningObjective,
  deleteLearningObjective,
  updateModuleObjectiveConfig,
  regenerateModuleQuestionPool,
} from '@/lib/actions/learning-objectives';

interface Objective {
  id: string;
  title: string;
  description: string | null;
  expected_duration_weeks: number;
  difficulty_level: number;
}

interface ModuleRow {
  id: string;
  title: string;
  order_index: number;
  auto_generated: boolean;
  learning_objective_id: string | null;
  order_in_objective: number | null;
  minigame_types: string[] | null;
  configured_question_count: number | null;
  source_material_ids: string[] | null;
}

interface MaterialSummary {
  id: string;
  display_name: string | null;
  filename: string;
  processing_status: string;
}

const MINIGAME_LABELS: Record<string, string> = {
  el_descifrador: '🔤 El Descifrador',
  linea_del_tiempo: '📅 Línea del Tiempo',
  categorias_rapidas: '⏱️ Categorías Rápidas',
  flashcard_rapida: '🃏 Flashcard Rápida',
  impostor_cognitivo: '🕵️ El Impostor Cognitivo',
  alquimia_conceptual: '⚗️ Alquimia Conceptual',
  cuarto_crisis: '🚨 Cuarto de Crisis',
  juicio_conocimiento: '⚖️ El Juicio al Conocimiento',
};

export default function ObjectivesClient({
  classroomId,
  objectives,
  modules,
  materials,
}: {
  classroomId: string;
  objectives: Objective[];
  modules: ModuleRow[];
  materials: MaterialSummary[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(objectives[0]?.id ?? null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; title: string } | null>(null);

  const unassignedModules = modules.filter((m) => !m.learning_objective_id);
  const readyForBulk = modules.filter((m) => (m.source_material_ids?.length ?? 0) > 0);

  async function handleBulkGenerate() {
    if (
      !confirm(
        `¿Generar preguntas para los ${readyForBulk.length} módulos que ya tienen material vinculado? Esto reemplaza el pool de preguntas de cada uno.`
      )
    )
      return;
    setBulkRunning(true);
    setError(null);
    for (let i = 0; i < readyForBulk.length; i++) {
      const m = readyForBulk[i];
      setBulkProgress({ current: i + 1, total: readyForBulk.length, title: m.title });
      const result = await regenerateModuleQuestionPool(m.id, classroomId);
      if (!result.ok) {
        setError(`Falló en "${m.title}": ${result.error ?? 'error desconocido'}`);
      }
    }
    setBulkProgress(null);
    setBulkRunning(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 flex items-start gap-4 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
          <Target className="w-5 h-5 text-violet-300" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-white">Objetivos de aprendizaje</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Agrupa módulos bajo una meta mayor y configura cuántas preguntas y qué
            minijuegos usa cada uno. Esto es opcional: los módulos sin objetivo
            siguen funcionando como siempre.
          </p>
        </div>
        <div className="flex gap-2">
          {readyForBulk.length > 0 && (
            <button
              onClick={handleBulkGenerate}
              disabled={bulkRunning}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50 transition"
            >
              {bulkRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
              Generar todos los módulos listos ({readyForBulk.length})
            </button>
          )}
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-violet-500 hover:bg-violet-600 text-white transition"
          >
            <Plus className="w-4 h-4" />
            Nuevo objetivo
          </button>
        </div>
      </div>

      {bulkProgress && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-200">
          Generando módulo {bulkProgress.current}/{bulkProgress.total}: {bulkProgress.title}...
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 flex items-start gap-2 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {creating && (
        <ObjectiveForm
          classroomId={classroomId}
          onCancel={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            router.refresh();
          }}
          onError={setError}
        />
      )}

      {objectives.length === 0 && !creating ? (
        <div className="text-center py-12 rounded-2xl bg-slate-900/30 border border-slate-800 border-dashed">
          <p className="text-sm text-slate-500">Aún no hay objetivos de aprendizaje en esta clase.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {objectives.map((obj) => (
            <ObjectiveCard
              key={obj.id}
              objective={obj}
              classroomId={classroomId}
              modules={modules.filter((m) => m.learning_objective_id === obj.id)}
              unassignedModules={unassignedModules}
              materials={materials}
              expanded={expandedId === obj.id}
              onToggle={() => setExpandedId(expandedId === obj.id ? null : obj.id)}
              onError={setError}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ObjectiveForm({
  classroomId,
  objective,
  onCancel,
  onSaved,
  onError,
}: {
  classroomId: string;
  objective?: Objective;
  onCancel: () => void;
  onSaved: () => void;
  onError: (e: string | null) => void;
}) {
  const [title, setTitle] = useState(objective?.title ?? '');
  const [description, setDescription] = useState(objective?.description ?? '');
  const [duration, setDuration] = useState(objective?.expected_duration_weeks ?? 4);
  const [difficulty, setDifficulty] = useState(objective?.difficulty_level ?? 5);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    onError(null);
    startTransition(async () => {
      const result = objective
        ? await updateLearningObjective(objective.id, classroomId, {
            title,
            description,
            expectedDurationWeeks: duration,
            difficultyLevel: difficulty,
          })
        : await createLearningObjective(classroomId, {
            title,
            description,
            expectedDurationWeeks: duration,
            difficultyLevel: difficulty,
          });
      if (!result.ok) {
        onError(result.error ?? 'Error al guardar.');
        return;
      }
      onSaved();
    });
  }

  return (
    <div className="rounded-xl bg-slate-900 border border-violet-500/30 p-4 space-y-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título del objetivo (ej: Dominar la Revolución Industrial)"
        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Descripción (opcional)"
        rows={2}
        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 resize-none"
      />
      <div className="flex gap-4 flex-wrap">
        <label className="text-xs text-slate-400 flex items-center gap-2">
          Duración estimada (semanas)
          <input
            type="number"
            min={1}
            max={52}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-16 px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white"
          />
        </label>
        <label className="text-xs text-slate-400 flex items-center gap-2">
          Dificultad (1-10)
          <input
            type="number"
            min={1}
            max={10}
            value={difficulty}
            onChange={(e) => setDifficulty(Number(e.target.value))}
            className="w-16 px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white"
          />
        </label>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          disabled={pending}
          className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-white transition"
        >
          Cancelar
        </button>
        <button
          onClick={handleSave}
          disabled={pending || !title.trim()}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-violet-500 hover:bg-violet-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Guardar
        </button>
      </div>
    </div>
  );
}

function ObjectiveCard({
  objective,
  classroomId,
  modules,
  unassignedModules,
  materials,
  expanded,
  onToggle,
  onError,
}: {
  objective: Objective;
  classroomId: string;
  modules: ModuleRow[];
  unassignedModules: ModuleRow[];
  materials: MaterialSummary[];
  expanded: boolean;
  onToggle: () => void;
  onError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [assignId, setAssignId] = useState('');

  function handleDelete() {
    if (!confirm(`¿Borrar el objetivo "${objective.title}"? Los módulos vinculados quedarán sin objetivo (no se borran).`))
      return;
    startTransition(async () => {
      const result = await deleteLearningObjective(objective.id, classroomId);
      if (!result.ok) {
        onError(result.error ?? 'Error al borrar.');
        return;
      }
      router.refresh();
    });
  }

  function handleAssign() {
    if (!assignId) return;
    startTransition(async () => {
      const result = await updateModuleObjectiveConfig(assignId, classroomId, {
        learningObjectiveId: objective.id,
        orderInObjective: modules.length,
      });
      if (!result.ok) {
        onError(result.error ?? 'Error al asignar módulo.');
        return;
      }
      setAssignId('');
      router.refresh();
    });
  }

  if (editing) {
    return (
      <ObjectiveForm
        classroomId={classroomId}
        objective={objective}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          router.refresh();
        }}
        onError={onError}
      />
    );
  }

  return (
    <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-slate-800/40 transition"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-white">{objective.title}</h3>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
              {modules.length} {modules.length === 1 ? 'módulo' : 'módulos'}
            </span>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
              Dif {objective.difficulty_level}
            </span>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
              {objective.expected_duration_weeks} sem
            </span>
          </div>
          {objective.description && (
            <p className="text-xs text-slate-400 mt-1 line-clamp-2">{objective.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="p-2 rounded-lg text-slate-500 hover:text-violet-300 hover:bg-violet-500/10 transition"
          >
            <Pencil className="w-3.5 h-3.5" />
          </span>
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
            className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition"
          >
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-500 mt-2" /> : <ChevronDown className="w-4 h-4 text-slate-500 mt-2" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-800 p-4 space-y-3">
          {modules.length === 0 ? (
            <p className="text-xs text-slate-500">No hay módulos asignados a este objetivo todavía.</p>
          ) : (
            modules
              .sort((a, b) => (a.order_in_objective ?? 0) - (b.order_in_objective ?? 0))
              .map((m) => (
                <ModuleConfigRow key={m.id} module={m} classroomId={classroomId} materials={materials} onError={onError} />
              ))
          )}

          {unassignedModules.length > 0 && (
            <div className="flex items-center gap-2 pt-2">
              <select
                value={assignId}
                onChange={(e) => setAssignId(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-violet-500"
              >
                <option value="">Asignar módulo existente...</option>
                {unassignedModules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAssign}
                disabled={!assignId || pending}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-500/15 text-violet-300 border border-violet-500/30 hover:bg-violet-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                Asignar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModuleConfigRow({
  module,
  classroomId,
  materials,
  onError,
}: {
  module: ModuleRow;
  classroomId: string;
  materials: MaterialSummary[];
  onError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [questionCount, setQuestionCount] = useState(module.configured_question_count ?? 10);
  const [minigameTypes, setMinigameTypes] = useState<string[]>(module.minigame_types ?? []);
  const [materialIds, setMaterialIds] = useState<string[]>(module.source_material_ids ?? []);
  const [savePending, startSave] = useTransition();
  const [regenPending, startRegen] = useTransition();
  const [regenResult, setRegenResult] = useState<string | null>(null);

  const hasMaterial = materialIds.length > 0;

  function toggleMinigame(type: string) {
    setMinigameTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }

  function toggleMaterial(id: string) {
    setMaterialIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  function handleSaveConfig() {
    onError(null);
    startSave(async () => {
      const result = await updateModuleObjectiveConfig(module.id, classroomId, {
        learningObjectiveId: module.learning_objective_id,
        orderInObjective: module.order_in_objective,
        minigameTypes,
        configuredQuestionCount: questionCount,
        materialIds,
      });
      if (!result.ok) onError(result.error ?? 'Error al guardar configuración.');
      else router.refresh();
    });
  }

  function handleUnassign() {
    if (!confirm(`¿Quitar "${module.title}" de este objetivo? El módulo seguirá existiendo, solo sin agrupar.`)) return;
    onError(null);
    startSave(async () => {
      const result = await updateModuleObjectiveConfig(module.id, classroomId, { learningObjectiveId: null });
      if (!result.ok) {
        onError(result.error ?? 'Error al quitar módulo.');
        return;
      }
      router.refresh();
    });
  }

  function handleRegenerate() {
    if (
      !confirm(
        `¿Regenerar el pool de preguntas de "${module.title}"? Esto BORRARÁ las preguntas actuales del módulo (activas y de reserva) y generará ${questionCount} activas + ${questionCount} de reserva nuevas.`
      )
    )
      return;
    setRegenResult(null);
    onError(null);
    startRegen(async () => {
      const result = await regenerateModuleQuestionPool(module.id, classroomId);
      if (!result.ok) {
        onError(result.error ?? 'Error al regenerar preguntas.');
        return;
      }
      setRegenResult(`Listo: ${result.active} activas + ${result.backup} de reserva.`);
    });
  }

  return (
    <div className="rounded-lg bg-slate-800/50 border border-slate-700 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="text-sm font-medium text-white">{module.title}</h4>
          {hasMaterial ? (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              ✓ Con material
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
              <Clock className="w-2.5 h-2.5" /> Esperando material
            </span>
          )}
        </div>
        <button
          onClick={handleUnassign}
          disabled={savePending}
          className="text-xs text-slate-500 hover:text-red-400 transition"
        >
          Quitar del objetivo
        </button>
      </div>

      <div>
        <p className="text-xs text-slate-500 mb-1.5">
          Material vinculado (sube el archivo/link/YouTube en la pestaña "Materiales" primero)
        </p>
        {materials.length === 0 ? (
          <p className="text-xs text-slate-600 italic">Aún no hay materiales subidos a esta clase.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
            {materials.map((mat) => (
              <button
                key={mat.id}
                type="button"
                onClick={() => toggleMaterial(mat.id)}
                title={mat.processing_status !== 'completed' ? `Estado: ${mat.processing_status}` : undefined}
                className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition ${
                  materialIds.includes(mat.id)
                    ? 'bg-violet-500/20 border-violet-500/50 text-violet-200'
                    : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
                }`}
              >
                <FileText className="w-3 h-3" />
                {mat.display_name ?? mat.filename}
                {mat.processing_status !== 'completed' && ' ⚠'}
              </button>
            ))}
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-400">
        Preguntas activas por sesión
        <input
          type="range"
          min={5}
          max={15}
          value={questionCount}
          onChange={(e) => setQuestionCount(Number(e.target.value))}
          className="flex-1 accent-violet-500"
        />
        <span className="w-6 text-center text-white font-mono">{questionCount}</span>
      </label>

      <div>
        <p className="text-xs text-slate-500 mb-1.5">Minijuegos permitidos (además de los tipos base de la clase)</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(MINIGAME_LABELS).map(([type, label]) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleMinigame(type)}
              className={`text-xs px-2 py-1 rounded-lg border transition ${
                minigameTypes.includes(type)
                  ? 'bg-violet-500/20 border-violet-500/50 text-violet-200'
                  : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {regenResult && <p className="text-xs text-emerald-300">{regenResult}</p>}

      <div className="flex gap-2 justify-end">
        <button
          onClick={handleSaveConfig}
          disabled={savePending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-50 transition"
        >
          {savePending && <Loader2 className="w-3 h-3 animate-spin" />}
          Guardar config
        </button>
        <button
          onClick={handleRegenerate}
          disabled={regenPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-500 hover:bg-violet-600 text-white disabled:opacity-50 transition"
        >
          {regenPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          Regenerar pool de preguntas
        </button>
      </div>
    </div>
  );
}
