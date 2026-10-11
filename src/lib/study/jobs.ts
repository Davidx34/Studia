// Trabajos de generacion del material de estudio (fichas + flashcards, e infografias) de UN material.
//
// Los dispara el PROFESOR (los estudiantes solo ven lo ya hecho). Cada trabajo:
//   1. reclama el material de forma atomica (compare-and-set sobre started_at: dos peticiones no pueden ganar a la vez),
//   2. responde de inmediato y sigue en segundo plano (runInBackground),
//   3. deja en la tabla de estado el resultado Y el motivo si fallo o salio incompleto, para que el profesor lo lea.

import { groupChunks } from './grouping';
import { STALE_GENERATING_MS, RETRY_COOLDOWN_MS, WORK_BUDGET_MS } from './constants';
import { generateStudyCards, callStudyModel, type ModelCaller, type GeneratedCards } from './generate';
import { generateInfographics, infographicRow, type GeneratedInfographics } from './infographics';

export type JobKind = 'cards' | 'infographics';

export const JOBS = {
  cards: { table: 'study_card_generation', kinds: ['ficha', 'flashcard'] },
  infographics: { table: 'study_infographic_generation', kinds: ['infografia'] },
} as const;

export { STALE_GENERATING_MS, RETRY_COOLDOWN_MS, WORK_BUDGET_MS };

export type ClaimState =
  | { state: 'claimed' }
  | { state: 'ready'; cards: number }
  | { state: 'busy' }
  | { state: 'cooldown'; error: string };

// Reclamo atomico. force=true permite regenerar lo ya listo (el profesor lo pide a proposito).
export async function claimJob(admin: any, kind: JobKind, materialId: string, force: boolean, now: number = Date.now()): Promise<ClaimState> {
  const table = JOBS[kind].table;
  const { data: current } = await admin.from(table).select('*').eq('material_id', materialId).maybeSingle();

  if (current?.status === 'ready' && !force) return { state: 'ready', cards: current.card_count };
  if (current?.status === 'generating' && now - new Date(current.started_at).getTime() < STALE_GENERATING_MS) return { state: 'busy' };
  if (current?.status === 'failed' && current.finished_at && now - new Date(current.finished_at).getTime() < RETRY_COOLDOWN_MS) {
    return { state: 'cooldown', error: current.error ?? 'No se pudo generar.' };
  }

  const startedAt = new Date(now).toISOString();
  if (!current) {
    const { error } = await admin.from(table).insert({ material_id: materialId, status: 'generating', started_at: startedAt });
    return error ? { state: 'busy' } : { state: 'claimed' }; // si fallo, otra peticion lo reclamo primero
  }
  const { data: claimed } = await admin
    .from(table)
    .update({ status: 'generating', started_at: startedAt, finished_at: null, error: null })
    .eq('material_id', materialId)
    .eq('status', current.status)
    .eq('started_at', current.started_at)
    .select('material_id');
  return claimed && claimed.length > 0 ? { state: 'claimed' } : { state: 'busy' };
}

// ---------------------------------------------------------------- mensajes para el profesor

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

export interface FailureCounts {
  noResponse: number;
  rejected: number;
  skipped: number;
}

// Explica POR QUE fallaron los bloques, en lenguaje claro y con que hacer.
export function explainFailures(c: FailureCounts): string {
  const parts: string[] = [];
  if (c.noResponse > 0) parts.push('la IA no respondió (límite de uso o problema de conexión)');
  if (c.rejected > 0) parts.push('la IA respondió pero el contenido no se apoyaba en el material');
  if (c.skipped > 0) parts.push('se acabó el tiempo');
  if (parts.length === 0) return 'motivo desconocido';
  return parts.join('; ');
}

export function cardsFailureMessage(r: GeneratedCards, total: number): string {
  const why = explainFailures(r);
  const hint = r.noResponse > 0 ? ' Reintenta en unos minutos.' : r.rejected > 0 ? ' Reintenta; si se repite, revisa que el material tenga texto claro.' : ' Reintenta.';
  return `No se generó ninguna tarjeta (${plural(total, 'sección', 'secciones')} probadas): ${why}.${hint}`;
}

export function cardsPartialNote(r: GeneratedCards, total: number): string | null {
  if (r.groupsFailed === 0) return null;
  return `${r.groupsFailed} de ${plural(total, 'sección', 'secciones')} no se pudieron procesar: ${explainFailures(r)}.`;
}

