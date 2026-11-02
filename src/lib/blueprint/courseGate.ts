// La regla «100 % para avanzar» (decision 2B del dueño), aplicada en el SERVIDOR. Codigo puro: de lo que el estudiante ya hizo (CourseData) sale si puede abrir una leccion o una evaluacion.
//
// Reglas:
//   - Solo se bloquea lo que el PLAN PUBLICADO ordena: un modulo que no esta enlazado en el plan, o una clase sin plan publicado, no se toca (la app funciona como siempre).
//   - Un modulo se abre si es el que le toca o ya lo domino; los siguientes esperan al 100 % del anterior (y, entre cortes, a la evaluacion del corte). Es la misma cuenta del recorrido
//     (buildCourseView), asi que lo que la pantalla dice «Bloqueado» es lo que el servidor niega.
//   - Solo cuentan los intentos TERMINADOS y registrados por el servidor (lesson_attempts / exam_attempts): el progreso viejo que el navegador se escribia no sirve de prueba.
//   - Si no se pueden leer los intentos (scoresAvailable = false, p. ej. sin llave de servicio), NO se bloquea: no se castiga al estudiante por una falla de infraestructura (se registra).

import type { CourseData } from './studentData';
import { buildCourseView, type CourseView } from './studentView';

type CourseOk = Extract<CourseData, { status: 'ok' }>;

export type Gate = { allowed: true } | { allowed: false; message: string };
const OPEN: Gate = { allowed: true };

const viewOf = (d: CourseOk): CourseView => buildCourseView({ plan: d.plan, links: d.links, moduleAttempts: d.moduleAttempts, periodExamAttempts: d.periodExamAttempts, finalExamAttempts: d.finalExamAttempts });

// ¿Puede abrir la leccion del modulo REAL `moduleId`?
export function lessonGate(d: CourseOk, moduleId: string): Gate {
  if (!d.scoresAvailable) return OPEN;
  const view = viewOf(d);
  const mod = view.periods.flatMap((p) => p.modules).find((m) => m.moduleId === moduleId);
  if (!mod || mod.state !== 'locked') return OPEN;
  return { allowed: false, message: `Todavía no puedes abrir esta lección. ${view.next.text}` };
}

// ¿Puede empezar la evaluacion de un corte o la final?
export function examGate(d: CourseOk, exam: { kind: 'period'; periodId: string } | { kind: 'final' }): Gate {
  if (!d.scoresAvailable) return OPEN;
  const view = viewOf(d);
  if (exam.kind === 'period') {
    const p = view.periods.find((x) => x.id === exam.periodId);
    if (!p || p.exam.state !== 'locked') return OPEN;
    return { allowed: false, message: `Primero domina todos los módulos de «${p.name}». ${view.next.text}` };
  }
  if (view.finalExam.state !== 'locked') return OPEN;
  return { allowed: false, message: `Primero termina todos los cortes y sus evaluaciones. ${view.next.text}` };
}
