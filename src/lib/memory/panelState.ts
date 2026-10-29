// Estado de la memoria tal como lo muestra el panel del profesor. Sin React ni red.

import { STALE_GENERATING_MS } from '@/lib/study/constants';
import type { Concept, ConceptKind } from './types';
import { CONCEPT_KINDS } from './types';

export interface MemorySummary {
  // 'none': aun no se ha construido (o la migracion no esta aplicada).
  status: 'none' | 'building' | 'ready' | 'failed';
  version: number;
  builtAt: string | null;
  startedAt: string | null;
  error: string | null;
  stats: { concepts?: number; edges?: number; materials?: number; materialsFailed?: number; reused?: number } | null;
}

export const NO_MEMORY: MemorySummary = { status: 'none', version: 0, builtAt: null, startedAt: null, error: null, stats: null };

// Una construccion "en curso" mas vieja que esto se considera caida (la funcion se corto).
export function isStale(s: MemorySummary, now: number): boolean {
  return s.status === 'building' && !!s.startedAt && now - new Date(s.startedAt).getTime() >= STALE_GENERATING_MS;
}

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger';

export function headline(s: MemorySummary, now: number): { tone: Tone; text: string } {
  if (s.status === 'none') return { tone: 'neutral', text: 'Todavía no hay memoria de esta clase. Constrúyela para que la IA conozca tus materiales.' };
  if (isStale(s, now)) return { tone: 'warn', text: 'La construcción se interrumpió. Vuelve a intentarlo.' };
  if (s.status === 'building') return { tone: 'neutral', text: 'La IA está leyendo tus materiales… puede tardar un par de minutos.' };
  if (s.status === 'failed') return { tone: 'danger', text: s.error ?? 'No se pudo construir la memoria.' };
  const n = s.stats?.concepts ?? 0;
  if (n === 0) return { tone: 'warn', text: 'La memoria está vacía: los materiales no tienen conceptos que la IA pueda extraer. Sube un material con texto explicativo.' };
  const base = `La IA conoce ${n} ${n === 1 ? 'concepto' : 'conceptos'} de esta clase.`;
  return s.error ? { tone: 'warn', text: `${base} ${s.error}` } : { tone: 'ok', text: base };
}

// Los conceptos agrupados por tipo, en un orden fijo y del mas importante al menos.
export function groupConcepts(concepts: Concept[]): { kind: ConceptKind; items: Concept[] }[] {
  return CONCEPT_KINDS.map((kind) => ({
    kind,
    items: concepts.filter((c) => c.kind === kind).sort((a, b) => b.importance - a.importance || b.mentions - a.mentions || (a.name < b.name ? -1 : 1)),
  })).filter((g) => g.items.length > 0);
}