export function infographicsFailureMessage(r: GeneratedInfographics): string {
  const why = explainFailures(r);
  return `No se generó ninguna infografía (${plural(r.groupsTried, 'sección', 'secciones')} probadas): ${why}. Reintenta en unos minutos.`;
}

export const NO_INFOGRAPHIC_FIT = 'Este material no tiene datos que se presten a una infografía (fechas, comparaciones, pasos o cifras).';

// ---------------------------------------------------------------- trabajo

async function finish(admin: any, kind: JobKind, materialId: string, patch: { status: 'ready' | 'failed'; card_count?: number; error?: string | null }) {
  await admin
    .from(JOBS[kind].table)
    .update({ status: patch.status, finished_at: new Date().toISOString(), card_count: patch.card_count ?? 0, error: patch.error ?? null })
    .eq('material_id', materialId);
}

export interface JobDeps {
  call?: ModelCaller;
  now?: () => number;
}

// Hace el trabajo de UN material. Nunca lanza: cualquier fallo queda escrito como "failed" con su motivo.
export async function runJob(admin: any, kind: JobKind, material: { id: string; display_name: string | null }, deps: JobDeps = {}): Promise<void> {
  const call = deps.call ?? callStudyModel;
  const now = deps.now ?? Date.now;
  const deadline = now() + WORK_BUDGET_MS;
  try {
    const { data: chunks } = await admin.from('material_chunks').select('chunk_index, content').eq('material_id', material.id).order('chunk_index');
    const groups = groupChunks(chunks ?? []);
    if (groups.length === 0) {
      await finish(admin, kind, material.id, { status: 'failed', error: 'El material no tiene texto suficiente para armar material de estudio.' });
      return;
    }
    const name = material.display_name ?? 'Material';

    if (kind === 'cards') {
      const r = await generateStudyCards(groups, name, call, 2, deadline);
      const rows = [
        ...r.fichas.map((c, i) => ({ material_id: material.id, kind: 'ficha' as const, section: c.section, position: i, front: c.front, back: c.back, extra: c.extra })),
        ...r.flashcards.map((c, i) => ({ material_id: material.id, kind: 'flashcard' as const, section: c.section, position: i, front: c.front, back: c.back, extra: {} })),
      ];
      if (rows.length === 0) {
        await finish(admin, kind, material.id, { status: 'failed', error: cardsFailureMessage(r, groups.length) });
        return;
      }
      // Reemplazo: lo anterior se borra SOLO cuando ya hay material nuevo valido (no queda un hueco si falla).
      await admin.from('study_cards').delete().eq('material_id', material.id).in('kind', ['ficha', 'flashcard']);
      const { error } = await admin.from('study_cards').insert(rows);
      if (error) {
        await finish(admin, kind, material.id, { status: 'failed', error: 'La IA respondió, pero no se pudieron guardar las tarjetas. Reintenta.' });
        return;
      }
      await finish(admin, kind, material.id, { status: 'ready', card_count: rows.length, error: cardsPartialNote(r, groups.length) });
      return;
    }

    const r = await generateInfographics(groups, name, call, 2, deadline);
    if (r.items.length === 0) {
      // Que el fragmento "no se preste" es una respuesta valida, no un error: se deja como listo y sin infografias.
      if (r.noResponse === 0 && r.rejected === 0 && r.skipped === 0) {
        await finish(admin, kind, material.id, { status: 'ready', card_count: 0, error: NO_INFOGRAPHIC_FIT });
        return;
      }
      await finish(admin, kind, material.id, { status: 'failed', error: infographicsFailureMessage(r) });
      return;
    }
    const rows = r.items.map((it, i) => infographicRow(material.id, it, i));
    await admin.from('study_cards').delete().eq('material_id', material.id).eq('kind', 'infografia');
    const { error } = await admin.from('study_cards').insert(rows);
    if (error) {
      await finish(admin, kind, material.id, { status: 'failed', error: 'La IA respondió, pero no se pudieron guardar las infografías. Reintenta.' });
      return;
    }
    const failed = r.noResponse + r.rejected + r.skipped;
    await finish(admin, kind, material.id, {
      status: 'ready',
      card_count: rows.length,
      error: failed > 0 ? `${failed} de ${plural(r.groupsTried, 'sección', 'secciones')} sin infografía: ${explainFailures(r)}.` : null,
    });
  } catch (e) {
    console.error(`[study/${kind}] error inesperado:`, e);
    await finish(admin, kind, material.id, { status: 'failed', error: 'Error inesperado al generar. Reintenta; si se repite, avisa al administrador.' }).catch(() => {});
  }
}
