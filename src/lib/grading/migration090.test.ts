import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'supabase/migrations');
const FILE = '090_move_pg_trgm_pg_net.sql';
const sql = fs.readFileSync(path.join(dir, FILE), 'utf8').replace(/\r\n/g, '\n');
const code = sql.replace(/^--.*$/gm, '');

describe('migracion 090 (pg_trgm y pg_net fuera de public)', () => {
  it('es la siguiente despues de la 089', () => {
    const files = fs.readdirSync(dir).filter((f) => /^\d{3}_/.test(f)).sort();
    expect(files.indexOf(FILE)).toBe(files.indexOf('089_exam_sessions.sql') + 1);
  });
  it('pg_trgm se mueve (reubicable) y pg_net se recrea (no lo es)', () => {
    expect(code).toContain('ALTER EXTENSION pg_trgm SET SCHEMA extensions;');
    expect(code).toContain('DROP EXTENSION IF EXISTS pg_net;');
    expect(code).toContain('CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;');
  });
  it('sin CASCADE (si algo dependiera de pg_net, falla en vez de borrarlo) y sin tocar vector ni datos', () => {
    expect(code).not.toMatch(/CASCADE/i);
    expect(code).not.toMatch(/\b(DELETE|TRUNCATE|UPDATE|INSERT)\b/i);
    expect(code).not.toContain('vector');
  });
  it('crea el esquema antes de usarlo y recarga el cache de PostgREST', () => {
    expect(code.indexOf('CREATE SCHEMA IF NOT EXISTS extensions;')).toBeLessThan(code.indexOf('ALTER EXTENSION pg_trgm'));
    expect(code).toContain("NOTIFY pgrst, 'reload schema';");
  });
  it('nada en el codigo ni en las migraciones anteriores usa similarity()/% de pg_trgm sin calificar', () => {
    const earlier = fs.readdirSync(dir).filter((f) => /^\d{3}_/.test(f) && f < FILE).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    expect(earlier).not.toMatch(/gin_trgm_ops|gist_trgm_ops|word_similarity|[^a-z_]similarity\(/i);
  });
});
