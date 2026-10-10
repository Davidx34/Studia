import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const noComments = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('--')).join('\n');

// Recorre src/ buscando archivos de codigo (sin pruebas).
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|database\.generated/.test(e.name)) out.push(p);
  }
  return out;
}

// Columnas de la economia: solo las escriben las funciones del servidor (migraciones 052 y 053).
const ECONOMY = ['total_xp', 'coins', 'current_hearts', 'current_level', 'last_heart_lost_at', 'streak_days', 'max_hearts'];

describe('la economia del juego la escribe el servidor', () => {
  it('ningun codigo del navegador ni acciones hacen UPDATE de las columnas de la economia en profiles', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(process.cwd(), 'src'))) {
      const src = noComments(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
      // .from('profiles') ... .update({ ...columna... })  (hasta 300 caracteres entre ambos)
      const re = /from\(\s*['"]profiles['"]\s*\)[\s\S]{0,300}?\.update\(\s*\{([\s\S]*?)\}\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        if (ECONOMY.some((c) => new RegExp(`\\b${c}\\b`).test(m![1]))) offenders.push(path.relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('la leccion y los planes de repaso otorgan XP por las funciones del servidor', () => {
    const lesson = read('src/app/(student)/lesson/[id]/page.tsx');
    expect(lesson).toContain("rpc('award_xp_module'");
    expect(lesson).toContain("rpc('award_xp_remediation'");
    expect(read('src/lib/actions/remediation-plans.ts')).toContain("rpc('award_xp_plan_round'");
  });

  it('el XP no depende de lo que mande el cliente: las funciones no reciben cantidades', () => {
    const sql = noComments(read('supabase/migrations/052_economy_server_side.sql'));
    for (const fn of ['award_xp_module', 'award_xp_remediation', 'award_xp_plan_round']) {
      const sig = sql.match(new RegExp(`FUNCTION public\\.${fn}\\(([^)]*)\\)`))![1];
      expect(sig).not.toMatch(/\bxp\b|amount|coins/i);
    }
  });

  it('cada premio es idempotente (UNIQUE) y la funcion interna no es llamable por el cliente', () => {
    const sql = noComments(read('supabase/migrations/052_economy_server_side.sql'));
    expect(sql).toContain('UNIQUE (user_id, source, ref)');
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\._grant_xp\([^)]*\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON public\.xp_ledger FROM anon, authenticated/);
  });

  it('la 053 retira el UPDATE de profiles y solo devuelve columnas de preferencias', () => {
    const sql = noComments(read('supabase/migrations/053_profiles_economy_readonly.sql'));
    expect(sql).toContain('REVOKE UPDATE ON public.profiles FROM anon, authenticated');
    const granted = sql.match(/GRANT UPDATE \(([^)]*)\)/)![1];
    for (const c of [...ECONOMY, 'role', 'email', 'id']) expect(granted).not.toMatch(new RegExp(`\\b${c}\\b`));
  });
});
