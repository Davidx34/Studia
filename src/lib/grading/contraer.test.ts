import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const h = vi.hoisted(() => ({
  hasKey: true,
  user: { id: 'stu-1' } as { id: string } | null,
  existing: null as { status?: string; started_at?: string } | null,
  upserts: [] as { table: string; row: Record<string, unknown>; opts: unknown }[],
  selects: [] as { table: string; filters: [string, unknown][] }[],
  upsertError: null as { message: string } | null,
  throwOnSelect: false,
  adminCreated: 0,
}));

vi.mock('@/lib/supabase/admin', () => ({
  hasServiceRoleKey: () => h.hasKey,
  createAdminSupabase: () => {
    h.adminCreated++;
    return {
      from: (table: string) => {
        const filters: [string, unknown][] = [];
        const chain: any = {
          select: () => chain,
          eq: (c: string, v: unknown) => (filters.push([c, v]), chain),
          maybeSingle: async () => {
            if (h.throwOnSelect) throw new Error('caida de la base');
            h.selects.push({ table, filters });
            return { data: h.existing };
          },
          upsert: async (row: Record<string, unknown>, opts: unknown) => {
            h.upserts.push({ table, row, opts });
            return { error: h.upsertError };
          },
        };
        return chain;
      },
    };
  },
}));

import { markLessonInProgress } from './progressStart';
import { questionBank } from './bankAccess';

const userClient = () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } });
const AT = new Date('2026-11-01T15:00:00.000Z');

beforeEach(() => {
  h.hasKey = true;
  h.user = { id: 'stu-1' };
  h.existing = null;
  h.upserts = [];
  h.selects = [];
  h.upsertError = null;
  h.throwOnSelect = false;
  h.adminCreated = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('markLessonInProgress: "en progreso" lo marca el servidor', () => {
  it('un modulo nuevo queda "en progreso" con el estudiante de la SESION', async () => {
    await markLessonInProgress(userClient(), 'mod-1', () => AT);
    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0].table).toBe('student_progress');
    expect(h.upserts[0].row).toEqual({
      student_id: 'stu-1',
      module_id: 'mod-1',
      status: 'in_progress',
      completion_percentage: 0,
      started_at: AT.toISOString(),
      last_attempt_at: AT.toISOString(),
    });
    expect(h.upserts[0].opts).toEqual({ onConflict: 'student_id,module_id' });
  });
  it('lee el progreso de ESE estudiante en ESE modulo', async () => {
    await markLessonInProgress(userClient(), 'mod-9', () => AT);
    expect(h.selects[0].table).toBe('student_progress');
    expect(h.selects[0].filters).toEqual([['student_id', 'stu-1'], ['module_id', 'mod-9']]);
  });
  it('conserva la fecha de inicio original', async () => {
    h.existing = { status: 'in_progress', started_at: '2026-10-01T10:00:00.000Z' };
    await markLessonInProgress(userClient(), 'mod-1', () => AT);
    expect(h.upserts[0].row.started_at).toBe('2026-10-01T10:00:00.000Z');
    expect(h.upserts[0].row.last_attempt_at).toBe(AT.toISOString());
  });
  it('un modulo ya COMPLETADO no vuelve a "en progreso" (no se borra que ya lo termino)', async () => {
    h.existing = { status: 'completed', started_at: '2026-10-01T10:00:00.000Z' };
    await markLessonInProgress(userClient(), 'mod-1', () => AT);
    expect(h.upserts).toHaveLength(0);
  });
  it('sin sesion no escribe nada', async () => {
    h.user = null;
    await markLessonInProgress(userClient(), 'mod-1', () => AT);
    expect(h.upserts).toHaveLength(0);
    expect(h.adminCreated).toBe(0);
  });
  it('sin llave de servicio no escribe (el navegador ya no lo hace) y ni siquiera crea el cliente', async () => {
    h.hasKey = false;
    await markLessonInProgress(userClient(), 'mod-1', () => AT);
    expect(h.upserts).toHaveLength(0);
    expect(h.adminCreated).toBe(0);
  });
  it('NUNCA lanza ni retrasa la leccion: error de escritura, de lectura o de sesion', async () => {
    h.upsertError = { message: 'fallo' };
    await expect(markLessonInProgress(userClient(), 'mod-1', () => AT)).resolves.toBeUndefined();
    h.upsertError = null;
    h.throwOnSelect = true;
    await expect(markLessonInProgress(userClient(), 'mod-1', () => AT)).resolves.toBeUndefined();
    h.throwOnSelect = false;
    const roto = { auth: { getUser: async () => { throw new Error('sin red'); } } };
    await expect(markLessonInProgress(roto, 'mod-1', () => AT)).resolves.toBeUndefined();
  });
});

