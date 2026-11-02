import { describe, expect, it } from 'vitest';
import { prepareBlueprint, publishDraft as publishWith, saveDraft, type BlueprintDb, type BlueprintRow, type LinkReader } from './store';
import type { Blueprint } from './types';

const valid = (): Blueprint => ({
  version: 99, // el navegador puede mandar cualquier version: manda la de la fila
  outcomes: [
    { id: 'o1', statement: 'Explica la elasticidad de la demanda' },
    { id: 'o2', statement: 'Calcula el equilibrio de mercado' },
  ],
  periods: [
    {
      id: 'p1',
      name: 'Primer corte',
      order: 1,
      weight: 40,
      assessesOutcomeIds: ['o1'],
      objectives: [{ id: 'ob1', title: 'Entender la elasticidad', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'Concepto', order: 1 }] }],
    },
    {
      id: 'p2',
      name: 'Segundo corte',
      order: 2,
      weight: 60,
      assessesOutcomeIds: ['o2'],
      objectives: [{ id: 'ob2', title: 'Hallar el equilibrio', outcomeIds: ['o2'], modules: [{ id: 'm2', title: 'Oferta y demanda', order: 1 }] }],
    },
  ],
});

// Un draft guardable pero NO publicable (los cortes suman 90).
const unpublishable = (): Blueprint => {
  const b = valid();
  b.periods[1].weight = 50;
  return b;
};

// Base en memoria con las mismas reglas que la real: un borrador y un publicado por clase; registra cada llamada para comprobar el ORDEN.
function memoryDb(initial: BlueprintRow[] = []) {
  const rows: BlueprintRow[] = initial.map((r) => ({ ...r }));
  const calls: string[] = [];
  let n = 0;
  const db: BlueprintDb = {
    async list() {
      calls.push('list');
      return rows.map((r) => ({ ...r }));
    },
    async insertDraft(row) {
      calls.push(`insertDraft(v${row.version})`);
      const r: BlueprintRow = { id: `id${++n}`, version: row.version, status: 'draft', doc: row.doc };
      rows.push(r);
      return r;
    },
    async updateDraft(id, doc) {
      calls.push(`updateDraft(${id})`);
      rows.find((r) => r.id === id && r.status === 'draft')!.doc = doc;
    },
    async archive(id) {
      calls.push(`archive(${id})`);
      rows.find((r) => r.id === id)!.status = 'archived';
    },
    async publish(id) {
      calls.push(`publish(${id})`);
      if (rows.some((r) => r.status === 'published')) throw new Error('un solo publicado');
      rows.find((r) => r.id === id)!.status = 'published';
    },
  };
  return { db, rows, calls };
}
const ctx = { classroomId: 'c1', teacherId: 't1' };

describe('prepareBlueprint', () => {
  it('la version de la fila manda sobre la del documento', () => {
    const r = prepareBlueprint(valid(), 3);
    expect(r.ok && r.blueprint.version).toBe(3);
  });
  it('no es un objeto: se rechaza', () => {
    for (const bad of [null, 'x', 5, [], undefined]) {
      const r = prepareBlueprint(bad, 1);
      expect(r.ok).toBe(false);
    }
  });
  it('forma mala: 400 con la ruta del error', () => {
    const b: any = valid();
    b.periods[0].name = '';
    const r = prepareBlueprint(b, 1);
    expect(!r.ok && r.status).toBe(400);
    expect(!r.ok && r.errors.join(' ')).toContain('periods[0].name');
  });
  it('demasiado grande: 422', () => {
    const b: any = valid();
    b.outcomes[0].statement = 'x'.repeat(450_000);
    const r = prepareBlueprint(b, 1);
    expect(!r.ok && r.status).toBe(422);
  });
  it('claves peligrosas se quitan antes de leer', () => {
    const b: any = JSON.parse('{"__proto__":{"x":1},"constructor":{"y":2}}');
    Object.assign(b, valid());
    const r = prepareBlueprint(b, 1);
    expect(r.ok).toBe(true);
    expect(r.ok && Object.keys(r.blueprint).sort()).toEqual(['outcomes', 'periods', 'version']);
  });
  it('devuelve las reglas incumplidas sin rechazar el borrador', () => {
    const r = prepareBlueprint(unpublishable(), 1);
    expect(r.ok && r.issues.some((i) => i.code === 'weightSum')).toBe(true);
  });
});

