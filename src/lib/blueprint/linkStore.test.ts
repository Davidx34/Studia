import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { linkTarget, saveLinks, type LinkDb, type StoredLink } from './linkStore';
import { supabaseLinkDb } from './linkStoreDb';
import type { BlueprintRow } from './store';
import type { Blueprint } from './types';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const doc = (): Blueprint => ({
  version: 1,
  outcomes: [{ id: 'o1', statement: 'x' }],
  periods: [{ id: 'p1', name: 'A', order: 1, weight: 100, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob1', title: 'T', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'Uno', order: 1 }, { id: 'm2', title: 'Dos', order: 2 }, { id: 'm3', title: 'Tres', order: 3 }] }] }],
});
const row = (rid: string, version: number, status: BlueprintRow['status'], d: unknown = doc()): BlueprintRow => ({ id: rid, version, status, doc: d });

// Base en memoria que respeta la regla de la real: un modulo real solo sirve a un nodo por plan (se comprueba al insertar).
function memory(rows: BlueprintRow[], stored: Record<string, StoredLink[]> = {}, classModules: string[] = [id(1), id(2), id(3)]) {
  const calls: string[] = [];
  let n = 0;
  const data: Record<string, StoredLink[]> = JSON.parse(JSON.stringify(stored));
  const links: LinkDb = {
    async classModuleIds() {
      calls.push('classModuleIds');
      return classModules;
    },
    async listLinks(bp) {
      calls.push('list');
      return (data[bp] ?? []).map((l) => ({ ...l }));
    },
    async deleteLinks(ids) {
      calls.push(`delete(${ids.length})`);
      for (const k of Object.keys(data)) data[k] = data[k].filter((l) => !ids.includes(l.id));
    },
    async insertLinks(bp, _c, ls) {
      calls.push(`insert(${ls.length})`);
      for (const l of ls) {
        if ((data[bp] ?? []).some((x) => x.moduleId === l.moduleId || x.nodeId === l.nodeId)) throw new Error('duplicado');
        (data[bp] ??= []).push({ ...l, id: `L${++n}` });
      }
    },
  };
  return { plans: { list: async () => rows.map((r) => ({ ...r })) }, links, data, calls };
}
const ctx = { classroomId: 'c1' };

describe('linkTarget', () => {
  it('prefiere el borrador; si no hay, el publicado; archivados nunca', () => {
    expect(linkTarget([row('a', 1, 'published'), row('b', 2, 'draft')])!.id).toBe('b');
    expect(linkTarget([row('a', 1, 'archived'), row('b', 2, 'published')])!.id).toBe('b');
    expect(linkTarget([row('a', 1, 'archived')])).toBeNull();
    expect(linkTarget([])).toBeNull();
  });
});

describe('saveLinks', () => {
  it('sin plan: 404 y no toca nada', async () => {
    const m = memory([]);
    expect(await saveLinks(m.plans, m.links, ctx, [])).toMatchObject({ ok: false, status: 404 });
    expect(m.calls).toEqual([]);
  });
  it('un plan guardado ilegible: 422, sin tocar los enlaces', async () => {
    const m = memory([row('d', 1, 'draft', { periods: 5 })]);
    expect(await saveLinks(m.plans, m.links, ctx, [])).toMatchObject({ ok: false, status: 422 });
    expect(m.calls).toEqual([]);
  });
  it('enlaces nuevos sobre el borrador: los agrega', async () => {
    const m = memory([row('d', 3, 'draft')]);
    const r = await saveLinks(m.plans, m.links, ctx, [{ nodeId: 'm1', moduleId: id(1) }, { nodeId: 'm2', moduleId: id(2) }]);
    expect(r).toEqual({ ok: true, version: 3, status: 'draft', added: 2, removed: 0, total: 2 });
    expect(m.data.d.map((l) => [l.nodeId, l.moduleId])).toEqual([['m1', id(1)], ['m2', id(2)]]);
  });
  it('sin borrador, enlaza sobre el publicado', async () => {
    const m = memory([row('p', 2, 'published')]);
    const r = await saveLinks(m.plans, m.links, ctx, [{ nodeId: 'm1', moduleId: id(1) }]);
    expect(r).toMatchObject({ ok: true, version: 2, status: 'published' });
    expect(m.data.p).toHaveLength(1);
    expect(m.data.d).toBeUndefined();
  });
  it('NO toca los enlaces de otra version', async () => {
    const m = memory([row('p', 1, 'published'), row('d', 2, 'draft')], { p: [{ id: 'X', nodeId: 'm1', moduleId: id(1) }] });
    await saveLinks(m.plans, m.links, ctx, [{ nodeId: 'm2', moduleId: id(2) }]);
    expect(m.data.p).toEqual([{ id: 'X', nodeId: 'm1', moduleId: id(1) }]);
    expect(m.data.d.map((l) => l.nodeId)).toEqual(['m2']);
  });
  it('reemplazo por diferencias: lo que no cambia no se toca, lo que sobra se borra y lo nuevo se agrega', async () => {
    const m = memory([row('d', 1, 'draft')], { d: [{ id: 'A', nodeId: 'm1', moduleId: id(1) }, { id: 'B', nodeId: 'm2', moduleId: id(2) }] });
    const r = await saveLinks(m.plans, m.links, ctx, [{ nodeId: 'm1', moduleId: id(1) }, { nodeId: 'm3', moduleId: id(3) }]);
    expect(r).toMatchObject({ ok: true, added: 1, removed: 1, total: 2 });
    expect(m.data.d.map((l) => l.nodeId).sort()).toEqual(['m1', 'm3']);
    expect(m.data.d.find((l) => l.nodeId === 'm1')!.id).toBe('A'); // el que no cambio sigue siendo el mismo registro
  });
  it('cambiar el modulo real de un MISMO nodo es un cambio (se borra el enlace viejo y se crea el nuevo)', async () => {
    const m = memory([row('d', 1, 'draft')], { d: [{ id: 'A', nodeId: 'm1', moduleId: id(1) }] });
    const r = await saveLinks(m.plans, m.links, ctx, [{ nodeId: 'm1', moduleId: id(2) }]);
    expect(r).toMatchObject({ ok: true, added: 1, removed: 1, total: 1 });
    expect(m.data.d.map((l) => [l.nodeId, l.moduleId])).toEqual([['m1', id(2)]]);
  });
  it('borra ANTES de insertar (un modulo real que cambia de nodo no choca con su enlace anterior)', async () => {
    const m = memory([row('d', 1, 'draft')], { d: [{ id: 'A', nodeId: 'm1', moduleId: id(1) }] });
    const r = await saveLinks(m.plans, m.links, ctx, [{ nodeId: 'm2', moduleId: id(1) }]);
    expect(r).toMatchObject({ ok: true, added: 1, removed: 1 });
    expect(m.calls.indexOf('delete(1)')).toBeLessThan(m.calls.indexOf('insert(1)'));
  });
  it('repetir lo mismo no hace nada (idempotente)', async () => {
    const m = memory([row('d', 1, 'draft')]);
    const links = [{ nodeId: 'm1', moduleId: id(1) }];
    await saveLinks(m.plans, m.links, ctx, links);
    m.calls.length = 0;
    expect(await saveLinks(m.plans, m.links, ctx, links)).toMatchObject({ ok: true, added: 0, removed: 0, total: 1 });
    expect(m.calls.some((c) => c.startsWith('insert') || c.startsWith('delete'))).toBe(false);
  });
  it('una lista vacia desenlaza todo', async () => {
    const m = memory([row('d', 1, 'draft')], { d: [{ id: 'A', nodeId: 'm1', moduleId: id(1) }] });
    expect(await saveLinks(m.plans, m.links, ctx, [])).toMatchObject({ ok: true, added: 0, removed: 1, total: 0 });
    expect(m.data.d).toEqual([]);
  });
  it('enlaces invalidos: 400 con los motivos y la base NO cambia', async () => {
    const m = memory([row('d', 1, 'draft')], { d: [{ id: 'A', nodeId: 'm1', moduleId: id(1) }] });
    for (const bad of [[{ nodeId: 'nope', moduleId: id(1) }], [{ nodeId: 'm2', moduleId: id(99) }], 'x', [{ nodeId: 'm1', moduleId: id(1) }, { nodeId: 'm2', moduleId: id(1) }]]) {
      const r = await saveLinks(m.plans, m.links, ctx, bad);
      expect(r).toMatchObject({ ok: false, status: 400 });
    }
    expect(m.calls.some((c) => c.startsWith('insert') || c.startsWith('delete'))).toBe(false);
    expect(m.data.d).toHaveLength(1);
  });
  it('si borrar falla, no se llega a insertar; si insertar falla, el error sube (reintentar converge)', async () => {
    const m = memory([row('d', 1, 'draft')], { d: [{ id: 'A', nodeId: 'm1', moduleId: id(1) }] });
    m.links.deleteLinks = async () => {
      throw new Error('red');
    };
    await expect(saveLinks(m.plans, m.links, ctx, [{ nodeId: 'm2', moduleId: id(2) }])).rejects.toThrow('red');
    expect(m.calls.some((c) => c.startsWith('insert'))).toBe(false);
  });
});

// Doble del cliente de Supabase (mismo que storeDb.test): registra la cadena de cada consulta.
function fakeAdmin(result: { data?: unknown; error?: { message: string } | null } = {}) {
  const log: { table: string; chain: [string, unknown[]][] }[] = [];
  const admin = {
    from(table: string) {
      const entry = { table, chain: [] as [string, unknown[]][] };
      log.push(entry);
      const q: any = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === 'then') return (res: (v: unknown) => unknown) => res({ data: result.data ?? null, error: result.error ?? null });
            return (...args: unknown[]) => {
              entry.chain.push([prop, args]);
              return q;
            };
          },
        }
      );
      return q;
    },
  };
  const has = (i: number, op: string, ...args: unknown[]) => log[i].chain.some(([o, a]) => o === op && JSON.stringify(a) === JSON.stringify(args));
  return { admin, log, has, ops: (i: number, op: string) => log[i].chain.filter(([o]) => o === op).map(([, a]) => a) };
}

