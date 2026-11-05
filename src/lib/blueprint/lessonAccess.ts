// ¿Puede ESTE estudiante abrir la leccion de ESTE modulo? Regla «100 % para avanzar» (courseGate) aplicada al servir las preguntas de la leccion: sin preguntas no hay leccion, y sin leccion no
// hay intento que registrar, asi que este es el punto que el navegador no puede saltarse.
//
// Solo se bloquea a un ESTUDIANTE MATRICULADO de la clase del modulo: un profesor (o quien no esta matriculado) abre las lecciones como siempre. Cualquier falla al leer (la base, el plan, los
// intentos) NO bloquea: se registra y se deja pasar; un estudiante no debe quedar fuera por un problema de infraestructura.

import { lessonGate, type Gate } from './courseGate';
import { checkLegacyAccess } from './legacyGate';
import { loadCourseData, type CourseData } from './studentData';

type Load = (args: { db: any; admin: any | null; classroomId: string; studentId: string }) => Promise<CourseData>;

type Legacy = (args: { db: any; admin: any | null; userId: string; moduleId: string }) => Promise<Gate>;

export async function checkLessonAccess(args: { db: any; admin: any | null; userId: string; classroomId: string; moduleId: string }, load: Load = loadCourseData, legacy: Legacy = checkLegacyAccess): Promise<Gate> {
  try {
    const { data: enrollment, error } = await args.db.from('class_enrollments').select('id').eq('classroom_id', args.classroomId).eq('student_id', args.userId).maybeSingle();
    if (error) {
      console.error('[LESSON_GATE_ERROR] matricula', { moduleId: args.moduleId, error: String(error.message ?? '').slice(0, 120) });
      return { allowed: true };
    }
    if (!enrollment) return { allowed: true };
    const data = await load({ db: args.db, admin: args.admin, classroomId: args.classroomId, studentId: args.userId });
    // Sin plan publicado (o un modulo que el plan no enlaza): rige la misma regla con los prerrequisitos del mapa.
    if (data.status === 'noPlan') return await legacy({ db: args.db, admin: args.admin, userId: args.userId, moduleId: args.moduleId });
    if (data.status !== 'ok') return { allowed: true };
    if (!data.links.some((l) => l.moduleId === args.moduleId)) return await legacy({ db: args.db, admin: args.admin, userId: args.userId, moduleId: args.moduleId });
    if (!data.scoresAvailable) console.error('[LESSON_GATE_DEGRADED] no se pudieron leer los intentos; no se bloquea', { moduleId: args.moduleId });
    return lessonGate(data, args.moduleId);
  } catch (e) {
    console.error('[LESSON_GATE_ERROR]', { moduleId: args.moduleId, error: e instanceof Error ? e.message.slice(0, 120) : 'desconocido' });
    return { allowed: true };
  }
}