describe('saveDraft', () => {
  it('clase sin planes: crea el borrador en la version 1', async () => {
    const { db, rows, calls } = memoryDb();
    const r = await saveDraft(db, ctx, valid());
    expect(r).toMatchObject({ ok: true, version: 1, created: true, publishable: true });
    expect(rows).toHaveLength(1);
    expect((rows[0].doc as Blueprint).version).toBe(1);
    expect(calls).toEqual(['list', 'insertDraft(v1)']);
  });
  it('ya hay borrador: lo actualiza (no crea otro) y conserva su version', async () => {
    const m = memoryDb([{ id: 'd', version: 4, status: 'draft', doc: valid() }]);
    const r = await saveDraft(m.db, ctx, valid());
    expect(r).toMatchObject({ ok: true, version: 4, created: false });
    expect(m.rows).toHaveLength(1);
    expect(m.calls).toEqual(['list', 'updateDraft(d)']);
    expect((m.rows[0].doc as Blueprint).version).toBe(4);
  });
  it('hay un publicado y ningun borrador: el borrador nuevo es la version SIGUIENTE (el publicado no se toca)', async () => {
    const m = memoryDb([{ id: 'p', version: 2, status: 'published', doc: valid() }, { id: 'a', version: 1, status: 'archived', doc: valid() }]);
    const r = await saveDraft(m.db, ctx, valid());
    expect(r).toMatchObject({ ok: true, version: 3, created: true });
    expect(m.rows.find((x) => x.id === 'p')!.status).toBe('published');
    expect(m.calls).not.toContain('archive(p)');
  });
  it('solo hay planes archivados: la version nueva sigue contando los archivados (no repite una version)', async () => {
    const m = memoryDb([{ id: 'a', version: 5, status: 'archived', doc: valid() }]);
    const r = await saveDraft(m.db, ctx, valid());
    expect(r).toMatchObject({ ok: true, version: 6 });
  });
  it('un borrador incompleto SE guarda, y avisa que no es publicable', async () => {
    const { db, rows } = memoryDb();
    const r = await saveDraft(db, ctx, unpublishable());
    expect(r).toMatchObject({ ok: true, publishable: false });
    expect(rows).toHaveLength(1);
  });
  it('un documento invalido NO toca la base', async () => {
    const m = memoryDb();
    const b: any = valid();
    b.periods = 'no';
    const r = await saveDraft(m.db, ctx, b);
    expect(r.ok).toBe(false);
    expect(m.rows).toHaveLength(0);
    expect(m.calls).toEqual(['list']);
  });
});

// Lectura de enlaces en memoria: por defecto TODO enlazado (m1 y m2 a modulos reales de la clase).
const reader = (over: { links?: { nodeId: string; moduleId: string }[]; real?: string[]; calls?: string[] } = {}): LinkReader => ({
  async listLinks(bp) {
    over.calls?.push(`links(${bp})`);
    return over.links ?? [{ nodeId: 'm1', moduleId: 'r1' }, { nodeId: 'm2', moduleId: 'r2' }];
  },
  async classModuleIds() {
    return over.real ?? ['r1', 'r2'];
  },
});
const publishDraft = (db: BlueprintDb, c: { classroomId: string }) => publishWith(db, c, reader());

describe('publishDraft', () => {
  it('sin borrador: 404 y no toca nada', async () => {
    const m = memoryDb([{ id: 'p', version: 1, status: 'published', doc: valid() }]);
    const r = await publishDraft(m.db, ctx);
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(m.calls).toEqual(['list']);
  });
  it('primera publicacion: publica el borrador, sin archivar nada', async () => {
    const m = memoryDb([{ id: 'd', version: 1, status: 'draft', doc: valid() }]);
    const r = await publishDraft(m.db, ctx);
    expect(r).toMatchObject({ ok: true, version: 1, archivedVersion: null });
    expect(m.calls).toEqual(['list', 'publish(d)']);
  });
  it('con un publicado anterior: lo archiva PRIMERO y luego publica el borrador', async () => {
    const m = memoryDb([{ id: 'p', version: 1, status: 'published', doc: valid() }, { id: 'd', version: 2, status: 'draft', doc: valid() }]);
    const r = await publishDraft(m.db, ctx);
    expect(r).toMatchObject({ ok: true, version: 2, archivedVersion: 1 });
    expect(m.calls).toEqual(['list', 'archive(p)', 'publish(d)']);
    expect(m.rows.map((x) => x.status)).toEqual(['archived', 'published']);
  });
  it('un borrador con errores de reglas NO se publica y el publicado actual queda intacto', async () => {
    const m = memoryDb([{ id: 'p', version: 1, status: 'published', doc: valid() }, { id: 'd', version: 2, status: 'draft', doc: unpublishable() }]);
    const r = await publishDraft(m.db, ctx);
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(!r.ok && r.issues?.some((i) => i.code === 'weightSum')).toBe(true);
    expect(m.calls).toEqual(['list']);
    expect(m.rows.find((x) => x.id === 'p')!.status).toBe('published');
  });
  it('un borrador guardado corrupto (escrito a mano en la base) NO se publica', async () => {
    const m = memoryDb([{ id: 'd', version: 1, status: 'draft', doc: { periods: 5 } }]);
    const r = await publishDraft(m.db, ctx);
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(m.calls).toEqual(['list']);
  });
  it('si publicar falla tras archivar, reintentar funciona (ya no hay publicado que archivar)', async () => {
    const m = memoryDb([{ id: 'p', version: 1, status: 'published', doc: valid() }, { id: 'd', version: 2, status: 'draft', doc: valid() }]);
    const real = m.db.publish;
    let boom = true;
    m.db.publish = async (id) => {
      if (boom) {
        boom = false;
        throw new Error('red');
      }
      return real(id);
    };
    await expect(publishDraft(m.db, ctx)).rejects.toThrow('red');
    expect(m.rows.map((x) => x.status)).toEqual(['archived', 'draft']);
    const again = await publishDraft(m.db, ctx);
    expect(again).toMatchObject({ ok: true, version: 2, archivedVersion: null });
    expect(m.rows.map((x) => x.status)).toEqual(['archived', 'published']);
  });
});

