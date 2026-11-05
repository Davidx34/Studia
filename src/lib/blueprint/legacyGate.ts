// «100 % para avanzar» en clases SIN plan publicado (o con un modulo que el plan no enlaza): el servidor tambien niega la leccion si algun prerrequisito del modulo (content_modules.prerequisites,
// los mismos que dibuja el mapa) no esta al 100 %. Es la regla de `buildNodes` (mapa) llevada al servidor: sin esto el bloqueo era solo visual y se saltaba abriendo la URL.
//
// Un modulo que el estudiante ya empezo (student_progress en curso o completado) NO se bloquea: coincide con el mapa. Dominado = una leccion TERMINADA con 100 % (lesson_attempts) O student_progress.best_score >= 100 (lo que escribe finish_lesson y el progreso anterior al servidor). Cualquier falla al leer
// NO bloquea (igual que courseGate): se registra y se deja pasar.

import type { Gate } from './courseGate';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const prerequisiteIds = (raw: unknown): string[] => (Array.isArray(raw) ? Array.from(new Set(raw.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))) : []);

// Puro: de los prerrequisitos y los dominados sale el veredicto.
export function legacyGate(prereqs: string[], mastered: ReadonlySet<string>, titles: ReadonlyMap<string, string> = new Map()): Gate {
  const missing = prereqs.filter((p) => !mastered.has(p));
  if (missing.length === 0) return { allowed: true };
  const names = missing.map((m) => titles.get(m)).filter((t): t is string => !!t);
  const what = names.length > 0 ? `«${names.join('», «')}»` : missing.length === 1 ? 'el módulo anterior' : 'los módulos anteriores';
  return { allowed: false, message: `Todavía no puedes abrir esta lección. Primero domina ${what} al 100 %.` };
}

// Lee prerrequisitos y lo dominado. `db` = sesion del estudiante (RLS); `admin` = llave de servicio (lesson_attempts y student_progress del estudiante, siempre filtrado por el).
export async function checkLegacyAccess(args: { db: any; admin: any | null; userId: string; moduleId: string }): Promise<Gate> {
  const OPEN: Gate = { allowed: true };
  try {
    const { data: mod, error } = await args.db.from('content_modules').select('prerequisites').eq('id', args.moduleId).maybeSingle();
    if (error) {
      console.error('[LESSON_GATE_ERROR] prerrequisitos', { moduleId: args.moduleId, error: String(error.message ?? '').slice(0, 120) });
      return OPEN;
    }
    const prereqs = prerequisiteIds(mod?.prerequisites).filter((p) => p !== args.moduleId);
    if (prereqs.length === 0) return OPEN;
    if (!args.admin) {
      console.error('[LESSON_GATE_DEGRADED] sin llave de servicio; no se bloquea', { moduleId: args.moduleId });
      return OPEN;
    }
    const [att, prog] = await Promise.all([
      args.admin.from('lesson_attempts').select('module_id, score_percent').eq('student_id', args.userId).eq('status', 'finished').in('module_id', prereqs),
      args.admin.from('student_progress').select('module_id, status, best_score').eq('student_id', args.userId).in('module_id', [args.moduleId, ...prereqs]),
    ]);
    if (att.error || prog.error) {
      console.error('[LESSON_GATE_ERROR] dominio', { moduleId: args.moduleId, error: String((att.error ?? prog.error).message ?? '').slice(0, 120) });
      return OPEN;
    }
    const progress = (prog.data ?? []) as { module_id: string; status: string | null; best_score: number | string | null }[];
    // Lo que el estudiante YA empezo o termino no se bloquea (igual que el mapa: «en curso» / «completado» siguen abiertos). No abre un hueco: student_progress solo lo escribe el servidor
    // (migracion 086) cuando la leccion se sirvio, es decir, despues de pasar esta misma puerta; lo anterior a la regla es avance legitimo que no se le quita.
    if (progress.some((r) => r.module_id === args.moduleId && (r.status === 'in_progress' || r.status === 'completed'))) return OPEN;
    const mastered = new Set<string>();
    for (const r of (att.data ?? []) as { module_id: string; score_percent: number | string | null }[]) if (Number(r.score_percent) >= 100) mastered.add(r.module_id);
    for (const r of progress) if (Number(r.best_score) >= 100) mastered.add(r.module_id);
    const gate = legacyGate(prereqs, mastered);
    if (gate.allowed) return gate;
    const { data: titleRows } = await args.db.from('content_modules').select('id, title').in('id', prereqs.filter((p) => !mastered.has(p)));
    const titles = new Map<string, string>(((titleRows ?? []) as { id: string; title: string | null }[]).filter((t) => t.title).map((t) => [t.id, t.title as string]));
    return legacyGate(prereqs, mastered, titles);
  } catch (e) {
    console.error('[LESSON_GATE_ERROR] legado', { moduleId: args.moduleId, error: e instanceof Error ? e.message.slice(0, 120) : 'desconocido' });
    return OPEN;
  }
}
