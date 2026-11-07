import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(process.cwd(), 'src/app/api/dev/ai-learning/route.ts'), 'utf8');

describe('/api/dev/ai-learning', () => {
  it('exige la sesion del panel en GET y en POST, antes de tocar la base', () => {
    const guards = src.match(/requireDevSession\(\)/g) ?? [];
    expect(guards).toHaveLength(2);
    for (const fn of ['export async function GET', 'export async function POST']) {
      const body = src.slice(src.indexOf(fn));
      expect(body.slice(0, 200)).toContain('requireDevSession()');
    }
  });
  it('solo acepta la accion recompute y llama a recompute_question_stats', () => {
    expect(src).toContain("body?.action !== 'recompute'");
    expect(src).toContain("rpc('recompute_question_stats')");
  });
  it('solo devuelve conteos: no selecciona contenido de preguntas ni de eventos', () => {
    expect(src).not.toMatch(/select\('(?!\*'|computed_at')[^']*(reason|question_text|q\b|answer)/);
    expect(src).toContain("{ count: 'exact', head: true }");
  });
});
