// Guardar los enlaces plan <-> modulos reales. La base va INYECTADA (sin red) para poder probar la logica; la ruta solo comprueba sesion y propiedad de la clase.
//
// Los enlaces se guardan sobre UN plan: el borrador si hay uno (es el que se esta armando) y, si no, el publicado. Cada version tiene los suyos. NO se copian de una version a otra:
// una IA que regenera el plan reutiliza ids como "m1_1_1" con otro significado, y copiar por id enlazaria contenido equivocado. El profesor vuelve a enlazar (con las sugerencias).
// Guardar es "reemplazar todo" por diferencias: primero se borra lo que sobra (el modulo real solo puede servir a un nodo) y luego se agrega lo nuevo. Si falla a la mitad, reintentar
// converge al mismo resultado.

import { parseBlueprint } from './parse';
import { checkLinks, type Link } from './links';
import type { BlueprintDb, BlueprintRow } from './store';

export interface StoredLink extends Link {
  id: string;
}

export interface LinkDb {
  classModuleIds(classroomId: string): Promise<string[]>;
  listLinks(blueprintId: string): Promise<StoredLink[]>;
  deleteLinks(ids: string[]): Promise<void>;
  insertLinks(blueprintId: string, classroomId: string, links: Link[]): Promise<void>;
}

// Sobre que plan se enlaza: el borrador si existe; si no, el publicado.
export const linkTarget = (rows: BlueprintRow[]): BlueprintRow | null => rows.find((r) => r.status === 'draft') ?? rows.find((r) => r.status === 'published') ?? null;

export type SaveLinksResult =
  | { ok: true; version: number; status: 'draft' | 'published'; added: number; removed: number; total: number }
  | { ok: false; status: 404 | 400 | 422; error: string; errors?: string[] };

export async function saveLinks(plans: Pick<BlueprintDb, 'list'>, links: LinkDb, ctx: { classroomId: string }, raw: unknown): Promise<SaveLinksResult> {
  const target = linkTarget(await plans.list(ctx.classroomId));
  if (!target) return { ok: false, status: 404, error: 'Primero guarda un plan.' };
  const parsed = parseBlueprint(target.doc);
  if (!parsed.ok) return { ok: false, status: 422, error: 'El plan guardado no se pudo leer.' };

  const checked = checkLinks(raw, parsed.blueprint, await links.classModuleIds(ctx.classroomId));
  if (!checked.ok) return { ok: false, status: 400, error: 'Los enlaces no son validos.', errors: checked.errors };

  const have = await links.listLinks(target.id);
  const key = (l: Link) => `${l.nodeId}\u0000${l.moduleId}`;
  const want = new Map(checked.links.map((l) => [key(l), l]));
  const haveKeys = new Set(have.map(key));
  const toDelete = have.filter((l) => !want.has(key(l)));
  const toAdd = checked.links.filter((l) => !haveKeys.has(key(l)));
  if (toDelete.length > 0) await links.deleteLinks(toDelete.map((l) => l.id));
  if (toAdd.length > 0) await links.insertLinks(target.id, ctx.classroomId, toAdd);
  return { ok: true, version: target.version, status: target.status as 'draft' | 'published', added: toAdd.length, removed: toDelete.length, total: checked.links.length };
}
