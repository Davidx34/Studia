// SOLO LECTURA: compara, con datos reales, el veredicto del servidor (checkLegacyAccess) con el estado del mapa (buildNodes) para cada (estudiante matriculado, modulo). Uso: npx tsx --env-file=.env.local scripts/check-gate-consistency.ts
import { createClient } from '@supabase/supabase-js';
import { checkLegacyAccess } from '../src/lib/blueprint/legacyGate';
import { buildNodes } from '../src/lib/map/mapSections';

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: enr } = await admin.from('class_enrollments').select('student_id, classroom_id');
  const { data: mods } = await admin.from('content_modules').select('id, classroom_id, title, category, difficulty_level, order_index, map_position_x, map_position_y, prerequisites, is_active').eq('is_active', true);
  const { data: plans } = await admin.from('course_blueprints').select('classroom_id').eq('status', 'published');
  const planned = new Set((plans ?? []).map((p: any) => p.classroom_id));
  const summary = { pairs: 0, withPrereq: 0, gateDeny: 0, mapLocked: 0, inconsistent: 0 };
  const incons: string[] = [];
  const students = Array.from(new Set((enr ?? []).map((e: any) => e.student_id)));
  for (const sid of students) {
    const classes = (enr ?? []).filter((e: any) => e.student_id === sid).map((e: any) => e.classroom_id);
    const myMods = (mods ?? []).filter((m: any) => classes.includes(m.classroom_id));
    const { data: prog } = await admin.from('student_progress').select('module_id, status, best_score, completion_percentage').eq('student_id', sid);
    const nodes = buildNodes(myMods as any, (prog ?? []) as any);
    for (const m of myMods as any[]) {
      summary.pairs++;
      if (!(m.prerequisites ?? []).length) continue;
      summary.withPrereq++;
      const gate = await checkLegacyAccess({ db: admin, admin, userId: sid, moduleId: m.id });
      const node = nodes.find((n) => n.node.id === m.id)!.node;
      if (!gate.allowed) summary.gateDeny++;
      if (node.status === 'locked') summary.mapLocked++;
      // Inconsistencia: el mapa deja abrir (available / in_progress / completed) pero el servidor niega.
      if (!gate.allowed && node.status !== 'locked') {
        summary.inconsistent++;
        incons.push(`${String(sid).slice(0, 6)} ${m.title.slice(0, 30)} mapa=${node.status} plan=${planned.has(m.classroom_id)}`);
      }
      // O al reves: el mapa bloquea y el servidor deja pasar.
      if (gate.allowed && node.status === 'locked') incons.push(`REVES ${String(sid).slice(0, 6)} ${m.title.slice(0, 30)}`);
    }
  }
  console.log(JSON.stringify(summary));
  console.log(incons.slice(0, 25).join('\n'));
}
main().catch((e) => { console.error(e); process.exit(1); });
