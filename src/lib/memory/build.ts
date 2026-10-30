// Construccion de la memoria de una clase en segundo plano (la dispara el profesor). Es INCREMENTAL y se puede CONTINUAR:
//   - cada material guarda el hash de su contenido y que bloques ya se leyeron; si el hash no cambio, no se vuelve a llamar a la IA por lo ya leido;
//   - la funcion tiene un tope de tiempo: lo que no alcanza queda PENDIENTE (no "fallido") y la siguiente pasada continua donde se quedo;
//   - al final se fusionan todos los materiales y se escribe el grafo con una version nueva, junto con el progreso (cuantos bloques y materiales faltan).
// Usa la llave de servicio: quien llama debe haber comprobado ANTES que es el profesor dueño de la clase.

import { createHash } from 'crypto';
import { groupChunks } from '@/lib/study/grouping';
import { STALE_GENERATING_MS, RETRY_COOLDOWN_MS, WORK_BUDGET_MS } from '@/lib/study/constants';
import { extractMaterial, type ModelCaller } from './extract';
import { dice, materialTitle, normalizeKey, similarKeys } from './text';
import { mergeGraphs, type MaterialGraph } from './merge';
import { MEMORY_LIMITS, type Graph } from './types';

export type ClaimState = 'claimed' | 'busy' | 'cooldown';

// Hash estable del contenido de un material (orden por indice): si no cambia, no se vuelve a extraer.
export function hashChunks(chunks: { chunk_index: number; content: string }[]): string {
  const h = createHash('sha256');
  for (const c of [...chunks].sort((a, b) => a.chunk_index - b.chunk_index)) {
    h.update(String(c.chunk_index));
    h.update('\u0000');
    h.update(c.content);
    h.update('\u0001');
  }
  return h.digest('hex');
}

// Reclamo atomico: dos peticiones no pueden construir la misma memoria a la vez.
// Si el reclamo se logra, `startedAt` y `previous` (la fila tal como estaba; null si no habia) permiten DEVOLVERLO con releaseMemoryClaim.
export interface MemoryClaim {
  state: ClaimState;
  error?: string;
  startedAt?: string;
  previous?: { status: string; started_at: string | null; finished_at: string | null; error: string | null } | null;
}

export async function claimMemory(admin: any, classroomId: string, force: boolean, now: number = Date.now()): Promise<MemoryClaim> {
  const { data: current } = await admin.from('class_memory').select('status, started_at, finished_at, error').eq('classroom_id', classroomId).maybeSingle();
  const startedAt = new Date(now).toISOString();
  if (!current) {
    const { error } = await admin.from('class_memory').insert({ classroom_id: classroomId, status: 'building', started_at: startedAt });
    return error ? { state: 'busy' } : { state: 'claimed', startedAt, previous: null }; // si fallo, otra peticion se adelanto
  }
  if (current.status === 'building' && now - new Date(current.started_at).getTime() < STALE_GENERATING_MS) return { state: 'busy' };
  if (!force && current.status === 'failed' && current.finished_at && now - new Date(current.finished_at).getTime() < RETRY_COOLDOWN_MS) {
    return { state: 'cooldown', error: current.error ?? 'No se pudo construir la memoria.' };
  }
  const { data: claimed } = await admin
    .from('class_memory')
    .update({ status: 'building', started_at: startedAt, finished_at: null, error: null })
    .eq('classroom_id', classroomId)
    .eq('status', current.status)
    .eq('started_at', current.started_at)
    .select('classroom_id');
  if (!(claimed && claimed.length > 0)) return { state: 'busy' };
  return { state: 'claimed', startedAt, previous: { status: current.status, started_at: current.started_at ?? null, finished_at: current.finished_at ?? null, error: current.error ?? null } };
}

// Devuelve un reclamo que NO se llego a usar (por ejemplo, el profesor se paso de su limite de uso justo despues de reclamar): la fila vuelve a como estaba. Solo toca la fila si
// sigue siendo NUESTRO reclamo (mismo started_at y status 'building'); si otra peticion la tomo despues, no la pisa. Nunca lanza: en el peor caso el reclamo caduca solo.
export async function releaseMemoryClaim(admin: any, classroomId: string, claim: MemoryClaim): Promise<void> {
  if (claim.state !== 'claimed' || !claim.startedAt) return;
  try {
    const mine = admin.from('class_memory');
    if (claim.previous === null) {
      await mine.delete().eq('classroom_id', classroomId).eq('status', 'building').eq('started_at', claim.startedAt);
    } else if (claim.previous) {
      await mine.update({ status: claim.previous.status, started_at: claim.previous.started_at, finished_at: claim.previous.finished_at, error: claim.previous.error }).eq('classroom_id', classroomId).eq('status', 'building').eq('started_at', claim.startedAt);
    }
  } catch (e) {
    console.error('[memory/build] no se pudo devolver el reclamo:', e);
  }
}

