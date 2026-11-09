import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'supabase/migrations');
const code = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

// Supabase activa pg_safeupdate para los roles de la API: un DELETE/UPDATE sin WHERE falla con el error 21000, tambien dentro de una funcion llamada por rpc().
// Las pruebas en SQL corren como administrador y NO lo ven (asi se escapo en 096 y 099).
// Se analiza sentencia por sentencia (separadas por «;»): un DELETE FROM sin WHERE, o un UPDATE ... SET sin WHERE, son el defecto. «DO UPDATE SET» (ON CONFLICT) no cuenta.
export function bareStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((x) => x.trim())
    .filter((x) => {
      if (/\bDELETE\s+FROM\s+[\w."]+/i.test(x) && !/\bWHERE\b/i.test(x)) return true;
      return /\bUPDATE\s+[\w."]+(?:\s+(?:AS\s+)?\w+)?\s+SET\b/i.test(x) && !/\bWHERE\b/i.test(x) && !/DO\s+UPDATE/i.test(x);
    });
}

describe('migracion 101: funciones compatibles con pg_safeupdate', () => {
  const m = code('101_funciones_delete_con_where.sql');
  it('las dos funciones borran con WHERE true', () => {
    expect(m).toContain('DELETE FROM public.question_stats WHERE true;');
    expect(m).toContain('DELETE FROM public.global_benchmarks WHERE true;');
  });
  it('conserva el piso de anonimato y los permisos solo para service_role', () => {
    expect(m).toContain('IF p_min_classes < 3 OR p_min_teachers < 2 OR p_min_attempts < 20 THEN');
    expect(m).toContain('GRANT EXECUTE ON FUNCTION public.recompute_question_stats() TO service_role;');
    expect(m).toContain('GRANT EXECUTE ON FUNCTION public.recompute_global_benchmarks(integer, integer, integer) TO service_role;');
    expect(m).not.toMatch(/GRANT[^;]*(anon|authenticated)/);
  });
  it('el cuerpo de la 101 es igual al de 096/099 salvo el WHERE true (no se cambio la logica)', () => {
    const body = (s: string, name: string) => s.slice(s.indexOf(`FUNCTION public.${name}`), s.indexOf('$f$;', s.indexOf(`FUNCTION public.${name}`) + 40)).replace(/\s+/g, ' ');
    expect(body(m, 'recompute_question_stats').replace(' WHERE true;', ';')).toBe(body(code('096_ai_feedback_events.sql'), 'recompute_question_stats'));
    expect(body(m, 'recompute_global_benchmarks').replace(' WHERE true;', ';')).toBe(body(code('099_global_benchmarks.sql'), 'recompute_global_benchmarks'));
  });
});

describe('guardia: ninguna migracion nueva (101 en adelante) usa DELETE/UPDATE sin WHERE', () => {
  const files = fs.readdirSync(dir).filter((f) => /^\d{3}_/.test(f) && Number(f.slice(0, 3)) >= 101);
  it.each(files)('%s', (f) => {
    expect(bareStatements(code(f))).toEqual([]);
  });
  it('el detector reconoce el defecto de 096 y 099 y no da falsos positivos', () => {
    expect(bareStatements(code('096_ai_feedback_events.sql'))).toHaveLength(1);
    expect(bareStatements(code('099_global_benchmarks.sql'))).toHaveLength(1);
    expect(bareStatements('UPDATE public.t\n SET a = 1\n WHERE id = 2;')).toEqual([]);
    expect(bareStatements('INSERT INTO t VALUES (1) ON CONFLICT (id) DO UPDATE SET a = 2;')).toEqual([]);
    expect(bareStatements('DELETE FROM public.t WHERE true;')).toEqual([]);
    expect(bareStatements('UPDATE public.t SET a = 1;')).toHaveLength(1);
  });
  it('ninguna otra migracion anterior tiene el defecto (solo 096 y 099, ya corregidas por la 101)', () => {
    const old = fs.readdirSync(dir).filter((f) => /^\d{3}_/.test(f) && Number(f.slice(0, 3)) < 101);
    expect(old.filter((f) => bareStatements(code(f)).length > 0).sort()).toEqual(['096_ai_feedback_events.sql', '099_global_benchmarks.sql']);
  });
});
