// Guardar y publicar el plan del curso. Logica con la base INYECTADA (sin red, sin Next) para poder probarla: la ruta solo comprueba sesion y propiedad de la clase.
//
// Todo lo que llega del navegador es no confiable: el borrador pasa por guardJsonb (tamano, profundidad, claves peligrosas), parseBlueprint (forma) y checkBlueprint (reglas) ANTES de
// tocar la base. La base (migracion 085) es la ultima barrera, no la primera.
//
// Un plan publicado es inmutable: guardar sobre una clase con plan publicado crea (o actualiza) el BORRADOR de la siguiente version; publicar archiva el publicado anterior y publica el borrador.

import { guardJsonb } from '@/lib/db/jsonbGuard';
import { parseBlueprint } from './parse';
import { checkBlueprint, isPublishable } from './validate';
import type { Blueprint, Issue } from './types';

export interface BlueprintRow {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  doc: unknown;
}

// Lo minimo que se necesita de la base. En produccion lo implementa un adaptador sobre el cliente de servicio (ver ruta); en las pruebas, un doble en memoria.
export interface BlueprintDb {
  list(classroomId: string): Promise<BlueprintRow[]>;
  insertDraft(row: { classroomId: string; teacherId: string; version: number; doc: Blueprint }): Promise<BlueprintRow>;
  updateDraft(id: string, doc: Blueprint): Promise<void>;
  archive(id: string): Promise<void>;
  publish(id: string): Promise<void>;
}

export type Prepared = { ok: true; blueprint: Blueprint; issues: Issue[] } | { ok: false; status: 400 | 422; errors: string[] };

// Limpia, lee y revisa un borrador. `version` es la de la FILA donde se va a guardar: manda sobre la que diga el documento (el navegador no elige versiones).
export function prepareBlueprint(raw: unknown, version: number): Prepared {
  const guarded = guardJsonb(raw, 'courseBlueprint');
  if (!guarded.ok) return { ok: false, status: guarded.reason === 'size' ? 422 : 400, errors: [guarded.message] };
  const withVersion = { ...(guarded.value as Record<string, unknown>), version };
  const parsed = parseBlueprint(withVersion);
  if (!parsed.ok) return { ok: false, status: 400, errors: parsed.errors };
  return { ok: true, blueprint: parsed.blueprint, issues: checkBlueprint(parsed.blueprint) };
}

const draftOf = (rows: BlueprintRow[]) => rows.find((r) => r.status === 'draft') ?? null;
const publishedOf = (rows: BlueprintRow[]) => rows.find((r) => r.status === 'published') ?? null;
const nextVersion = (rows: BlueprintRow[]) => rows.reduce((m, r) => Math.max(m, r.version), 0) + 1;

export type SaveResult =
  | { ok: true; version: number; created: boolean; issues: Issue[]; publishable: boolean }
  | { ok: false; status: 400 | 422; errors: string[] };

// Guarda el borrador (con avisos y errores de reglas: un borrador a medias SE PUEDE guardar, publicarlo es otra cosa).
export async function saveDraft(db: BlueprintDb, ctx: { classroomId: string; teacherId: string }, raw: unknown): Promise<SaveResult> {
  const rows = await db.list(ctx.classroomId);
  const draft = draftOf(rows);
  const version = draft ? draft.version : nextVersion(rows);
  const prepared = prepareBlueprint(raw, version);
  if (!prepared.ok) return prepared;
  if (draft) await db.updateDraft(draft.id, prepared.blueprint);
  else await db.insertDraft({ classroomId: ctx.classroomId, teacherId: ctx.teacherId, version, doc: prepared.blueprint });
  return { ok: true, version, created: !draft, issues: prepared.issues, publishable: isPublishable(prepared.issues) };
}

export type PublishResult =
  | { ok: true; version: number; archivedVersion: number | null; issues: Issue[] }
  | { ok: false; status: 404 | 422; error: string; issues?: Issue[] };

// Publica el borrador. Se vuelve a leer y a revisar lo GUARDADO (no se confia en que antes se haya revisado). Archivar el publicado anterior es lo primero (la base admite un solo publicado
// por clase) y no se puede deshacer: por eso todo se comprueba antes. Si la publicacion falla despues de archivar, reintentar publica sin problema (ya no hay publicado que archivar).
export async function publishDraft(db: BlueprintDb, ctx: { classroomId: string }): Promise<PublishResult> {
  const rows = await db.list(ctx.classroomId);
  const draft = draftOf(rows);
  if (!draft) return { ok: false, status: 404, error: 'No hay un borrador para publicar.' };
  const prepared = prepareBlueprint(draft.doc, draft.version);
  if (!prepared.ok) return { ok: false, status: 422, error: 'El borrador guardado no es valido.' };
  if (!isPublishable(prepared.issues)) return { ok: false, status: 422, error: 'El plan tiene errores que impiden publicarlo.', issues: prepared.issues };
  const current = publishedOf(rows);
  if (current) await db.archive(current.id);
  await db.publish(draft.id);
  return { ok: true, version: draft.version, archivedVersion: current ? current.version : null, issues: prepared.issues };
}
