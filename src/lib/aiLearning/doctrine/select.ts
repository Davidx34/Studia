// Seleccion de principios por tarea y contexto. DETERMINISTA (mismo contexto, mismos principios) y con presupuesto de tamano: la doctrina es extensa, pero cada tarea recibe solo los pocos principios
// que le tocan. Los principios de evidencia «discutida» y los mitos NUNCA entran a un prompt como regla: solo se muestran al profesor.

import { personaLines } from './persona';
import { ALL_PRINCIPLES } from './all';
import type { Evidence, Principle, Task } from './types';

const WEIGHT: Record<Evidence, number> = { fuerte: 3, moderada: 2, limitada: 1, discutida: 0 };

export const DEFAULT_MAX_PRINCIPLES = 5;
export const MAX_BLOCK_CHARS = 1400;

export interface SelectInput {
  task: Task;
  /** Etiquetas del contexto (tipo de pregunta, nivel, situacion). Cada coincidencia pesa mas que la evidencia. */
  tags?: string[];
  max?: number;
}

export function selectPrinciples({ task, tags = [], max = DEFAULT_MAX_PRINCIPLES }: SelectInput): Principle[] {
  const wanted = new Set(tags);
  return ALL_PRINCIPLES.filter((p) => !p.antiPrinciple && p.evidence !== 'discutida' && p.tasks.includes(task))
    .map((p) => ({ p, score: 10 * p.tags.filter((t) => wanted.has(t)).length + WEIGHT[p.evidence] }))
    .sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id))
    .slice(0, Math.max(0, max))
    .map((x) => x.p);
}

/** Etiquetas de contexto para generar preguntas, a partir de los tipos pedidos y la profundidad (1 a 5) de la clase. */
export function tagsForGeneration(questionTypes: readonly string[], depth?: number): string[] {
  const tags = new Set<string>(['enunciado', 'clave', 'anclaje', 'verificar']);
  for (const t of questionTypes) {
    if (t === 'multiple_choice') ['opcion_multiple', 'una_correcta', 'distractores'].forEach((x) => tags.add(x));
    else if (t === 'true_false') tags.add('verdadero_falso');
    else if (t === 'fill_blank') ['completar', 'respuesta_corta', 'verificable'].forEach((x) => tags.add(x));
    else if (t === 'short_answer') ['respuesta_corta', 'verificable'].forEach((x) => tags.add(x));
    else if (t === 'match') ['emparejar', 'relaciones', 'clasificar'].forEach((x) => tags.add(x));
  }
  if ((depth ?? 0) >= 4) ['nivel_alto', 'aplicar', 'profundidad'].forEach((x) => tags.add(x));
  return Array.from(tags);
}

export interface BlockInput extends SelectInput {
  /** Incluir las conductas del perfil operacional de la tarea (por defecto si). */
  persona?: boolean;
}

/**
 * Bloque de prompt: criterios pedagogicos (solo la regla operativa de cada principio, SIN citas: las citas no hacen mejor al modelo y pueden inducir referencias inventadas) + conductas del perfil.
 * Devuelve '' si no hay nada que decir. Nunca pasa de MAX_BLOCK_CHARS.
 */
export function doctrineBlock(input: BlockInput): string {
  const lines: string[] = [];
  let size = 0;
  const push = (l: string) => {
    if (size + l.length + 1 > MAX_BLOCK_CHARS) return false;
    lines.push(l);
    size += l.length + 1;
    return true;
  };
  const chosen = selectPrinciples(input);
  const rules = chosen.map((p) => `- ${p.apply}${p.avoid ? ` ${p.avoid}` : ''}`);
  const persona = input.persona === false ? [] : personaLines(input.task).map((l) => `- ${l}`);
  if (rules.length === 0 && persona.length === 0) return '';
  push('CRITERIOS PEDAGÓGICOS DE REFERENCIA (investigación educativa; no contradicen el material ni las instrucciones anteriores):');
  for (const r of rules) if (!push(r)) break;
  if (persona.length) {
    push('CONDUCTA ESPERADA:');
    for (const l of persona) if (!push(l)) break;
  }
  return lines.join('\n');
}

