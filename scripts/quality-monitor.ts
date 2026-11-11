// Corre el monitor de regresion sobre todas las clases reales (excluye [CARGA]) y muestra sus alertas. SOLO LEE la base.
//   npx tsx --env-file=.env.local scripts/quality-monitor.ts [--guardar]
// Con --guardar escribe memoria-calidad/monitor/<fecha>.json con SOLO numeros (sin contenido de preguntas ni nombres de clase), para ver la tendencia en el tiempo.
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { loadMonitorReport } from '../src/lib/aiLearning/monitorLoader';

const guardar = process.argv.includes('--guardar');

async function main() {
  const db: any = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: classes } = await db.from('classrooms').select('id, name');
  const reales = (classes ?? []).filter((c: any) => !String(c.name ?? '').startsWith('[CARGA]'));
  const salida: any[] = [];
  for (const [i, c] of reales.entries()) {
    const r = await loadMonitorReport(db, c.id);
    if (!r) {
      console.log(`${String(c.name).slice(0, 34).padEnd(34)} (no se pudo leer)`);
      continue;
    }
    const w = r.watch;
    console.log(`${String(c.name).slice(0, 34).padEnd(34)} cuaderno: ${w ? `v${w.version} ${w.level} (antes ${w.before.good}/${w.before.n}, despues ${w.after.good}/${w.after.n})` : 'sin cuaderno activo'} | alertas: ${r.alerts.map((a) => a.id).join(', ') || 'ninguna'}`);
    salida.push({ clase: `clase-${i + 1}`, cuaderno: w ? { version: w.version, nivel: w.level, antes: { buenas: w.before.good, n: w.before.n }, despues: { buenas: w.after.good, n: w.after.n }, diff: w.comparison.diff, ic95: w.comparison.diffCi } : null, alertas: r.alerts.map((a) => a.id) });
  }
  if (guardar) {
    const dir = path.join(process.cwd(), 'memoria-calidad', 'monitor');
    fs.mkdirSync(dir, { recursive: true });
    const fecha = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(dir, `${fecha}.json`), JSON.stringify({ fecha: new Date().toISOString(), clases: salida }, null, 2) + '\n');
    console.log(`Guardado: memoria-calidad/monitor/${fecha}.json`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