describe('supabaseLinkDb', () => {
  it('classModuleIds: solo los modulos de ESA clase', async () => {
    const f = fakeAdmin({ data: [{ id: id(1) }, { id: id(2) }] });
    expect(await supabaseLinkDb(f.admin).classModuleIds('c1')).toEqual([id(1), id(2)]);
    expect(f.log[0].table).toBe('content_modules');
    expect(f.has(0, 'eq', 'classroom_id', 'c1')).toBe(true);
  });
  it('listLinks: solo los del plan pedido, convertidos a nodeId/moduleId', async () => {
    const f = fakeAdmin({ data: [{ id: 'L', node_id: 'm1', content_module_id: id(1) }] });
    expect(await supabaseLinkDb(f.admin).listLinks('bp1')).toEqual([{ id: 'L', nodeId: 'm1', moduleId: id(1) }]);
    expect(f.log[0].table).toBe('blueprint_module_links');
    expect(f.has(0, 'eq', 'blueprint_id', 'bp1')).toBe(true);
  });
  it('deleteLinks: solo los ids dados', async () => {
    const f = fakeAdmin();
    await supabaseLinkDb(f.admin).deleteLinks(['a', 'b']);
    expect(f.ops(0, 'delete')).toHaveLength(1);
    expect(f.has(0, 'in', 'id', ['a', 'b'])).toBe(true);
  });
  it('insertLinks: plan, clase, nodo y modulo de cada enlace', async () => {
    const f = fakeAdmin();
    await supabaseLinkDb(f.admin).insertLinks('bp1', 'c1', [{ nodeId: 'm1', moduleId: id(1) }]);
    expect(f.ops(0, 'insert')[0]).toEqual([[{ blueprint_id: 'bp1', classroom_id: 'c1', node_id: 'm1', content_module_id: id(1) }]]);
  });
  it('un error de la base se LANZA en cada operacion', async () => {
    const db = supabaseLinkDb(fakeAdmin({ error: { message: 'boom' } }).admin);
    await expect(db.classModuleIds('c')).rejects.toThrow('links.classModuleIds');
    await expect(db.listLinks('b')).rejects.toThrow('links.list');
    await expect(db.deleteLinks(['a'])).rejects.toThrow('links.delete');
    await expect(db.insertLinks('b', 'c', [])).rejects.toThrow('links.insert');
  });
});

describe('ruta: accion saveLinks', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/blueprint/route.ts'), 'utf8');
  const idx = (s: string) => route.indexOf(s);
  it('esta permitida, llega DESPUES de comprobar sesion y propiedad, y usa la logica validada', () => {
    expect(route).toContain("action !== 'saveLinks'");
    expect(route).toContain('saveLinks(db, supabaseLinkDb(admin), { classroomId }, body?.links)');
    expect(idx("fail(404, 'Clase no encontrada')")).toBeLessThan(idx("action === 'saveLinks'"));
    expect(idx("fail(401")).toBeLessThan(idx("action === 'saveLinks'"));
  });
  it('no escribe tablas por su cuenta', () => {
    expect(route).not.toMatch(/\.from\(['"](blueprint_module_links|content_modules)['"]\)/);
  });
});
