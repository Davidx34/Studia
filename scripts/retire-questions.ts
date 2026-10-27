// RETIRA de circulacion las preguntas que una auditoria (npm run audit:questions) marco como FALLAN. REVERSIBLE: antes de escribir guarda los valores
// anteriores de cada fila, y --revertir los restaura.
//
//   npm run retire:questions                              (SIMULACRO: no escribe nada; muestra que haria)
//   npm run retire:questions -- --aplicar                 (retira las que fallan en la ultima auditoria)
//   npm run retire:questions -- --auditoria <archivo.json> --aplicar
//   npm run retire:questions -- --revertir evals/runs/retiro-<fecha>.json
//
// "Retirar" = lo mismo que hace el juez con un `fail`: review_status = 'rejected' e is_backup = true (una rechazada no se sirve jamas). NO borra filas: los
// intentos de los estudiantes (question_attempts) siguen apuntando a ellas. Solo se tocan las que SIGUEN en 'approved' (si alguien las cambio desde la
// auditoria, se respeta). Se retiran unicamente las de veredicto `fail`, no las de revision humana.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const val = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const aplicar = args.includes('--aplicar');
const revertir = val('--revertir');

const dir = path.join(process.cwd(), 'evals', 'runs');
const chunks = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  if (revertir) {
    const copia = JSON.parse(fs.readFileSync(revertir, 'utf8')) as { filas: { id: string; antes: Record<string, unknown> }[] };
    console.log(`Revirtiendo ${copia.filas.length} preguntas desde ${revertir}${aplicar ? '' : '  (SIMULACRO: agrega --aplicar para escribir)'}`);
    let ok = 0;
    for (const f of copia.filas) {
      if (!aplicar) { ok++; continue; }
      // Solo si siguen como las dejo el retiro (rejected): no se pisa un cambio posterior de una persona.
      const { data, error } = await supabase.from('lesson_questions').update(f.antes).eq('id', f.id).eq('review_status', 'rejected').select('id');
      if (error) throw new Error(error.message);
      if (data?.length) ok++;
    }
    console.log(`${aplicar ? 'Restauradas' : 'Se restaurarian'}: ${ok} de ${copia.filas.length}`);
    return;
  }

  const auditoria = val('--auditoria') ?? path.join(dir, fs.readdirSync(dir).filter((x) => /^auditoria-.*\.json$/.test(x)).sort().pop()!);
  const aud = JSON.parse(fs.readFileSync(auditoria, 'utf8')) as { fecha: string; filas: { id: string; veredicto: string; motivo: string; modulo: string }[] };
  const fallan = aud.filas.filter((f) => f.veredicto === 'fail');
  console.log(`Auditoria: ${path.relative(process.cwd(), auditoria)} (${aud.fecha.slice(0, 10)}) | veredicto fail: ${fallan.length}`);

  // Estado ACTUAL: solo se retira lo que sigue aprobado.
  const actuales: any[] = [];
  for (const grupo of chunks(fallan.map((f) => f.id), 50)) {
    const { data, error } = await supabase.from('lesson_questions').select('id, module_id, review_status, is_backup, reviewed_by, reviewed_at, review_reason').in('id', grupo);
    if (error) throw new Error(error.message);
    actuales.push(...(data ?? []));
  }
  const porId = new Map(actuales.map((r) => [r.id, r]));
  const retirar = fallan.filter((f) => porId.get(f.id)?.review_status === 'approved');
  const omitidas = fallan.filter((f) => porId.get(f.id)?.review_status !== 'approved');
  console.log(`Siguen aprobadas (se retiran): ${retirar.length} | ya no estan aprobadas o no existen (se omiten): ${omitidas.length}`);
  const porModulo = new Map<string, number>();
  for (const f of retirar) porModulo.set(f.modulo, (porModulo.get(f.modulo) ?? 0) + 1);
  for (const [m, n] of Array.from(porModulo.entries()).sort()) console.log(`  ${String(n).padStart(3)}  ${m.slice(0, 60)}`);

  if (!aplicar) {
    console.log('\nSIMULACRO: no se escribio nada. Para retirarlas: npm run retire:questions -- --aplicar');
    return;
  }

  // 1) COPIA DE SEGURIDAD antes de tocar nada.
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const copiaPath = path.join(dir, `retiro-${stamp}.json`);
  const copia = {
    fecha: new Date().toISOString(),
    auditoria: path.basename(auditoria),
    filas: retirar.map((f) => {
      const r = porId.get(f.id)!;
      return { id: f.id, modulo: f.modulo, module_id: r.module_id, motivo: f.motivo, antes: { review_status: r.review_status, is_backup: r.is_backup, reviewed_by: r.reviewed_by, reviewed_at: r.reviewed_at, review_reason: r.review_reason } };
    }),
  };
  fs.writeFileSync(copiaPath, JSON.stringify(copia, null, 2));
  console.log(`\nCopia de seguridad: ${path.relative(process.cwd(), copiaPath)}`);

  // 2) Retiro, con la misma convencion que el juez (migracion 044).
  const ahora = new Date().toISOString();
  let hechas = 0;
  for (const grupo of chunks(retirar, 8)) {
    await Promise.all(
      grupo.map(async (f) => {
        const { data, error } = await supabase
          .from('lesson_questions')
          .update({ review_status: 'rejected', is_backup: true, reviewed_by: 'ai_judge', reviewed_at: ahora, review_reason: `Auditoria ${aud.fecha.slice(0, 10)}: ${f.motivo}`.slice(0, 500) })
          .eq('id', f.id)
          .eq('review_status', 'approved') // por si cambio entre la lectura y la escritura
          .select('id');
        if (error) throw new Error(`${f.id}: ${error.message}`);
        if (data?.length) hechas++;
      }),
    );
  }
  console.log(`Retiradas: ${hechas} de ${retirar.length}`);
  console.log(`Para revertir: npm run retire:questions -- --revertir ${path.relative(process.cwd(), copiaPath)} --aplicar`);
}

main().catch((e) => {
  console.error('FALLO:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
