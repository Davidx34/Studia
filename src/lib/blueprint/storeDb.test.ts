import { describe, expect, it } from 'vitest';
import { supabaseBlueprintDb } from './storeDb';

// Doble del cliente de Supabase: registra la cadena de llamadas de cada consulta y devuelve lo que se le indique al final.
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
  const ops = (i: number, op: string) => log[i].chain.filter(([o]) => o === op).map(([, a]) => a);
  return { admin, log, has, ops };
}

describe('supabaseBlueprintDb', () => {
  it('list: solo la clase pedida, de la tabla de planes, ordenada por version', async () => {
    const f = fakeAdmin({ data: [{ id: 'a', version: 1, status: 'draft', doc: {} }] });
    const rows = await supabaseBlueprintDb(f.admin).list('c1');
    expect(rows).toHaveLength(1);
    expect(f.log[0].table).toBe('course_blueprints');
    expect(f.has(0, 'eq', 'classroom_id', 'c1')).toBe(true);
    expect(f.has(0, 'order', 'version', { ascending: true })).toBe(true);
  });
  it('list: sin filas devuelve una lista vacia', async () => {
    expect(await supabaseBlueprintDb(fakeAdmin({ data: null }).admin).list('c1')).toEqual([]);
  });
  it('insertDraft: borrador de la clase, del profesor y de la version dadas', async () => {
    const f = fakeAdmin({ data: { id: 'n', version: 3, status: 'draft', doc: {} } });
    const doc: any = { version: 3, outcomes: [], periods: [] };
    await supabaseBlueprintDb(f.admin).insertDraft({ classroomId: 'c1', teacherId: 't1', version: 3, doc });
    expect(f.ops(0, 'insert')[0]).toEqual([{ classroom_id: 'c1', teacher_id: 't1', version: 3, status: 'draft', doc }]);
  });
  it('updateDraft: solo cambia el documento y solo si sigue siendo borrador', async () => {
    const f = fakeAdmin();
    const doc: any = { version: 1 };
    await supabaseBlueprintDb(f.admin).updateDraft('x', doc);
    expect(f.ops(0, 'update')).toEqual([[{ doc }]]);
    expect(f.has(0, 'eq', 'id', 'x')).toBe(true);
    expect(f.has(0, 'eq', 'status', 'draft')).toBe(true);
  });
  it('archive: solo archiva un plan que esta publicado', async () => {
    const f = fakeAdmin();
    await supabaseBlueprintDb(f.admin).archive('x');
    expect(f.ops(0, 'update')).toEqual([[{ status: 'archived' }]]);
    expect(f.has(0, 'eq', 'id', 'x')).toBe(true);
    expect(f.has(0, 'eq', 'status', 'published')).toBe(true);
  });
  it('publish: solo publica un borrador y sella la fecha de publicacion', async () => {
    const f = fakeAdmin();
    await supabaseBlueprintDb(f.admin).publish('x');
    const [patch] = f.ops(0, 'update')[0] as [{ status: string; published_at: string }];
    expect(patch.status).toBe('published');
    expect(new Date(patch.published_at).toString()).not.toBe('Invalid Date');
    expect(f.has(0, 'eq', 'id', 'x')).toBe(true);
    expect(f.has(0, 'eq', 'status', 'draft')).toBe(true);
  });
  it('un error de la base se LANZA en cada operacion (no se ignora)', async () => {
    const f = fakeAdmin({ error: { message: 'boom' } });
    const db = supabaseBlueprintDb(f.admin);
    await expect(db.list('c1')).rejects.toThrow('blueprints.list');
    await expect(db.insertDraft({ classroomId: 'c', teacherId: 't', version: 1, doc: {} as any })).rejects.toThrow('blueprints.insertDraft');
    await expect(db.updateDraft('x', {} as any)).rejects.toThrow('blueprints.updateDraft');
    await expect(db.archive('x')).rejects.toThrow('blueprints.archive');
    await expect(db.publish('x')).rejects.toThrow('blueprints.publish');
  });
});
