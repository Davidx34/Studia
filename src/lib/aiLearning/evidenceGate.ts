// COMPUERTA DE EVIDENCIA OBLIGATORIA (docs/IA_ARQUITECTURA_DE_MEMORIAS.md §15). Criterio del profesor: todo debe estar EXPLICITAMENTE en el material. Con el interruptor EVIDENCE_REQUIRED=on:
//   1. el prompt de generacion exige a la IA el campo `evidence` (frase literal del material que respalda la respuesta);
//   2. solo se conservan las preguntas clasicas cuya evidencia es una cita literal (tolerante a LaTeX) del CONTEXTO que recibio el generador; el resto se descarta antes de guardar;
//   3. la cita verificada se guarda en la pregunta (columnas evidence / evidence_status, migracion 104) para que el profesor la vea al revisar.
// Apagado por defecto: con el interruptor apagado NADA cambia (ni el prompt, ni lo que se descarta, ni las columnas que se escriben). Costo medido en el bucle local: se descarta ~44 % de lo generado.
// Los minijuegos quedan fuera (su contenido vive en game_data y no tiene una sola frase de respaldo): se conservan como siempre.
import { EVIDENCE_PROMPT_BLOCK, compactOf, evidenceStatus, indexForQuotes } from './evidence';

export const CLASSIC_TYPES = new Set(['multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'match']);
export const MAX_EVIDENCE_CHARS = 800;

export const evidenceRequired = (env: Record<string, string | undefined> = process.env): boolean => env.EVIDENCE_REQUIRED?.trim().toLowerCase() === 'on';

/** Agrega al bloque de reglas del prompt la regla de evidencia, solo si el interruptor esta encendido. */
export function withEvidenceBlock(block: string, env: Record<string, string | undefined> = process.env): string {
  if (!evidenceRequired(env)) return block;
  return [block, EVIDENCE_PROMPT_BLOCK].filter(Boolean).join('\n\n');
}

export interface EvidenceGateResult {
  kept: any[];
  dropped: number;
  droppedNoEvidence: number;
  droppedNotLiteral: number;
  droppedFragment?: number;
  droppedDuplicate?: number;
}

const toks = (s: string) => new Set(s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length >= 4));
/** Solapamiento de contenido entre dos citas (Jaccard sobre palabras de 4+ letras). */
export function citasSolapadas(a: string, b: string, umbral = 0.6): boolean {
  const A = toks(a), B = toks(b);
  if (!A.size || !B.size) return false;
  let i = 0;
  for (const t of A) if (B.has(t)) i++;
  return i / (A.size + B.size - i) >= umbral;
}
/** Enunciado o definicion que termina en dos puntos: fragmento de diapositiva cortado. */
export function esFragmentoCortado(q: any): boolean {
  const fin = (s: unknown) => typeof s === 'string' && /:\s*["»”)?]*\s*$/.test(s.trim());
  return fin(q?.q) || (Array.isArray(q?.pairs) && q.pairs.some((p: any) => fin(p?.def)));
}

/** Con el interruptor apagado devuelve todo sin tocar. Encendido: conserva minijuegos y clasicas con cita literal verificada en `context`; el resto se descarta. */
export function gateEvidence(questions: any[], context: string, env: Record<string, string | undefined> = process.env): EvidenceGateResult {
  if (!evidenceRequired(env)) return { kept: questions, dropped: 0, droppedNoEvidence: 0, droppedNotLiteral: 0 };
  const norm = indexForQuotes([context ?? '']);
  const compact = compactOf(norm);
  const kept: any[] = [];
  let droppedNoEvidence = 0;
  let droppedNotLiteral = 0;
  let droppedFragment = 0;
  let droppedDuplicate = 0;
  const citas: string[] = [];
  for (const q of questions) {
    if (!CLASSIC_TYPES.has(q?.type)) {
      kept.push(q);
      continue;
    }
    const st = evidenceStatus(q, norm, compact);
    if (st === 'verificada') {
      if (esFragmentoCortado(q)) droppedFragment++;
      else if (citas.some((c) => citasSolapadas(c, q.evidence))) droppedDuplicate++;
      else {
        citas.push(q.evidence);
        kept.push(q);
      }
    } else if (st === 'sin_evidencia') droppedNoEvidence++;
    else droppedNotLiteral++;
  }
  return { kept, dropped: droppedNoEvidence + droppedNotLiteral + droppedFragment + droppedDuplicate, droppedNoEvidence, droppedNotLiteral, droppedFragment, droppedDuplicate };
}

/** Campos de evidencia para guardar en la base: SOLO con el interruptor encendido (si esta apagado no se escribe nada, asi la base sigue funcionando sin la migracion 104). */
export function evidenceColumns(q: any, env: Record<string, string | undefined> = process.env): { evidence?: string | null; evidence_status?: 'verified' | null } {
  if (!evidenceRequired(env)) return {};
  const e = typeof q?.evidence === 'string' && q.evidence.trim() ? q.evidence.trim().slice(0, MAX_EVIDENCE_CHARS) : null;
  return { evidence: e, evidence_status: e ? 'verified' : null };
}

/** La evidencia NUNCA llega al estudiante (contiene la respuesta): se quita de lo que se sirve. */
export function stripEvidence<T extends Record<string, any>>(q: T): Omit<T, 'evidence' | 'evidence_status'> {
  const { evidence: _e, evidence_status: _s, ...rest } = q as any;
  return rest;
}