// Encabezados genericos de un archivo que la IA a veces extrae como si fueran conceptos ("Introduccion", "Bibliografia"...). Solo claves exactas y poco mencionadas.
const GENERIC_HEADINGS = ['introduccion', 'indice', 'resumen', 'contenido', 'tabla-contenido', 'conclusion', 'conclusion', 'bibliografia', 'referencia', 'presentacion', 'glosario', 'anexo', 'portada', 'documento', 'pagina'];

// El nombre del documento ("Doc1_Mesopotamia_y_Egipto.docx") a veces entra como si fuera un concepto, y tambien encabezados genericos. Se quita el titulo SOLO si coincide
// (exacta o casi exactamente) y apenas se menciona en ese material (un articulo cuyo titulo ES el tema, como "Antiguo Egipto" en Wikipedia, se menciona muchas veces y se conserva).
export function withoutTitleConcept(graph: Graph, fileName: string): Graph {
  const titleKey = normalizeKey(materialTitle(fileName));
  const drop = graph.concepts
    .filter((c) => {
      if (GENERIC_HEADINGS.indexOf(c.key) !== -1 && c.mentions <= 3 && (c.kind === 'concepto' || c.kind === 'definicion')) return true;
      if (!titleKey) return false;
      const near = c.key === titleKey || dice(c.key, titleKey) >= 0.9 || similarKeys(c.key, titleKey, MEMORY_LIMITS.tokenSimilarity);
      return near && c.mentions <= 2;
    })
    .map((c) => c.key);
  if (drop.length === 0) return graph;
  return { concepts: graph.concepts.filter((c) => drop.indexOf(c.key) === -1), edges: graph.edges.filter((e) => drop.indexOf(e.from) === -1 && drop.indexOf(e.to) === -1) };
}

export interface BuildStats {
  concepts: number;
  edges: number;
  materials: number;
  // Leidos por completo.
  materialsRead: number;
  // Con algunos bloques leidos y otros pendientes.
  materialsPartial: number;
  // Todavia sin leer (se acabo el tiempo antes de llegar a ellos).
  materialsPending: number;
  // Se intento y la IA no respondio nada util.
  materialsFailed: number;
  groupsDone: number;
  groupsTotal: number;
  // Falta leer algo: el panel sigue pidiendo pasadas hasta completar (o hasta que ya no haya progreso).
  incomplete: boolean;
  reused: number;
  cyclesBroken: number;
  dropped: number;
  duplicatesMerged: number;
  duplicateCandidates: number;
}

// Mensaje para el profesor cuando la memoria quedo incompleta (null si esta completa).
export function buildWarning(s: Pick<BuildStats, 'materials' | 'materialsRead' | 'materialsFailed' | 'groupsDone' | 'groupsTotal' | 'incomplete'>): string | null {
  if (!s.incomplete) return null;
  const progress = `Leídos ${s.materialsRead} de ${s.materials} ${s.materials === 1 ? 'material' : 'materiales'} (${s.groupsDone} de ${s.groupsTotal} bloques).`;
  return s.materialsFailed > 0 ? `${progress} La IA no respondió en algunos bloques (límite de uso o conexión); vuelve a actualizar en unos minutos.` : `${progress} Falta leer el resto: se continúa desde donde quedó.`;
}

interface Known {
  status: string;
  content_hash: string;
  extraction: Graph;
  stats: { groups?: number; doneGroups?: number[] } | null;
}

