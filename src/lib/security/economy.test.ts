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

// Columnas de la economia (monedas, corazones, racha): solo las escriben las funciones del servidor (migraciones 052 y 053).
// El XP y los niveles se eliminaron por completo (migracion 064).
const ECONOMY = ['coins', 'current_hearts', 'last_heart_lost_at', 'streak_days', 'max_hearts'];

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

  it('la 053 retira el UPDATE de profiles y solo devuelve columnas de preferencias', () => {
    const sql = noComments(read('supabase/migrations/053_profiles_economy_readonly.sql'));
    expect(sql).toContain('REVOKE UPDATE ON public.profiles FROM anon, authenticated');
    const granted = sql.match(/GRANT UPDATE \(([^)]*)\)/)![1];
    for (const c of [...ECONOMY, 'role', 'email', 'id']) expect(granted).not.toMatch(new RegExp(`\\b${c}\\b`));
  });
});

describe('el XP y los niveles ya no existen', () => {
  const XP = /\bxp\b|xp_|_xp|[a-z]XP|\bXP[A-Z_]|\bXP\b|current_level|total_xp|LevelUp/;

  it('ningun archivo de la app los menciona', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(process.cwd(), 'src'))) {
      const rel = path.relative(process.cwd(), file).split(path.sep).join('/');
      // La palabra "exp" (explicacion) y el nombre de sonido 'levelUp' no son XP.
      const lines = noComments(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
        .split('\n')
        .filter((l) => !/'levelUp'/.test(l));
      lines.forEach((l, i) => {
        if (XP.test(l)) offenders.push(`${rel}:${i + 1}: ${l.trim().slice(0, 80)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('la leccion ya no llama a funciones de XP', () => {
    const lesson = read('src/app/(student)/lesson/[id]/page.tsx');
    expect(lesson).not.toMatch(/award_xp|XP ganados|earned_xp/);
  });
});
