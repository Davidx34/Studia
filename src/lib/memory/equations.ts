// Busca ECUACIONES escritas en el texto de un material ("p_x * x + p_y * y = M") y las asocia al concepto del que hablan. Es una red de seguridad DETERMINISTA para la extraccion
// con IA: el modelo a veces describe un concepto pero se olvida de copiar su formula aunque el texto la traiga. Lo que se devuelve es siempre un fragmento LITERAL del texto
// (nunca algo que la IA invento). Sin red.

import { words } from './text';

const MAX_LEN = 200;
const PROSE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:-[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/;

// ¿Es una palabra de prosa (no parte de una formula)? Una letra sola (x, M) o siglas en mayusculas de hasta 4 letras (TMS, IT) si son simbolos.
function isProse(tok: string): boolean {
  const t = tok.replace(/[.,;:]+$/, '');
  if (!PROSE.test(t)) return false;
  if (t.length === 1) return false;
  if (/^[A-ZÁÉÍÓÚÑ]{2,4}$/.test(t)) return false;
  return true;
}

// Los trozos de un parrafo (frases), sin perder los signos.
function sentences(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  const parts = text.split(/([.;!?]\s+|\n+)/);
  for (const p of parts) {
    cur += p;
    if (/^([.;!?]\s+|\n+)$/.test(p)) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

// Dos operandos pegados sin operador entre medias ("a y") no son una ecuacion: la segunda es prosa ("... = m * a y nada mas").
const endsOperand = (t: string) => /[A-Za-z0-9)_]$/.test(t.replace(/[.,;:]+$/, ''));
const startsOperand = (t: string) => /^[A-Za-z0-9(_.]/.test(t);

// Las ecuaciones de UNA frase: el tramo de simbolos alrededor de cada "=".
export function equationsIn(sentence: string): string[] {
  const toks = sentence.split(/\s+/).filter((t) => t.length > 0);
  const found: string[] = [];
  const isMath = (t: string) => !isProse(t);
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].indexOf('=') === -1) continue;
    let a = i;
    let b = i;
    // Hacia la izquierda: hasta una palabra de prosa o un signo de puntuacion que cierra una clausula.
    while (a > 0 && isMath(toks[a - 1]) && !/[:;,]$/.test(toks[a - 1]) && !(startsOperand(toks[a]) && endsOperand(toks[a - 1]))) a--;
    // Hacia la derecha: hasta una palabra de prosa; un punto o coma final cierra la ecuacion.
    while (b < toks.length - 1 && !/[.,;:]$/.test(toks[b]) && isMath(toks[b + 1]) && !(endsOperand(toks[b]) && startsOperand(toks[b + 1]))) b++;
    const eq = toks
      .slice(a, b + 1)
      .join(' ')
      .replace(/[.,;:]+$/, '')
      .trim();
    // Una ecuacion tiene algo a cada lado del igual.
    const sides = eq.split('=');
    if (sides.length < 2 || sides.some((s) => s.trim().length === 0)) continue;
    if (eq.length > MAX_LEN || eq.length < 3) continue;
    if (found.indexOf(eq) === -1) found.push(eq);
    i = b;
  }
  return found;
}

// La ecuacion del texto que corresponde a un concepto: la que esta en una frase que menciona (al menos la mitad de las palabras de) el concepto.
export function findEquation(text: string, name: string): string | null {
  const ws = words(name);
  if (ws.length === 0) return null;
  const sents = sentences(text);
  const mentions = (s: string) => {
    const src = words(s);
    let hit = 0;
    ws.forEach((w) => {
      if (src.indexOf(w) !== -1) hit++;
    });
    return hit / ws.length;
  };
  let best: { eq: string; score: number } | null = null;
  for (let i = 0; i < sents.length; i++) {
    const eqs = equationsIn(sents[i]);
    if (eqs.length === 0) continue;
    // Solo cuenta la PROPIA frase de la ecuacion: una ecuacion de la frase siguiente suele ser de otro concepto, y una formula equivocada es peor que ninguna.
    const score = mentions(sents[i]);
    if (score >= 0.5 && (!best || score > best.score)) best = { eq: eqs[0], score };
  }
  return best ? best.eq : null;
}
