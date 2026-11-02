// Carga lo que la vista del estudiante necesita. Los clientes van INYECTADOS (sin red) para poder probarlo:
//   - `db`   = cliente con la SESION del estudiante: la RLS decide que ve (solo el plan PUBLICADO de una clase donde esta matriculado, sus enlaces y los modulos que de verdad le tocan).
//   - `admin`= cliente de servicio, solo para leer los intentos de lecciones (lesson_attempts no tiene ningun permiso para el navegador). SIEMPRE se filtra por el estudiante de la sesion.
// Un enlace a un modulo que el estudiante no ve (inactivo o ajeno) no cuenta: el modulo del plan queda "pendiente de contenido".

import { parseBlueprint } from './parse';
import type { Link } from './links';
import type { Blueprint } from './types';

export type CourseData =
  | { status: 'noPlan' }
  | { status: 'unreadable' }
  | {
      status: 'ok';
      plan: Blueprint;
      version: number;
      links: Link[];
      // Titulos de los modulos reales visibles (para la pantalla).
      realTitles: Map<string, string>;
      moduleAttempts: Map<string, number[]>;
      periodExamAttempts: Map<string, number[]>;
      finalExamAttempts: number[];
      // false = no se pudieron leer los intentos de las lecciones (sin llave de servicio): se muestran los modulos pero sin notas.
      scoresAvailable: boolean;
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validScore = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;

export async function loadCourseData(args: { db: any; admin: any | null; classroomId: string; studentId: string }): Promise<CourseData> {
  const { db, admin, classroomId, studentId } = args;

  const { data: bps, error: bpErr } = await db.from('course_blueprints').select('id, version, doc').eq('classroom_id', classroomId).eq('status', 'published').limit(1);
  if (bpErr || !bps || bps.length === 0) return { status: 'noPlan' };
  const parsed = parseBlueprint(bps[0].doc);
  if (!parsed.ok) return { status: 'unreadable' };

  const { data: linkRows } = await db.from('blueprint_module_links').select('node_id, content_module_id').eq('blueprint_id', bps[0].id);
  const rawLinks: Link[] = ((linkRows ?? []) as { node_id: string; content_module_id: string }[]).map((r) => ({ nodeId: r.node_id, moduleId: r.content_module_id }));

  // Solo cuentan los modulos que el estudiante VE (la RLS filtra) y que estan activos.
  const ids = Array.from(new Set(rawLinks.map((l) => l.moduleId))).filter((x) => UUID_RE.test(x));
  const realTitles = new Map<string, string>();
  if (ids.length > 0) {
    const { data: mods } = await db.from('content_modules').select('id, title, is_active').eq('classroom_id', classroomId).in('id', ids);
    for (const m of (mods ?? []) as { id: string; title: string | null; is_active: boolean | null }[]) if (m.is_active !== false) realTitles.set(m.id, m.title ?? '');
  }
  const links = rawLinks.filter((l) => realTitles.has(l.moduleId));

  // Intentos de las lecciones TERMINADAS del estudiante, solo de los modulos enlazados.
  const moduleAttempts = new Map<string, number[]>();
  let scoresAvailable = false;
  if (admin && links.length > 0) {
    const { data: rows, error } = await admin
      .from('lesson_attempts')
      .select('module_id, score_percent, finished_at')
      .eq('student_id', studentId)
      .eq('status', 'finished')
      .in('module_id', Array.from(realTitles.keys()))
      .order('finished_at', { ascending: true });
    if (!error) {
      scoresAvailable = true;
      for (const r of (rows ?? []) as { module_id: string; score_percent: number | null }[]) {
        if (!validScore(r.score_percent)) continue;
        const list = moduleAttempts.get(r.module_id) ?? [];
        list.push(r.score_percent);
        moduleAttempts.set(r.module_id, list);
      }
    }
  } else if (links.length === 0) {
    scoresAvailable = true; // nada que leer
  }

  // Evaluaciones (tabla de la 085; el estudiante lee las SUYAS por RLS). Hoy la app aun no las toma: lo normal es que no haya ninguna.
  const periodExamAttempts = new Map<string, number[]>();
  const finalExamAttempts: number[] = [];
  const { data: exams } = await db.from('exam_attempts').select('kind, period_id, score_percent, attempt_number').eq('blueprint_id', bps[0].id).eq('student_id', studentId).order('attempt_number', { ascending: true });
  for (const e of (exams ?? []) as { kind: string; period_id: string | null; score_percent: number | string | null }[]) {
    const s = typeof e.score_percent === 'string' ? Number(e.score_percent) : e.score_percent;
    if (!validScore(s)) continue;
    if (e.kind === 'final') finalExamAttempts.push(s);
    else if (e.kind === 'period' && e.period_id) periodExamAttempts.set(e.period_id, [...(periodExamAttempts.get(e.period_id) ?? []), s]);
  }

  return { status: 'ok', plan: parsed.blueprint, version: bps[0].version, links, realTitles, moduleAttempts, periodExamAttempts, finalExamAttempts, scoresAvailable };
}