export async function runMemoryBuild(admin: any, classroomId: string, call: ModelCaller, opts: { force?: boolean; now?: () => number } = {}): Promise<void> {
  const now = opts.now ?? Date.now;
  const started = now();
  const deadline = started + WORK_BUDGET_MS;
  try {
    const { data: materials } = await admin
      .from('teaching_materials')
      .select('id, display_name, filename')
      .eq('classroom_id', classroomId)
      .eq('processing_status', 'completed')
      .order('created_at');
    const list: { id: string; display_name: string | null; filename: string | null }[] = materials ?? [];

    const { data: existing } = await admin.from('class_memory_material').select('material_id, status, content_hash, extraction, stats').eq('classroom_id', classroomId);
    const known: Record<string, Known> = {};
    for (const r of existing ?? []) known[r.material_id] = r;

    const graphs: MaterialGraph[] = [];
    const t = { read: 0, partial: 0, pending: 0, failed: 0, groupsDone: 0, groupsTotal: 0, reused: 0 };
    let counted = 0;
    for (const m of list) {
      const { data: chunks } = await admin.from('material_chunks').select('chunk_index, content').eq('material_id', m.id).order('chunk_index').limit(2000);
      const rows: { chunk_index: number; content: string }[] = chunks ?? [];
      if (rows.length === 0) continue;
      counted++;
      const hash = hashChunks(rows);
      const groupsCount = groupChunks(rows, MEMORY_LIMITS.maxGroupsPerMaterial).length;
      const prev = known[m.id];
      const same = !!prev && prev.content_hash === hash;

      // Ya leido por completo y sin cambios.
      if (!opts.force && same && prev.status === 'ready') {
        graphs.push({ materialId: m.id, graph: withoutTitleConcept(prev.extraction, m.display_name ?? m.filename ?? '') });
        t.reused++;
        t.read++;
        t.groupsDone += groupsCount;
        t.groupsTotal += groupsCount;
        continue;
      }
      // Lo que ya se habia leido de ESTE mismo contenido (la lectura se continua, no se repite).
      const doneBefore = !opts.force && same && Array.isArray(prev.stats?.doneGroups) ? (prev.stats?.doneGroups as number[]) : [];
      const resume = doneBefore.length > 0 ? { extraction: prev.extraction, doneGroups: doneBefore } : null;

      // Se acabo el tiempo antes de llegar a este material: queda pendiente (no es un fallo).
      if (now() > deadline) {
        if (resume) graphs.push({ materialId: m.id, graph: withoutTitleConcept(prev.extraction, m.display_name ?? m.filename ?? '') });
        t.groupsDone += doneBefore.length;
        t.groupsTotal += groupsCount;
        if (doneBefore.length > 0) t.partial++;
        else t.pending++;
        continue;
      }

      const name = m.display_name ?? m.filename ?? 'Material';
      const startedAt = new Date(now()).toISOString();
      const r = await extractMaterial(rows, m.id, name, call, { deadline, now, resume });
      const complete = r.doneGroups.length === r.groups;
      t.groupsDone += r.doneGroups.length;
      t.groupsTotal += r.groups;
      if (complete) t.read++;
      else if (r.doneGroups.length > 0) t.partial++;
      else if (r.failedGroups > 0) t.failed++;
      else t.pending++;

      // Si no se pudo leer NADA, se conserva lo que ya se sabia de este material (aunque sea de una version anterior).
      const keepOld = r.doneGroups.length === 0 && !!prev?.extraction;
      await admin.from('class_memory_material').upsert(
        {
          material_id: m.id,
          classroom_id: classroomId,
          status: complete ? 'ready' : 'extracting',
          content_hash: hash,
          extraction: keepOld ? prev.extraction : r.extraction,
          stats: { groups: r.groups, doneGroups: r.doneGroups, failedGroups: r.failedGroups, skippedGroups: r.skippedGroups, rejected: r.rejected, relationsRejected: r.relationsRejected, concepts: r.extraction.concepts.length, profile: r.profile },
          error: complete ? null : r.failedGroups > 0 ? `La IA no respondió en ${r.failedGroups} de ${r.groups} bloques.` : `Quedan ${r.groups - r.doneGroups.length} de ${r.groups} bloques por leer.`,
          started_at: startedAt,
          finished_at: new Date(now()).toISOString(),
        },
        { onConflict: 'material_id' }
      );
      graphs.push({ materialId: m.id, graph: withoutTitleConcept(keepOld ? prev.extraction : r.extraction, name) });
    }

    const { graph, stats } = mergeGraphs(graphs);
    const incomplete = t.partial + t.pending + t.failed > 0;
    const full: BuildStats = {
      concepts: graph.concepts.length,
      edges: graph.edges.length,
      materials: counted,
      materialsRead: t.read,
      materialsPartial: t.partial,
      materialsPending: t.pending,
      materialsFailed: t.failed,
      groupsDone: t.groupsDone,
      groupsTotal: t.groupsTotal,
      incomplete,
      reused: t.reused,
      cyclesBroken: stats.cyclesBroken,
      dropped: stats.dropped,
      duplicatesMerged: stats.duplicatesMerged,
      duplicateCandidates: stats.duplicateCandidates,
    };
    const { data: prevMemory } = await admin.from('class_memory').select('version').eq('classroom_id', classroomId).maybeSingle();
    const nothing = graph.concepts.length === 0 && counted > 0 && incomplete;
    await admin
      .from('class_memory')
      .update({
        status: nothing ? 'failed' : 'ready',
        version: (prevMemory?.version ?? 0) + 1,
        graph,
        stats: full,
        built_at: new Date(now()).toISOString(),
        finished_at: new Date(now()).toISOString(),
        error: nothing ? 'No se pudo leer ningún material. Reintenta en unos minutos.' : buildWarning(full),
      })
      .eq('classroom_id', classroomId);
  } catch (e) {
    console.error('[memory] la construccion fallo:', e);
    await admin.from('class_memory').update({ status: 'failed', finished_at: new Date(now()).toISOString(), error: 'Error inesperado al construir la memoria.' }).eq('classroom_id', classroomId);
  }
}
