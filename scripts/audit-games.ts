// AUDITORIA de las preguntas y minijuegos YA guardados con la AUTO-CALIFICACION de JEV (src/lib/jev/selfGrade.ts). SOLO LECTURA: no cambia ni borra nada.
//
// Simula la jugada perfecta de cada pregunta con los calificadores REALES del servidor y lista las que no se pueden resolver o son ambiguas (una opcion repetida, dos
// impostores, categorias que no existen...). Sirve para saber, antes de probar los juegos en un navegador, si un fallo es del codigo o de DATOS mal generados.
//
//   npm run audit:games
//   npm run audit:games -- --solo-servibles          (ignora las rechazadas)
//
// Salida: resumen en pantalla + evals/runs/auditoria-juegos-<fecha>.json (privado, no versionado). Nunca imprime llaves ni el contenido completo de una pregunta.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { selfGrade, type SelfGradeResult } from '../src/lib/jev/selfGrade';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log('Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en .env.local.');
  process.exit(2);
}
const soloServibles = process.argv.includes('--solo-servibles');
const db = createClient(url, key, { auth: { persistSession: false } });

const clip = (x: unknown, n: number) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

interface Row {
  id: string;
  module_id: string;
  type: string;
  q: unknown;
  opts: unknown;
  ok: unknown;
  answers: unknown;
  pairs: unknown;
  keywords: unknown;
  game_data: unknown;
  review_status: string | null;
  is_backup: boolean | null;
}

async function loadAll(): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('lesson_questions')
      .select('id, module_id, type, q, opts, ok, answers, pairs, keywords, game_data, review_status, is_backup')
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error('No se pudo leer lesson_questions: ' + error.message);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  const rows = await loadAll();
  // Lo que se le sirve a un estudiante: todo lo que NO esta rechazado.
  const servible = (r: Row) => r.review_status !== 'rejected';
  const target = soloServibles ? rows.filter(servible) : rows;

  const results = target.map((r) => ({ row: r, res: selfGrade(r as any) as SelfGradeResult }));

  console.log(`Preguntas leidas: ${rows.length} | auditadas: ${target.length}${soloServibles ? ' (solo servibles)' : ''}`);
  const byType = new Map<string, { n: number; fail: number; warn: number; skip: number; failServ: number; nServ: number }>();
  for (const { row, res } of results) {
    const t = byType.get(row.type) ?? { n: 0, fail: 0, warn: 0, skip: 0, failServ: 0, nServ: 0 };
    t.n++;
    if (servible(row)) t.nServ++;
    if (res.status === 'fail') {
      t.fail++;
      if (servible(row)) t.failServ++;
    }
    if (res.status === 'skip') t.skip++;
    if (res.warnings.length > 0) t.warn++;
    byType.set(row.type, t);
  }
  console.log('\ntipo                     total  servibles  FALLAN  (de servibles)  con aviso  sin auditar');
  for (const [t, v] of Array.from(byType).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`${t.padEnd(24)} ${String(v.n).padStart(5)}  ${String(v.nServ).padStart(9)}  ${String(v.fail).padStart(6)}  ${String(v.failServ).padStart(14)}  ${String(v.warn).padStart(9)}  ${String(v.skip).padStart(11)}`);
  }

  const failing = results.filter(({ res }) => res.status === 'fail');
  const failingServ = failing.filter(({ row }) => servible(row));
  console.log(`\nFALLAN: ${failing.length} (${failingServ.length} de ellas se sirven a estudiantes hoy)`);
  const show = failingServ.slice(0, 40);
  for (const { row, res } of show) {
    console.log(`  - ${row.id.slice(0, 8)} [${row.type}] ${row.review_status}${row.is_backup ? '/respaldo' : ''} «${clip(row.q ?? (row.game_data as any)?.case_file ?? (row.game_data as any)?.context, 50)}» -> ${res.failures.slice(0, 2).join(' | ')}`);
  }
  if (failingServ.length > show.length) console.log(`  ... y ${failingServ.length - show.length} mas (ver el archivo)`);

  // Razones mas frecuentes.
  const reasons = new Map<string, number>();
  for (const { res } of failingServ) for (const f of res.failures) reasons.set(f.replace(/«[^»]*»/g, '«…»').replace(/\d+/g, 'N'), (reasons.get(f.replace(/«[^»]*»/g, '«…»').replace(/\d+/g, 'N')) ?? 0) + 1);
  console.log('\nRazones mas frecuentes (servibles):');
  for (const [r, n] of Array.from(reasons).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(3)} x ${r}`);

  const dir = path.join(process.cwd(), 'evals', 'runs');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(dir, `auditoria-juegos-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(failing.map(({ row, res }) => ({ id: row.id, module_id: row.module_id, type: row.type, review_status: row.review_status, is_backup: row.is_backup, failures: res.failures, warnings: res.warnings })), null, 2));
  console.log(`\nDetalle de los que fallan: ${path.relative(process.cwd(), file)} (privado)`);
}

main().catch((e) => {
  console.log('Error:', e instanceof Error ? e.message : 'desconocido');
  process.exit(1);
});
