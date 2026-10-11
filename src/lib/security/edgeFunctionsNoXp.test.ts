import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Las funciones de borde (supabase/functions) se despliegan aparte y NO las revisa el compilador de la app: cuando se
// eliminaron el XP y los niveles (migracion 064) una siguio insertando base_xp_reward y "Generar mapa" fallo en
// produccion con un 500. Esta prueba vigila que ninguna mencione columnas que ya no existen.
const DROPPED = /base_xp_reward|reward_xp|earned_xp|total_xp|current_level|bonus_xp_earned|xp_ledger|weekly_leaderboards/;

function files(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (/\.(ts|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('funciones de borde: sin columnas eliminadas', () => {
  const list = files(path.join(process.cwd(), 'supabase', 'functions'));

  it('hay funciones que revisar', () => expect(list.length).toBeGreaterThan(0));

  it.each(list.map((f) => [path.relative(process.cwd(), f).split(path.sep).join('/'), f]))('%s', (_rel, f) => {
    const src = fs.readFileSync(f, 'utf8');
    const hits = src.split('\n').map((l, i) => (DROPPED.test(l) ? `${i + 1}: ${l.trim()}` : null)).filter(Boolean);
    expect(hits).toEqual([]);
  });

  it('gemini-tutor no usa una variable de nivel que ya no se define', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/gemini-tutor/index.ts'), 'utf8');
    expect(src).not.toContain('${level}');
  });
});
