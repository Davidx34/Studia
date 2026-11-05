// MIDE (SOLO LECTURA) cuantas preguntas guardadas en lesson_questions deja de servir el validador actual (isValidQuestion), por tipo y por motivo.
// No escribe nada. Uso: npx tsx --env-file=.env.local scripts/measure-validity.ts
import { createClient } from '@supabase/supabase-js';
import { isValidQuestion } from '../src/lib/lesson/validateQuestion';
import { rowToQuestion } from '../src/lib/questions/poolServing';

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('lesson_questions').select('*').neq('review_status', 'rejected').range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const byType: Record<string, { total: number; invalid: number }> = {};
  const reasons: Record<string, number> = {};
  const samples: Record<string, string[]> = {};
  for (const r of rows) {
    const v: any = isValidQuestion(rowToQuestion(r));
    const t = (byType[r.type] ??= { total: 0, invalid: 0 });
    t.total++;
    if (!v.valid) {
      t.invalid++;
      const why = String(v.reason ?? v.error ?? 'sin motivo').slice(0, 90);
      reasons[why] = (reasons[why] ?? 0) + 1;
      (samples[why] ??= []).length < 2 && samples[why].push(String(r.q).replace(/\s+/g, ' ').slice(0, 110));
    }
  }
  const byMod: Record<string, { total: number; valid: number }> = {};
  for (const r of rows) {
    const m = (byMod[r.module_id] ??= { total: 0, valid: 0 });
    m.total++;
    if ((isValidQuestion(rowToQuestion(r)) as any).valid) m.valid++;
  }
  const mods = Object.entries(byMod);
  console.log(`Modulos con banco: ${mods.length}; con menos de 5 validas tras el validador: ${mods.filter(([, m]) => m.valid < 5).length}; con 0: ${mods.filter(([, m]) => m.valid === 0).length}`);
  console.log('Modulos que PIERDEN (total -> validas):', mods.filter(([, m]) => m.valid < m.total).map(([id, m]) => `${id.slice(0, 8)} ${m.total}->${m.valid}`).join(', '));
  const inv = Object.values(byType).reduce((a, b) => a + b.invalid, 0);
  console.log(`No rechazadas: ${rows.length}; el validador actual NO deja servir: ${inv} (${((inv / Math.max(1, rows.length)) * 100).toFixed(1)} %)`);
  console.table(byType);
  console.log('Motivos (mas frecuentes):');
  for (const [k, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${n}  ${k}\n      ej: ${samples[k].join(' || ')}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
