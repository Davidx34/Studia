// JEV-2: COMPUERTA de generacion. Todo ejercicio que genera la IA pasa por selfGrade (src/lib/jev/selfGrade.ts) ANTES de guardarse en lesson_questions: si el propio calificador del
// servidor no le da el 100 % a la respuesta oficial, o hay otra opcion que tambien puntua, o los datos son contradictorios, el ejercicio se descarta y nunca llega a un estudiante.
//
// Reglas:
//   - Solo las FALLAS descartan. Los avisos (una respuesta de un caracter, dos definiciones iguales...) se conservan: son legitimos.
//   - Un tipo que el servidor no califica ('skip') se conserva (no hay nada que simular).
//   - Si la compuerta MISMA falla (no deberia: selfGrade nunca lanza) se conserva el ejercicio y se registra: una averia de la compuerta no debe dejar a la clase sin lecciones.
//   - Interruptor: JEV_GATE=off en el servidor la apaga sin desplegar codigo nuevo.
//   - Solo se registran el TIPO y el motivo; nunca el texto del enunciado ni de las respuestas.

import { selfGrade, type PlayableRow } from './selfGrade';

export interface GateRejection {
  type: string;
  failures: string[];
}

export interface GateResult<T> {
  kept: T[];
  rejected: GateRejection[];
  // Cuantos ejercicios conservados traen avisos.
  warned: number;
  // Cuantas veces fallo la compuerta misma (esos ejercicios se conservaron).
  errors: number;
}

export const gateEnabled = (env: Record<string, string | undefined> = process.env): boolean => env.JEV_GATE !== 'off';

export function gateGenerated<T extends PlayableRow>(questions: readonly T[], enabled: boolean = gateEnabled()): GateResult<T> {
  const out: GateResult<T> = { kept: [], rejected: [], warned: 0, errors: 0 };
  for (const q of questions) {
    if (!enabled) {
      out.kept.push(q);
      continue;
    }
    try {
      const r = selfGrade(q);
      if (r.status === 'fail') {
        out.rejected.push({ type: String(q?.type ?? 'desconocido'), failures: r.failures });
        continue;
      }
      if (r.warnings.length > 0) out.warned++;
      out.kept.push(q);
    } catch {
      out.errors++;
      out.kept.push(q);
    }
  }
  return out;
}

// Registro de lo descartado (sin contenido de la pregunta). `tag` distingue el camino: 'GENERATE' o 'REGENERATE'.
export function logGateResult(tag: string, context: Record<string, unknown>, result: GateResult<unknown>): void {
  if (result.errors > 0) console.error(`[JEV_GATE_ERROR:${tag}]`, { ...context, errors: result.errors });
  if (result.rejected.length === 0) return;
  console.warn(`[JEV_REJECTED:${tag}]`, {
    ...context,
    descartadas: result.rejected.length,
    conservadas: result.kept.length,
    detalle: result.rejected.map((r) => ({ type: r.type, motivo: r.failures[0] ?? '' })),
  });
}