describe('publishDraft: sin modulos sin enlazar (100 % para avanzar)', () => {
  const draft = (): BlueprintRow[] => [{ id: 'd', version: 1, status: 'draft', doc: valid() }];
  it('con un modulo sin enlazar NO se publica: 422 con los titulos, y no se archiva ni se publica nada', async () => {
    const m = memoryDb([{ id: 'p', version: 1, status: 'published', doc: valid() }, { id: 'd', version: 2, status: 'draft', doc: valid() }]);
    const r = await publishWith(m.db, ctx, reader({ links: [{ nodeId: 'm1', moduleId: 'r1' }] }));
    expect(r).toMatchObject({ ok: false, status: 422, unlinked: ['Oferta y demanda'] });
    expect(!r.ok && r.error).toContain('1 módulo del plan sin enlazar');
    expect(m.calls).toEqual(['list']);
    expect(m.rows.map((x) => x.status)).toEqual(['published', 'draft']);
  });
  it('sin ningun enlace: los dos modulos se listan, en plural', async () => {
    const m = memoryDb(draft());
    const r = await publishWith(m.db, ctx, reader({ links: [] }));
    expect(r).toMatchObject({ ok: false, status: 422, unlinked: ['Concepto', 'Oferta y demanda'] });
    expect(!r.ok && r.error).toContain('2 módulos');
  });
  it('un enlace a un modulo que ya NO existe en la clase cuenta como sin enlazar', async () => {
    const m = memoryDb(draft());
    const r = await publishWith(m.db, ctx, reader({ real: ['r1'] }));
    expect(r).toMatchObject({ ok: false, status: 422, unlinked: ['Oferta y demanda'] });
  });
  it('un enlace de un modulo que ya no esta en el plan no cuenta ni estorba', async () => {
    const m = memoryDb(draft());
    const r = await publishWith(m.db, ctx, reader({ links: [{ nodeId: 'm1', moduleId: 'r1' }, { nodeId: 'm2', moduleId: 'r2' }, { nodeId: 'viejo', moduleId: 'r1' }] }));
    expect(r).toMatchObject({ ok: true });
  });
  it('lee los enlaces del BORRADOR (no de otra version) y con todo enlazado publica', async () => {
    const calls: string[] = [];
    const m = memoryDb([{ id: 'p', version: 1, status: 'published', doc: valid() }, { id: 'd', version: 2, status: 'draft', doc: valid() }]);
    const r = await publishWith(m.db, ctx, reader({ calls }));
    expect(r).toMatchObject({ ok: true, version: 2, archivedVersion: 1 });
    expect(calls).toEqual(['links(d)']);
  });
  it('las reglas del plan se revisan primero: un borrador con errores ni siquiera lee enlaces', async () => {
    const calls: string[] = [];
    const m = memoryDb([{ id: 'd', version: 1, status: 'draft', doc: unpublishable() }]);
    const r = await publishWith(m.db, ctx, reader({ calls, links: [] }));
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(!r.ok && r.unlinked).toBeUndefined();
    expect(calls).toEqual([]);
  });
});

