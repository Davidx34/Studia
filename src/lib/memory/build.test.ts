import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildWarning, claimMemory, hashChunks, runMemoryBuild } from './build';
import { NO_MEMORY, groupConcepts, headline, isStale, type MemorySummary } from './panelState';
import { normalizeKey } from './text';
import type { Concept } from './types';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

// ─────────────── una base en memoria con la parte de la API de Supabase que usa la construccion ───────────────
type Row = Record<string, any>;
function fakeAdmin(db: Record<string, Row[]>) {
  return {
    from(table: string) {
      db[table] = db[table] ?? [];
      const filters: [string, any][] = [];
      let mode: 'select' | 'update' = 'select';
      let payload: Row = {};
      const matches = () => db[table].filter((r) => filters.every(([c, v]) => r[c] === v));
      const api: any = {
        select: () => api,
        order: () => api,
        limit: () => api,
        eq: (c: string, v: any) => (filters.push([c, v]), api),
        update: (p: Row) => ((mode = 'update'), (payload = p), api),
        maybeSingle: async () => ({ data: matches()[0] ?? null }),
        insert: async (p: Row) => {
          if (table === 'class_memory' && db[table].some((r) => r.classroom_id === p.classroom_id)) return { error: { message: 'duplicate' } };
          db[table].push({ version: 0, ...p });
          return { error: null };
        },
        upsert: async (p: Row) => {
          const i = db[table].findIndex((r) => r.material_id === p.material_id);
          if (i >= 0) db[table][i] = { ...db[table][i], ...p };
          else db[table].push(p);
          return { error: null };
        },
        then: (resolve: (v: any) => void) => {
          const rows = matches();
          if (mode === 'update') rows.forEach((r) => Object.assign(r, payload));
          resolve({ data: rows.map((r) => ({ ...r })), error: null });
        },
      };
      return api;
    },
  };
}

const TEXT = 'La utilidad marginal es la satisfacción adicional que da consumir una unidad más de un bien. La restricción presupuestal limita el gasto del consumidor según su ingreso y los precios. ';
const chunk = (i: number, extra = '') => ({ chunk_index: i, content: TEXT + extra + 'x'.repeat(250) });
const answer = JSON.stringify({
  conceptos: [
    { nombre: 'Utilidad marginal', tipo: 'concepto', definicion: 'Satisfacción adicional de una unidad más.', formula: '', unidad: '', importancia: 5 },
    { nombre: 'Restricción presupuestal', tipo: 'formula', definicion: 'Limita el gasto.', formula: 'p1*x1 + p2*x2 = M', unidad: '', importancia: 4 },
  ],
  relaciones: [{ de: 'Restricción presupuestal', a: 'Utilidad marginal', tipo: 'relacionado' }],
});

function world(extra: Partial<Record<string, Row[]>> = {}) {
  const db: Record<string, Row[]> = {
    class_memory: [{ classroom_id: 'c1', status: 'building', started_at: '2026-10-29T10:00:00Z', version: 0 }],
    class_memory_material: [],
    teaching_materials: [
      { id: 'm1', classroom_id: 'c1', processing_status: 'completed', display_name: 'Micro 1', filename: 'a.pdf' },
      { id: 'm2', classroom_id: 'c1', processing_status: 'completed', display_name: 'Micro 2', filename: 'b.pdf' },
    ],
    material_chunks: [
      { material_id: 'm1', ...chunk(0) },
      { material_id: 'm2', ...chunk(0, 'otro texto ') },
    ],
    ...extra,
  };
  return db;
}

