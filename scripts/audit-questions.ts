// AUDITORIA de las preguntas YA guardadas (SOLO LECTURA: no cambia ningun review_status ni borra nada).
//
// Por que existe: el juez nuevo (criterio de correccion + segunda opinion de otra familia) detecto errores de contenido en preguntas que ya estaban
// aprobadas y llegan a los estudiantes. El juez solo corre sobre las PENDIENTES, asi que lo ya aprobado nunca se vuelve a revisar. Este script lo vuelve a
// juzgar y entrega la lista de las que NO pasan, con el motivo, para que una persona decida (borrar, corregir o conservar).
//
//   npm run audit:questions                          (las aprobadas)
//   npm run audit:questions -- --estados approved,pending,human_review
//   npm run audit:questions -- --modulo <id> --limit 40 --pausa 20
//
// Salida: resumen en pantalla + evals/runs/auditoria-<fecha>.csv y .json (privados, no versionados). El veredicto es de IAs (juez + segunda opinion), no de una
// persona: una lectura manual de aprobadas encontro defectos que el juez dejo pasar, y tambien hay falsos rechazos. Se entrega como LISTA A REVISAR, no como sentencia.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { getRagContext } from '../src/lib/questions/cohereGeneration';
import { judgeQuestionsBatch } from '../src/lib/questions/judge';
import { sharedHealth } from '../src/lib/ai/gateway';

const args = process.argv.slice(2);
const val = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const estados = (val('--estados') ?? 'approved').split(',').map((s) => s.trim()).filter(Boolean);
const soloModulo = val('--modulo');
const limite = Number(val('--limit') ?? Infinity);
const pausa = Number(val('--pausa') ?? 0);

const clip = (x: unknown, n: number) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const csv = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

// Resumen corto de la pregunta para el informe (lo esencial para reconocerla sin abrir la app).
function resumen(q: any): string {
  const detalle = q.game_data ?? q.pairs ?? q.opts ?? q.answers;
  return `${clip(q.q, 160)}${detalle ? ` | ${clip(JSON.stringify(detalle), 220)}` : ''}`;
}

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  let query = supabase
    .from('lesson_questions')
    .select('id, module_id, type, q, opts, ok, answers, pairs, keywords, exp, game_type, game_data, review_status, reviewed_by, is_backup')
    .in('review_status', estados);
  if (soloModulo) query = query.eq('module_id', soloModulo);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const todas = (data ?? []).slice(0, Number.isFinite(limite) ? limite : undefined);
  if (todas.length === 0) return console.log(`No hay preguntas con estado ${estados.join(', ')}.`);

  const porModulo = new Map<string, any[]>();
  for (const q of todas) {
    if (!porModulo.has(q.module_id)) porModulo.set(q.module_id, []);
    porModulo.get(q.module_id)!.push(q);
  }
  const { data: mods } = await supabase.from('content_modules').select('id, title, classroom_id').in('id', Array.from(porModulo.keys()));
  const modInfo = new Map((mods ?? []).map((m: any) => [m.id, m]));
  console.log(`Auditando ${todas.length} preguntas (${estados.join(', ')}) de ${porModulo.size} modulos. SOLO LECTURA.\n`);

  type Fila = { id: string; modulo: string; tipo: string; estado: string; revisor: string; respaldo: boolean; veredicto: string; motivo: string; resumen: string };
  const filas: Fila[] = [];
  let i = 0;
  for (const [moduleId, qs] of Array.from(porModulo.entries())) {
    i++;
    sharedHealth.reset();
    const contexto = await getRagContext(supabase, moduleId);
    const v = await judgeQuestionsBatch(qs, contexto);
    const titulo = String(modInfo.get(moduleId)?.title ?? moduleId);
    let pasan = 0;
    for (const q of qs) {
      const r = v.get(q.id);
      const veredicto = r?.verdict ?? 'sin_veredicto';
      if (veredicto === 'pass') pasan++;
      filas.push({ id: q.id, modulo: titulo, tipo: q.type, estado: q.review_status, revisor: q.reviewed_by ?? 'sin revisar', respaldo: !!q.is_backup, veredicto, motivo: r?.reason ?? '(sin veredicto)', resumen: resumen(q) });
    }
    console.log(`  [${i}/${porModulo.size}] ${titulo.slice(0, 44).padEnd(44)} ${qs.length} preguntas | pasan ${pasan} | no pasan ${qs.length - pasan}`);
    if (pausa > 0) await new Promise((r) => setTimeout(r, pausa * 1000));
  }

  const cuenta = (k: string) => filas.filter((f) => f.veredicto === k).length;
  const noPasan = filas.filter((f) => f.veredicto !== 'pass');
  console.log('\n=== RESUMEN ===');
  console.log(`Preguntas auditadas: ${filas.length}`);
  console.log(`  pasan ........................ ${cuenta('pass')} (${((cuenta('pass') / filas.length) * 100).toFixed(0)} %)`);
  console.log(`  FALLAN (error de contenido) .. ${cuenta('fail')} (${((cuenta('fail') / filas.length) * 100).toFixed(0)} %)`);
  console.log(`  revision humana .............. ${cuenta('review') + cuenta('sin_veredicto')} (${(((cuenta('review') + cuenta('sin_veredicto')) / filas.length) * 100).toFixed(0)} %)`);

  console.log('\nPor quien las reviso (cuantas NO pasan):');
  for (const rev of Array.from(new Set(filas.map((f) => f.revisor)))) {
    const g = filas.filter((f) => f.revisor === rev);
    console.log(`  ${rev.padEnd(14)} ${String(g.length).padStart(4)} auditadas | no pasan ${g.filter((f) => f.veredicto !== 'pass').length}`);
  }
  console.log('\nPor tipo (cuantas NO pasan):');
  for (const t of Array.from(new Set(filas.map((f) => f.tipo)))) {
    const g = filas.filter((f) => f.tipo === t);
    console.log(`  ${t.padEnd(22)} ${String(g.length).padStart(4)} | no pasan ${g.filter((f) => f.veredicto !== 'pass').length}`);
  }

  const dir = path.join(process.cwd(), 'evals', 'runs');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const base = path.join(dir, `auditoria-${stamp}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify({ fecha: new Date().toISOString(), estados, perfil: process.env.AI_PROFILE || 'free', filas }, null, 2));
  const header = 'veredicto,modulo,tipo,estado,revisor,es_respaldo,motivo,pregunta,id';
  fs.writeFileSync(
    `${base}.csv`,
    '﻿' + [header, ...noPasan.sort((a, b) => a.veredicto.localeCompare(b.veredicto)).map((f) => [f.veredicto, f.modulo, f.tipo, f.estado, f.revisor, f.respaldo, f.motivo, f.resumen, f.id].map(csv).join(','))].join('\n'),
  );
  console.log(`\nInforme (las ${noPasan.length} que NO pasan, con motivo): ${path.relative(process.cwd(), base)}.csv  |  completo: .json`);
  console.log('Es una LISTA A REVISAR por una persona, no una sentencia: el veredicto es de IAs y tambien hay falsos rechazos.');
}

main().catch((e) => {
  console.error('FALLO:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
