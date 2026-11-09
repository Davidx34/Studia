// Doctrina pedagogica global (memoria global de «esencia»). Ver docs/IA_ARQUITECTURA_DE_MEMORIAS.md §6.
//
// Version: sube cada vez que cambia el contenido o las fuentes (queda en el registro de cada experimento).

import { ALL_PRINCIPLES } from './all';
import { SOURCES, shortCite } from './sources';
import type { Principle } from './types';

export const DOCTRINE_VERSION = '2026-11-v1';

export { ALL_PRINCIPLES, SOURCES, shortCite };
export * from './types';
export { PERSONA, traitsFor, personaLines } from './persona';
export type { Trait, TraitId } from './persona';
export { selectPrinciples, doctrineBlock, tagsForGeneration, MAX_BLOCK_CHARS, DEFAULT_MAX_PRINCIPLES } from './select';

/**
 * ¿La doctrina entra a los prompts? APAGADA por defecto: un cambio que altera lo que genera la IA solo se enciende (DOCTRINE=on) despues de que una medicion A/B diga «mejora»
 * (scripts/ab-generation.ts y src/lib/aiLearning/proportion.ts). Mostrarla al profesor no depende de esta variable.
 */
export function doctrineEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DOCTRINE?.trim().toLowerCase() === 'on';
}

export function getPrinciple(id: string): Principle | undefined {
  return ALL_PRINCIPLES.find((p) => p.id === id);
}

/** «Titulo (Autor año; Autor año)» para mostrar el fundamento de un principio. */
export function principleBasis(id: string): { title: string; cites: string[] } | null {
  const p = getPrinciple(id);
  return p ? { title: p.title, cites: p.sources.map(shortCite) } : null;
}