describe('hashChunks', () => {
  const a = [{ chunk_index: 0, content: 'uno' }, { chunk_index: 1, content: 'dos' }];
  it('es estable, no depende del orden de entrada y cambia si cambia el contenido', () => {
    expect(hashChunks(a)).toBe(hashChunks([...a].reverse()));
    expect(hashChunks(a)).not.toBe(hashChunks([a[0], { chunk_index: 1, content: 'dos!' }]));
    expect(hashChunks(a)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('distingue dividir el texto en otros fragmentos', () => {
    expect(hashChunks([{ chunk_index: 0, content: 'unodos' }])).not.toBe(hashChunks(a));
  });
});

describe('claimMemory: dos peticiones no construyen a la vez', () => {
  const now = new Date('2026-10-29T10:01:00Z').getTime();
  it('sin fila: la reclama; con otra en curso reciente: ocupado', async () => {
    const db: Record<string, Row[]> = { class_memory: [] };
    expect((await claimMemory(fakeAdmin(db), 'c1', false, now)).state).toBe('claimed');
    expect(db.class_memory[0].status).toBe('building');
    expect((await claimMemory(fakeAdmin(db), 'c1', false, now + 1000)).state).toBe('busy');
  });
  it('una construccion caida (muy vieja) se puede reclamar de nuevo', async () => {
    const db = world();
    expect((await claimMemory(fakeAdmin(db), 'c1', false, new Date('2026-10-29T11:00:00Z').getTime())).state).toBe('claimed');
  });
  it('tras un fallo reciente hay espera, salvo que se fuerce', async () => {
    const db = world({ class_memory: [{ classroom_id: 'c1', status: 'failed', started_at: '2026-10-29T10:00:00Z', finished_at: '2026-10-29T10:00:30Z', error: 'cayó' }] });
    const r = await claimMemory(fakeAdmin(db), 'c1', false, now);
    expect(r).toEqual({ state: 'cooldown', error: 'cayó' });
    expect((await claimMemory(fakeAdmin(db), 'c1', true, now)).state).toBe('claimed');
  });
});

describe('runMemoryBuild: incremental', () => {
  it('primera vez: lee todos los materiales, guarda cada extraccion y fusiona el grafo con version 1', async () => {
    const db = world();
    const call = vi.fn().mockResolvedValue(answer);
    await runMemoryBuild(fakeAdmin(db), 'c1', call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(db.class_memory_material.map((r) => r.status)).toEqual(['ready', 'ready']);
    const m = db.class_memory[0];
    expect(m.status).toBe('ready');
    expect(m.version).toBe(1);
    // el mismo concepto en dos materiales es un solo nodo con las dos fuentes
    expect(m.graph.concepts).toHaveLength(2);
    const u = m.graph.concepts.find((c: Concept) => c.key === normalizeKey('Utilidad marginal'));
    expect(u.sources.map((s: any) => s.materialId)).toEqual(['m1', 'm2']);
    expect(m.stats).toMatchObject({ concepts: 2, materials: 2, materialsFailed: 0, reused: 0 });
    expect(m.error).toBeNull();
  });

  it('segunda vez sin cambios: NO llama a la IA (mismo hash) y sube la version', async () => {
    const db = world();
    await runMemoryBuild(fakeAdmin(db), 'c1', vi.fn().mockResolvedValue(answer));
    db.class_memory[0].status = 'building';
    const call = vi.fn().mockResolvedValue(answer);
    await runMemoryBuild(fakeAdmin(db), 'c1', call);
    expect(call).not.toHaveBeenCalled();
    expect(db.class_memory[0].version).toBe(2);
    expect(db.class_memory[0].stats.reused).toBe(2);
    expect(db.class_memory[0].graph.concepts).toHaveLength(2);
  });

  it('si cambia UN material, solo ese se vuelve a leer', async () => {
    const db = world();
    await runMemoryBuild(fakeAdmin(db), 'c1', vi.fn().mockResolvedValue(answer));
    db.material_chunks[1].content += ' texto nuevo';
    const call = vi.fn().mockResolvedValue(answer);
    await runMemoryBuild(fakeAdmin(db), 'c1', call);
    expect(call).toHaveBeenCalledTimes(1);
    expect(db.class_memory[0].stats.reused).toBe(1);
  });

  it('"releer todo" ignora los hashes', async () => {
    const db = world();
    await runMemoryBuild(fakeAdmin(db), 'c1', vi.fn().mockResolvedValue(answer));
    const call = vi.fn().mockResolvedValue(answer);
    await runMemoryBuild(fakeAdmin(db), 'c1', call, { force: true });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('si la IA no responde nada y no habia memoria: queda en fallo con motivo, no "lista y vacia"', async () => {
    const db = world();
    await runMemoryBuild(fakeAdmin(db), 'c1', vi.fn().mockResolvedValue(null));
    expect(db.class_memory[0].status).toBe('failed');
    expect(db.class_memory[0].error).toMatch(/ningún material/);
    // sin ningun bloque leido el material queda a medias (se reintenta), no como "listo"
    expect(db.class_memory_material.every((r) => r.status === 'extracting')).toBe(true);
  });

  it('si la IA falla despues de haber una memoria buena, NO se pierde lo que ya sabia', async () => {
    const db = world();
    await runMemoryBuild(fakeAdmin(db), 'c1', vi.fn().mockResolvedValue(answer));
    db.class_memory[0].status = 'building';
    db.material_chunks[0].content += ' cambio';
    db.material_chunks[1].content += ' cambio';
    await runMemoryBuild(fakeAdmin(db), 'c1', vi.fn().mockResolvedValue(null));
    expect(db.class_memory[0].graph.concepts).toHaveLength(2);
    expect(db.class_memory[0].error).toMatch(/Leídos 0 de 2 materiales/);
    expect(db.class_memory[0].stats.incomplete).toBe(true);
  });

  it('un material que falla no tumba a los demas: la memoria queda lista con un aviso', async () => {
    const db = world();
    const call = vi.fn().mockResolvedValueOnce(answer).mockResolvedValueOnce(null);
    await runMemoryBuild(fakeAdmin(db), 'c1', call);
    const m = db.class_memory[0];
    expect(m.status).toBe('ready');
    expect(m.stats.materialsFailed).toBe(1);
    expect(m.error).toMatch(/1 de 2 materiales/);
    expect(m.graph.concepts).toHaveLength(2);
  });

  it('sin materiales procesados: memoria vacia pero lista (no es un error)', async () => {
    const db = world({ teaching_materials: [], material_chunks: [] });
    await runMemoryBuild(fakeAdmin(db), 'c1', vi.fn());
    expect(db.class_memory[0].status).toBe('ready');
    expect(db.class_memory[0].graph.concepts).toEqual([]);
  });

  it('un error inesperado deja el motivo en vez de quedarse "construyendo" para siempre', async () => {
    const db = world();
    const admin = fakeAdmin(db);
    const boom = { from: (t: string) => (t === 'teaching_materials' ? (() => { throw new Error('caída'); })() : admin.from(t)) };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runMemoryBuild(boom, 'c1', vi.fn());
    expect(db.class_memory[0].status).toBe('failed');
    expect(db.class_memory[0].error).toMatch(/inesperado/);
  });

  it('buildWarning: nada si esta completa; si falta leer dice cuanto, y distingue "sigue" de "la IA no respondio"', () => {
    const done = { materials: 3, materialsRead: 3, materialsFailed: 0, groupsDone: 9, groupsTotal: 9, incomplete: false };
    expect(buildWarning(done)).toBeNull();
    expect(buildWarning({ ...done, materialsRead: 1, groupsDone: 4, incomplete: true })).toMatch(/Leídos 1 de 3 materiales \(4 de 9 bloques\)\. Falta leer el resto/);
    expect(buildWarning({ ...done, materials: 1, materialsRead: 0, materialsFailed: 1, groupsDone: 0, groupsTotal: 3, incomplete: true })).toMatch(/Leídos 0 de 1 material \(0 de 3 bloques\)\. La IA no respondió/);
  });
});

describe('panelState', () => {
  const t0 = new Date('2026-10-29T10:00:00Z').getTime();
  const ready = (over: Partial<MemorySummary> = {}): MemorySummary => ({ status: 'ready', version: 1, builtAt: null, startedAt: '2026-10-29T10:00:00Z', error: null, stats: { concepts: 12 }, ...over });

  it('cada estado tiene un mensaje claro', () => {
    expect(headline(NO_MEMORY, t0).text).toMatch(/Todavía no hay memoria/);
    expect(headline(ready({ status: 'building' }), t0 + 1000).text).toMatch(/leyendo/);
    expect(headline(ready({ status: 'failed', error: 'cayó' }), t0).tone).toBe('danger');
    expect(headline(ready(), t0)).toEqual({ tone: 'ok', text: 'La IA conoce 12 conceptos de esta clase.' });
    expect(headline(ready({ stats: { concepts: 1 } }), t0).text).toMatch(/1 concepto de/);
  });
  it('lista vacia o con aviso: advierte, no celebra', () => {
    expect(headline(ready({ stats: { concepts: 0 } }), t0).tone).toBe('warn');
    expect(headline(ready({ error: '1 de 2 materiales no se pudo leer' }), t0).tone).toBe('warn');
  });
  it('una construccion que lleva demasiado se considera caida', () => {
    const b = ready({ status: 'building' });
    expect(isStale(b, t0 + 60_000)).toBe(false);
    expect(isStale(b, t0 + 10 * 60_000)).toBe(true);
    expect(headline(b, t0 + 10 * 60_000).text).toMatch(/interrumpió/);
  });
  it('groupConcepts: por tipo, y dentro de cada uno de mas a menos importante', () => {
    const c = (name: string, kind: Concept['kind'], importance: number): Concept => ({ key: normalizeKey(name), name, kind, definition: '', formula: '', unit: '', importance, mentions: 1, sources: [] });
    const g = groupConcepts([c('b', 'variable', 2), c('a', 'concepto', 3), c('c', 'variable', 5)]);
    expect(g.map((x) => x.kind)).toEqual(['concepto', 'variable']);
    expect(g[1].items.map((i) => i.name)).toEqual(['c', 'b']);
  });
});

describe('migracion 079 (memoria de la clase)', () => {
  const sql = read('supabase/migrations/079_class_memory.sql');
  it('crea las dos tablas con RLS y topes de tamaño', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.class_memory ');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.class_memory_material');
    expect((sql.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length).toBe(2);
    expect(sql).toContain('pg_column_size(graph) < 800000');
    expect(sql).toContain('pg_column_size(extraction) < 400000');
    expect(sql).toContain("CHECK (status IN ('building', 'ready', 'failed'))");
  });
  it('se borra en cascada con la clase y con el material', () => {
    expect(sql).toContain('REFERENCES public.classrooms(id) ON DELETE CASCADE');
    expect(sql).toContain('REFERENCES public.teaching_materials(id) ON DELETE CASCADE');
  });
  it('solo el profesor dueño LEE y NADIE escribe desde el navegador (sin politicas de escritura)', () => {
    expect(sql).toContain('class_memory_teacher_select');
    expect(sql).toContain('class_memory_material_teacher_select');
    expect(sql).toContain('c.teacher_id = auth.uid()');
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(sql).not.toContain('class_enrollments');
  });
});

describe('ruta /api/memory/build', () => {
  const route = codeOnly(read('src/app/api/memory/build/route.ts'));
  it('exige sesion y que la clase sea del profesor (si no, 404)', () => {
    expect(route).toContain('auth.getUser()');
    expect(route).toContain('status: 401');
    expect(route).toMatch(/from\('classrooms'\)[\s\S]*?\.eq\('teacher_id', user\.id\)/);
    expect(route).toContain('status: 404');
  });
  it('comprueba al dueño ANTES de usar la llave de servicio, y valida el id', () => {
    expect(route.indexOf("eq('teacher_id', user.id)")).toBeLessThan(route.indexOf('createAdminSupabase()'));
    expect(route).toContain('UUID_RE.test(classroomId)');
  });
  it('responde al instante y sigue en segundo plano, con reclamo atomico', () => {
    expect(route).toContain('claimMemory(');
    expect(route).toContain('runInBackground(');
    expect(route).toContain("status: 'building'");
  });
});
