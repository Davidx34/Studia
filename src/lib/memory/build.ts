// Construccion de la memoria de una clase en segundo plano (la dispara el profesor). Es INCREMENTAL: cada material guarda el hash de su contenido y solo se vuelve a leer con la
// IA el que cambio; despues se fusionan todos y se escribe el grafo con una version nueva. Deja el motivo si algo fallo o quedo incompleto. Usa la llave de servicio: quien llama
// debe haber comprobado ANTES que es el profesor dueño de la clase.

import { createHash } from 'crypto';
import { STALE_GENERATING_MS, RETRY_COOLDOWN_MS, WORK_BUDGET_MS } from '@/lib/study/constants';
import { extractMaterial, type ModelCaller } from './extract';
import { mergeGraphs, type MaterialGraph } from './merge';
import type { Graph } from './types';

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
export async function claimMemory(admin: any, classroomId: string, force: boolean, now: number = Date.now()): Promise<{ state: ClaimState; error?: string }> {
  const { data: current } = await admin.from('class_memory').select('status, started_at, finished_at, error').eq('classroom_id', classroomId).maybeSingle();
  const startedAt = new Date(now).toISOString();
  if (!current) {
    const { error } = await admin.from('class_memory').insert({ classroom_id: classroomId, status: 'building', started_at: startedAt });
    return { state: error ? 'busy' : 'claimed' }; // si fallo, otra peticion se adelanto
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
  return { state: claimed && claimed.length > 0 ? 'claimed' : 'busy' };
}

export interface BuildStats {
  concepts: number;
  edges: number;
  materials: number;
  materialsFailed: number;
  reused: number;
  cyclesBroken: number;
  dropped: number;
}

// Mensaje para el profesor cuando la memoria quedo incompleta (null si todo salio bien).
export function buildWarning(s: Pick<BuildStats, 'materials' | 'materialsFailed'>): string | null {
  if (s.materialsFailed === 0) return null;
  return `${s.materialsFailed} de ${s.materials} ${s.materials === 1 ? 'material' : 'materiales'} no se pudo leer del todo (límite de uso de la IA, o el texto no se entiende). Vuelve a actualizar en unos minutos.`;
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

    const { data: existing } = await admin.from('class_memory_material').select('material_id, status, content_hash, extraction').eq('classroom_id', classroomId);
    const known: Record<string, { status: string; content_hash: string; extraction: Graph }> = {};
    for (const r of existing ?? []) known[r.material_id] = r;

    const graphs: MaterialGraph[] = [];
    let failed = 0;
    let reused = 0;
    for (const m of list) {
      const { data: chunks } = await admin.from('material_chunks').select('chunk_index, content').eq('material_id', m.id).order('chunk_index').limit(2000);
      const rows: { chunk_index: number; content: string }[] = chunks ?? [];
      if (rows.length === 0) continue;
      const hash = hashChunks(rows);
      const prev = known[m.id];
      if (!opts.force && prev && prev.status === 'ready' && prev.content_hash === hash) {
        graphs.push({ materialId: m.id, graph: prev.extraction });
        reused++;
        continue;
      }
      const name = m.display_name ?? m.filename ?? 'Material';
      const startedAt = new Date(now()).toISOString();
      const result = await extractMaterial(rows, m.id, name, call, { deadline, now });
      // Si NINGUN bloque se pudo leer, es un fallo (no una memoria vacia): se conserva lo anterior si lo habia.
      const unreadable = result.groups > 0 && result.failedGroups === result.groups;
      const partial = result.failedGroups > 0;
      if (unreadable) {
        failed++;
        await admin.from('class_memory_material').upsert(
          { material_id: m.id, classroom_id: classroomId, status: 'failed', content_hash: hash, extraction: prev?.extraction ?? { concepts: [], edges: [] }, error: 'La IA no pudo leer este material.', started_at: startedAt, finished_at: new Date(now()).toISOString() },
          { onConflict: 'material_id' }
        );
        if (prev?.extraction) graphs.push({ materialId: m.id, graph: prev.extraction });
        continue;
      }
      if (partial) failed++;
      // Un material leido a medias se guarda con el hash de "incompleto" para reintentarse la proxima vez.
      await admin.from('class_memory_material').upsert(
        {
          material_id: m.id,
          classroom_id: classroomId,
          status: partial ? 'failed' : 'ready',
          content_hash: hash,
          extraction: result.extraction,
          stats: { groups: result.groups, failedGroups: result.failedGroups, rejected: result.rejected, concepts: result.extraction.concepts.length },
          error: partial ? `Solo se leyeron ${result.groups - result.failedGroups} de ${result.groups} bloques.` : null,
          started_at: startedAt,
          finished_at: new Date(now()).toISOString(),
        },
        { onConflict: 'material_id' }
      );
      graphs.push({ materialId: m.id, graph: result.extraction });
    }

    const { graph, stats } = mergeGraphs(graphs);
    const full: BuildStats = { concepts: graph.concepts.length, edges: graph.edges.length, materials: list.length, materialsFailed: failed, reused, cyclesBroken: stats.cyclesBroken, dropped: stats.dropped };
    const { data: prevMemory } = await admin.from('class_memory').select('version').eq('classroom_id', classroomId).maybeSingle();
    const nothing = graph.concepts.length === 0 && list.length > 0;
    await admin
      .from('class_memory')
      .update({
        status: nothing && failed > 0 ? 'failed' : 'ready',
        version: (prevMemory?.version ?? 0) + 1,
        graph,
        stats: full,
        built_at: new Date(now()).toISOString(),
        finished_at: new Date(now()).toISOString(),
        error: nothing && failed > 0 ? 'No se pudo leer ningún material. Reintenta en unos minutos.' : buildWarning(full),
      })
      .eq('classroom_id', classroomId);
  } catch (e) {
    console.error('[memory] la construccion fallo:', e);
    await admin.from('class_memory').update({ status: 'failed', finished_at: new Date(now()).toISOString(), error: 'Error inesperado al construir la memoria.' }).eq('classroom_id', classroomId);
  }
}
