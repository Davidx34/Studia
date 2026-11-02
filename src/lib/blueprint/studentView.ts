// Lo que VE el estudiante de su recorrido por el plan del curso (solo lectura). Codigo puro: recibe el plan publicado, los enlaces a modulos reales y los puntajes ya calificados en el
// servidor, y devuelve el modelo de la pantalla con las reglas que ya fijo el dueño (progress.ts): avance por dominio (100 % para pasar), nota del modulo = promedio de sus intentos,
// corte = 70 % modulos + 30 % evaluacion y nota del curso ponderada.
//
// Un modulo del plan SIN enlace a un modulo real esta "pendiente de contenido": no tiene intentos y por la regla del 100 % bloquea lo que sigue, igual que un modulo sin dominar.
// Esta vista NO bloquea nada en la app (el mapa actual sigue como esta): solo muestra el recorrido y lo que viene.

import { courseGrade, courseProgress, finalExamResult, finalExamWeight, moduleScore, periodResultOf, type Attempts, type PeriodResult } from './progress';
import { planModules, type Link } from './links';
import type { Blueprint } from './types';

export type ModuleState = 'pendingContent' | 'locked' | 'available' | 'mastered';

export interface ModuleView {
  nodeId: string;
  title: string;
  objectiveTitle: string;
  // El modulo real enlazado (null = pendiente de contenido): es a donde lleva «Abrir».
  moduleId: string | null;
  state: ModuleState;
  // Nota del modulo: promedio de todos sus intentos (null si aun no tiene).
  score: number | null;
  attempts: number;
}

export type ExamState = 'locked' | 'available' | 'mastered';

export interface PeriodView {
  id: string;
  name: string;
  weight: number;
  modules: ModuleView[];
  // Evaluacion del corte: la app todavia NO permite tomarla; se muestra su estado en el recorrido y su nota si ya existe.
  exam: { state: ExamState; score: number | null; attempts: number };
  result: PeriodResult;
}

export interface CourseView {
  periods: PeriodView[];
  finalExam: { state: ExamState; score: number | null; attempts: number; weight: number };
  grade: ReturnType<typeof courseGrade>;
  // Lo siguiente que le toca (texto listo para mostrar).
  next: { kind: 'module' | 'periodExam' | 'finalExam' | 'done' | 'empty'; text: string; nodeId?: string; periodId?: string };
  totals: { modules: number; mastered: number; pendingContent: number };
}

export interface StudentInput {
  plan: Blueprint;
  links: readonly Link[];
  // Puntajes (0-100) de los intentos TERMINADOS de cada modulo REAL, por id del modulo real.
  moduleAttempts: ReadonlyMap<string, readonly number[]>;
  // Intentos de la evaluacion de cada corte (por id de corte) y de la evaluacion final.
  periodExamAttempts?: ReadonlyMap<string, readonly number[]>;
  finalExamAttempts?: readonly number[];
}

export function buildCourseView(input: StudentInput): CourseView {
  const { plan } = input;
  const realOf = new Map(input.links.map((l) => [l.nodeId, l.moduleId]));

  // Los intentos de cada modulo del PLAN: los de su modulo real enlazado (ninguno si esta pendiente de contenido).
  const byNode = new Map<string, readonly number[]>();
  for (const m of planModules(plan)) {
    const real = realOf.get(m.nodeId);
    byNode.set(m.nodeId, real ? input.moduleAttempts.get(real) ?? [] : []);
  }

  const progress = courseProgress(plan, { modules: byNode as Attempts, exams: input.periodExamAttempts, final: input.finalExamAttempts });
  const periods = plan.periods.slice().sort((a, b) => a.order - b.order);

  let mastered = 0;
  let pending = 0;
  const periodViews: PeriodView[] = periods.map((p) => {
    const modules: ModuleView[] = [];
    for (const o of p.objectives) {
      for (const m of o.modules.slice().sort((a, b) => a.order - b.order)) {
        const real = realOf.get(m.id) ?? null;
        const attempts = byNode.get(m.id) ?? [];
        const isMastered = progress.masteredModules.has(m.id);
        const isAvailable = progress.availableModules.has(m.id);
        // Estado: dominado > pendiente de contenido > abierto (el que le toca o ya hecho) > bloqueado.
        const state: ModuleState = isMastered ? 'mastered' : real === null ? 'pendingContent' : isAvailable ? 'available' : 'locked';
        if (isMastered) mastered++;
        if (real === null) pending++;
        modules.push({ nodeId: m.id, title: m.title, objectiveTitle: o.title, moduleId: real, state, score: moduleScore(attempts), attempts: attempts.length });
      }
    }
    const examAttempts = input.periodExamAttempts?.get(p.id);
    const examState: ExamState = progress.masteredExams.has(p.id) ? 'mastered' : progress.availableExams.has(p.id) ? 'available' : 'locked';
    return {
      id: p.id,
      name: p.name,
      weight: p.weight,
      modules,
      exam: { state: examState, score: moduleScore(examAttempts), attempts: (examAttempts ?? []).length },
      result: periodResultOf(p, byNode as Attempts, examAttempts),
    };
  });

  const finalRes = finalExamResult(input.finalExamAttempts);
  const results = new Map(periodViews.map((v) => [v.id, v.result]));
  const grade = courseGrade(periods, results, finalRes);

  return {
    periods: periodViews,
    finalExam: { state: progress.finalExam, score: finalRes.score, attempts: finalRes.attempts, weight: finalExamWeight(periods) },
    grade,
    next: describeNext(plan, progress.next, periodViews, realOf),
    totals: { modules: periodViews.reduce((s, p) => s + p.modules.length, 0), mastered, pendingContent: pending },
  };
}

function describeNext(plan: Blueprint, next: ReturnType<typeof courseProgress>['next'], periods: PeriodView[], realOf: Map<string, string>): CourseView['next'] {
  if (periods.every((p) => p.modules.length === 0)) return { kind: 'empty', text: 'Este plan todavía no tiene módulos.' };
  if (next.type === 'module') {
    const m = periods.flatMap((p) => p.modules).find((x) => x.nodeId === next.moduleId);
    if (!m) return { kind: 'empty', text: 'Este plan todavía no tiene módulos.' };
    return realOf.has(m.nodeId)
      ? { kind: 'module', text: `Sigue: «${m.title}». Necesitas 100 % para pasar al siguiente módulo.`, nodeId: m.nodeId, periodId: next.periodId }
      : { kind: 'module', text: `Sigue: «${m.title}», pero tu profesor todavía no ha preparado su contenido.`, nodeId: m.nodeId, periodId: next.periodId };
  }
  if (next.type === 'periodExam') {
    const p = plan.periods.find((x) => x.id === next.periodId);
    return { kind: 'periodExam', text: `Ya dominas los módulos de «${p?.name ?? 'este corte'}»: sigue su evaluación (todavía no está disponible en la app).`, periodId: next.periodId };
  }
  if (next.type === 'finalExam') return { kind: 'finalExam', text: 'Terminaste todos los cortes: sigue la evaluación final (todavía no está disponible en la app).' };
  return { kind: 'done', text: '¡Completaste el curso!' };
}

