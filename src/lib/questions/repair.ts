// REPARACION de preguntas rechazadas: cuando el juez rechaza (o manda a revision) una pregunta, se vuelven a pedir SOLO las que faltan, diciendole al
// generador cuales fallaron y por que. Es la palanca que mas puede subir el porcentaje de acierto sin cambiar de modelo: el generador no repite el mismo
// error y se le recuerda que verifique cada dato antes de escribirlo. Funciones puras (sin red), para poder probarlas.

export interface RejectedQuestion {
  q: { type?: string; q?: string; [k: string]: unknown };
  reason: string;
}

const clip = (s: unknown, n: number): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Resumen corto de una pregunta (enunciado + lo esencial de su contenido) para que el generador reconozca el error sin repetir un texto largo.
export function describeQuestion(q: RejectedQuestion['q']): string {
  const any = q as any;
  const detail = any.game_data ?? any.pairs ?? any.opts ?? any.answers;
  const body = detail === undefined || detail === null ? '' : clip(JSON.stringify(detail), any.game_data ? 160 : 140);
  return `[${q.type ?? '?'}] ${clip(q.q, 140)}${body ? ` | ${body}` : ''}`;
}

// Bloque de correcciones para anadir al prompt de generacion. Maximo 8 ejemplos: mas alarga el prompt sin ensenar mas.
export function repairFeedbackBlock(rejected: RejectedQuestion[], max = 8): string {
  const shown = rejected.slice(0, max);
  const lines = shown.map((r, i) => `${i + 1}. ${describeQuestion(r.q)}\n   MOTIVO: ${clip(r.reason, 220)}`).join('\n');
  return `CORRECCIONES OBLIGATORIAS. Un revisor experto RECHAZO estas preguntas de un intento anterior. NO las repitas ni cometas el mismo error:
${lines}

Antes de escribir CADA pregunta, verifica TU MISMO que la respuesta marcada es correcta segun el conocimiento establecido de la materia, y que las definiciones y formulas que uses son exactas. Usa SOLO conceptos de los que estes seguro; si dudas de un dato, elige otro concepto del material. No hagas preguntas que dependan de un video, una imagen o "el texto anterior". Genera preguntas NUEVAS y distintas a las rechazadas.`;
}
