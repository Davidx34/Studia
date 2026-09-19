import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// La IA se simula: cada llamada devuelve tantas preguntas validas como se pidieron.
const cohereCalls: number[] = [];
vi.mock('@/lib/questions/cohereGeneration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/questions/cohereGeneration')>()),
  getRagContext: vi.fn(async () => 'contexto del material'),
  normalizeGeneratedQuestion: (q: any) => q,
  callCohere: vi.fn(async (_prompt: string, count: number) => {
    cohereCalls.push(count);
    return Array.from({ length: count }, (_, i) => ({
      type: 'multiple_choice',
      q: `Pregunta generada ${cohereCalls.length}-${i}`,
      opts: ['A. uno', 'B. dos', 'C. tres', 'D. cuatro'],
      ok: 0,
      exp: 'explicacion',
      concept_tag: 'concepto',
    }));
  }),
}));
vi.mock('@/lib/questions/conceptTaxonomy', () => ({
  getOrCreateModuleConcepts: vi.fn(async () => []),
  conceptTaxonomyPromptBlock: () => '',
}));

import { regenerateModulePool } from './regeneratePool';
import { MAX_MINIGAMES_PER_BATCH } from './minigameCatalog';

// Supabase simulado con lo justo que usa regenerateModulePool. Registra borrados e inserciones.
function fakeSupabase(existing: { is_backup: boolean; review_status: string }[], configured = 10) {
  const log = { deletes: 0, inserted: [] as any[] };
  const supabase = {
    from(table: string) {
      if (table === 'content_modules') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: 'm1', classroom_id: 'c1', title: 'Modulo', description: null, minigame_types: null, configured_question_count: configured },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'classroom_ai_config') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      }
      // lesson_questions
      return {
        select: () => ({ eq: async () => ({ data: existing, error: null }) }),
        delete: () => ({
          eq: async () => {
            log.deletes++;
            return { error: null };
          },
        }),
        insert: async (rows: any[]) => {
          log.inserted.push(...rows);
          return { error: null };
        },
      };
    },
  };
  return { supabase, log };
}

beforeEach(() => {
  cohereCalls.length = 0;
  process.env.COHERE_API_KEY = 'test';
});

describe("regenerateModulePool en modo 'fill'", () => {
  it('modulo vacio: genera las activas y la reserva completas, sin borrar nada', async () => {
    const { supabase, log } = fakeSupabase([]);
    const r = await regenerateModulePool(supabase, 'm1', { mode: 'fill' });
    // La tanda activa trae las 10 clasicas MAS los minijuegos que la clase permite.
    expect(r).toMatchObject({ ok: true, active: 10 + MAX_MINIGAMES_PER_BATCH, backup: 10 });
    expect(log.deletes).toBe(0);
    expect(log.inserted).toHaveLength(20 + MAX_MINIGAMES_PER_BATCH);
    expect(log.inserted.filter((x) => x.is_backup)).toHaveLength(10);
  });

  it('REGRESION: no borra el pool existente (el modo replace si lo hace)', async () => {
    const existing = Array.from({ length: 4 }, () => ({ is_backup: false, review_status: 'approved' }));
    const { supabase, log } = fakeSupabase(existing);
    await regenerateModulePool(supabase, 'm1', { mode: 'fill' });
    expect(log.deletes).toBe(0);

    const replace = fakeSupabase(existing);
    await regenerateModulePool(replace.supabase, 'm1', { mode: 'replace' });
    expect(replace.log.deletes).toBe(1);
  });

  it('solo genera lo que falta (sin sumar minijuegos de mas al reponer unas pocas)', async () => {
    const existing = [
      ...Array.from({ length: 7 }, () => ({ is_backup: false, review_status: 'approved' })),
      ...Array.from({ length: 10 }, () => ({ is_backup: true, review_status: 'approved' })),
    ];
    const { supabase, log } = fakeSupabase(existing);
    const r = await regenerateModulePool(supabase, 'm1', { mode: 'fill' });
    expect(r).toMatchObject({ ok: true, active: 3, backup: 0 });
    expect(log.inserted).toHaveLength(3);
    expect(log.inserted.every((x) => x.is_backup === false)).toBe(true);
  });

  it('las rechazadas no cuentan: se reponen', async () => {
    const existing = [
      ...Array.from({ length: 10 }, () => ({ is_backup: false, review_status: 'approved' })),
      ...Array.from({ length: 10 }, () => ({ is_backup: true, review_status: 'approved' })),
      { is_backup: false, review_status: 'rejected' },
    ];
    const { supabase } = fakeSupabase(existing);
    const r = await regenerateModulePool(supabase, 'm1', { mode: 'fill' });
    expect(r).toMatchObject({ ok: true, skipped: true });
  });

  it('pool completo: no llama a la IA ni escribe nada', async () => {
    const existing = [
      ...Array.from({ length: 10 }, () => ({ is_backup: false, review_status: 'approved' })),
      ...Array.from({ length: 10 }, () => ({ is_backup: true, review_status: 'pending' })),
    ];
    const { supabase, log } = fakeSupabase(existing);
    const r = await regenerateModulePool(supabase, 'm1', { mode: 'fill' });
    expect(r).toEqual({ ok: true, active: 0, backup: 0, skipped: true });
    expect(cohereCalls).toEqual([]);
    expect(log.inserted).toEqual([]);
    expect(log.deletes).toBe(0);
  });

  it('respeta configured_question_count del modulo', async () => {
    const { supabase, log } = fakeSupabase([], 6);
    const r = await regenerateModulePool(supabase, 'm1', { mode: 'fill' });
    expect(r).toMatchObject({ active: 6 + MAX_MINIGAMES_PER_BATCH, backup: 6 });
    expect(log.inserted).toHaveLength(12 + MAX_MINIGAMES_PER_BATCH);
  });

  it('el backup_pool_size cuenta la reserva que ya existia', async () => {
    const existing = Array.from({ length: 4 }, () => ({ is_backup: true, review_status: 'approved' }));
    const { supabase, log } = fakeSupabase([...existing, ...Array.from({ length: 10 }, () => ({ is_backup: false, review_status: 'approved' }))]);
    await regenerateModulePool(supabase, 'm1', { mode: 'fill' });
    expect(log.inserted.every((x) => x.backup_pool_size === 10)).toBe(true);
  });
});

const read = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(new RegExp(String.fromCharCode(13) + String.fromCharCode(10), 'g'), String.fromCharCode(10));

describe('cableado en la interfaz del profesor', () => {
  const client = read('src/app/(teacher)/teacher/classrooms/[id]/objectives/ObjectivesClient.tsx');

  it('"Generar lo que falta" usa el modo que NO borra, no el que reemplaza', () => {
    const fn = client.slice(client.indexOf('async function handleFillMissing'), client.indexOf('async function handleRunJudge'));
    expect(fn).toContain('fillModuleQuestionPool(');
    expect(fn).not.toContain('regenerateModuleQuestionPool(');
  });

  it('un modulo que falla no detiene a los demas y se informa al final', () => {
    expect(client).toMatch(/catch \(e\)[\s\S]*failures\.push/);
    expect(client).toContain('setFailed(failures)');
  });
});