describe('questionBank: el banco de preguntas se lee y escribe con la llave de servicio', () => {
  it('con llave: el cliente de servicio; sin llave: el del usuario', () => {
    const user = { quien: 'usuario' };
    h.hasKey = true;
    expect(questionBank(user)).not.toBe(user);
    expect(h.adminCreated).toBe(1);
    h.hasKey = false;
    expect(questionBank(user)).toBe(user);
  });
});

// ───────────────────────────── cableado (texto del codigo) ─────────────────────────────
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

describe('POST /api/generate-questions: el banco de preguntas solo se abre con la llave de servicio a quien ve el modulo', () => {
  const route = code(read('src/app/api/generate-questions/route.ts'));
  it('el acceso se decide ANTES de leer el banco (el modulo es visible para el usuario por su RLS)', () => {
    expect(route).toContain('moduleVisible = !!modRow;');
    expect(route.indexOf('moduleVisible = !!modRow;')).toBeLessThan(route.indexOf('questionBank(supabase)'));
    expect(route.indexOf('moduleVisible = !!modRow;')).toBeLessThan(route.indexOf(".from('lesson_questions')"));
  });
  it('lectura y escritura del banco usan el cliente de servicio SOLO si el modulo es visible; ya no hay lecturas ni escrituras con el cliente del usuario', () => {
    expect(route.match(/moduleVisible \? questionBank\(supabase\) : supabase/g)).toHaveLength(2);
    expect(route).toMatch(/bank\s*\.from\('lesson_questions'\)\s*\.select\('\*'\)/);
    expect(route).toContain("writer.from('lesson_questions').insert(rows)");
    expect(route).not.toMatch(/\bsupabase\s*\.from\('lesson_questions'\)/);
  });
  it('marca "en progreso" al servir, en el camino del cache y en el de la generacion (no en el repaso)', () => {
    expect(route.match(/markLessonInProgress\(supabase, moduleId\)/g)).toHaveLength(2);
    const remediation = route.slice(route.indexOf('Modo repaso dirigido'), route.indexOf('// 1. Intentar servir del cache'));
    expect(remediation).not.toContain('markLessonInProgress');
    // se marca justo antes de responder con las preguntas servidas
    for (const m of route.matchAll(/markLessonInProgress\(supabase, moduleId\);\s*(?:return NextResponse\.json\(\{ \.\.\.served, cached: (true|false) \}\))/g)) expect(m[1]).toMatch(/true|false/);
  });
  it('la generacion sigue pidiendo acceso (forbidden) antes de gastar IA', () => {
    expect(route).toContain("outcome.status === 'forbidden'");
  });
});

describe('pagina de la leccion', () => {
  const page = read('src/app/(student)/lesson/[id]/page.tsx');
  it('ya no marca "en progreso" desde el navegador', () => {
    expect(code(page)).not.toContain('markInProgress');
    expect(code(page)).not.toMatch(/status:\s*'in_progress'/);
  });
  it('cierra la leccion con closeLesson (que reintenta una vez si el servidor no estuvo disponible: ver saveOutcome.test.ts)', () => {
    expect(page).toContain('closeLesson(attemptIdRef.current, {');
    expect(page).not.toContain('finishLessonOnServer(attemptIdRef.current');
  });
  it('la ruta sin conexion que escribia student_progress desde el navegador ya no existe', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'src/lib/offline/persistOffline.ts'))).toBe(false);
  });
});

// ───────────────────────────── guardian: quien escribe estas tablas ─────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('GUARDIAN: escrituras a student_progress y question_attempts', () => {
  const root = process.cwd();
  const WRITE = /from\(['"](student_progress|question_attempts)['"]\)\s*\.(insert|update|upsert|delete)\(/g;
  // "archivo -> tabla x cantidad de escrituras": una escritura NUEVA (aunque sea en un archivo que ya escribe) cambia el resultado.
  const writes: Record<string, number> = {};
  const clientFiles: string[] = [];
  for (const f of walk(path.join(root, 'src'))) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(root, f).replace(/\\/g, '/');
    for (const m of src.matchAll(WRITE)) writes[`${rel} :: ${m[1]}`] = (writes[`${rel} :: ${m[1]}`] ?? 0) + 1;
    if ([...src.matchAll(WRITE)].length > 0 && /^'use client'|^"use client"/m.test(src)) clientFiles.push(rel);
  }

  it('solo escriben las rutas del SERVIDOR, y cada una con el numero de escrituras esperado', () => {
    expect(writes).toEqual({
      // servidor: registra el intento tras calificar
      'src/app/api/lesson/answer/route.ts :: question_attempts': 1,
      // servidor: "en progreso"
      'src/lib/grading/progressStart.ts :: student_progress': 1,
    });
  });
  it('NINGUN archivo del navegador escribe esas tablas (desde la migracion 086 el estudiante solo las lee)', () => {
    expect(clientFiles).toEqual([]);
  });
});
