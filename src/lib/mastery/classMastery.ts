// Dominio de una CLASE para el profesor: por modulo y por objetivo, cuantos estudiantes estan en cada estado y quienes.
// Reutiliza moduleMastery (la regla es identica a la que ve el estudiante). Funciones puras (sin red).
//
// El denominador siempre son los estudiantes INSCRITOS: quien no ha empezado un modulo cuenta como "sin empezar"
// (si no, un modulo que nadie ha tocado parecería "100 % dominado por los que lo intentaron").

import { moduleMastery, objectiveState, rollupMastery, type AttemptLite, type MasteryCounts, type MasteryState } from './mastery';

export interface ClassModuleIn {
  id: string;
  title: string;
  objectiveId: string | null;
}

export interface ClassObjectiveIn {
  id: string;
  title: string;
}

export interface ClassStudentIn {
  id: string;
  name: string;
}

export interface ClassAttempt extends AttemptLite {
  module_id: string;
  student_id: string;
}

export interface StudentRef {
  id: string;
  name: string;
}

export interface ModuleRollup {
  moduleId: string;
  title: string;
  objectiveId: string | null;
  // Estudiantes por estado (total = inscritos).
  counts: MasteryCounts;
  students: Record<MasteryState, StudentRef[]>;
}

export interface MasteryGroup {
  // null = modulos que ningun objetivo agrupa.
  objective: ClassObjectiveIn | null;
  modules: ModuleRollup[];
  // Estudiantes por estado del OBJETIVO (dominado solo si domina todos sus modulos). null en el grupo sin objetivo.
  studentCounts: MasteryCounts | null;
}

export interface ClassMastery {
  students: number;
  // Hay al menos una respuesta de un estudiante inscrito en los modulos de la clase.
  hasData: boolean;
  groups: MasteryGroup[];
  // Donde intervenir: modulos con estudiantes por repasar, los de mas estudiantes primero.
  attention: ModuleRollup[];
}

export const ATTENTION_LIMIT = 5;

const emptyBuckets = (): Record<MasteryState, StudentRef[]> => ({ not_started: [], in_progress: [], mastered: [], needs_review: [] });

export function buildClassMastery(input: {
  modules: ClassModuleIn[];
  objectives: ClassObjectiveIn[];
  students: ClassStudentIn[];
  attempts: ClassAttempt[];
}): ClassMastery {
  const moduleIds = new Set(input.modules.map((m) => m.id));
  const studentIds = new Set(input.students.map((s) => s.id));

  const byKey = new Map<string, AttemptLite[]>();
  let hasData = false;
  for (const a of input.attempts) {
    if (!moduleIds.has(a.module_id) || !studentIds.has(a.student_id)) continue;
    hasData = true;
    const key = `${a.student_id}|${a.module_id}`;
    const item = { question_id: a.question_id, was_correct: a.was_correct, attempted_at: a.attempted_at };
    const list = byKey.get(key);
    if (list) list.push(item);
    else byKey.set(key, [item]);
  }

  // Estado de cada estudiante en cada modulo.
  const stateOf = new Map<string, MasteryState>();
  const rollups: ModuleRollup[] = input.modules.map((m) => {
    const buckets = emptyBuckets();
    for (const s of input.students) {
      const st = moduleMastery(byKey.get(`${s.id}|${m.id}`) ?? []).state;
      stateOf.set(`${s.id}|${m.id}`, st);
      buckets[st].push({ id: s.id, name: s.name });
    }
    return {
      moduleId: m.id,
      title: m.title,
      objectiveId: m.objectiveId,
      counts: rollupMastery(input.students.flatMap((s) => [stateOf.get(`${s.id}|${m.id}`) as MasteryState])),
      students: buckets,
    };
  });

  const groups: MasteryGroup[] = [];
  for (const o of input.objectives) {
    const modules = rollups.filter((r) => r.objectiveId === o.id);
    if (modules.length === 0) continue;
    const perStudent = input.students.map((s) => objectiveState(modules.map((r) => stateOf.get(`${s.id}|${r.moduleId}`) as MasteryState)));
    groups.push({ objective: o, modules, studentCounts: rollupMastery(perStudent) });
  }
  // Modulos sin objetivo (o cuyo objetivo ya no existe) van juntos al final.
  const known = new Set(input.objectives.map((o) => o.id));
  const loose = rollups.filter((r) => !r.objectiveId || !known.has(r.objectiveId));
  if (loose.length > 0) groups.push({ objective: null, modules: loose, studentCounts: null });

  const attention = rollups
    .filter((r) => r.counts.needs_review > 0)
    .sort((a, b) => b.counts.needs_review - a.counts.needs_review || b.counts.needs_review / b.counts.total - a.counts.needs_review / a.counts.total)
    .slice(0, ATTENTION_LIMIT);

  return { students: input.students.length, hasData, groups, attention };
}
