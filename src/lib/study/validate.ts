// Parseo y validacion de lo que devuelve el modelo. Sin aprobacion del profesor, la calidad depende de
// descartar con reglas objetivas: formato, longitudes, duplicados y que el contenido se APOYE EN EL MATERIAL.

export interface FichaCard {
  kind: 'ficha';
  front: string; // titulo
  back: string; // idea principal
  extra: { puntos_clave: string[]; terminos: { termino: string; definicion: string }[]; reflexion: string };
}

export interface FlashCard {
  kind: 'flashcard';
  front: string;
  back: string;
}

export interface GroupCards {
  ficha: FichaCard | null;
  flashcards: FlashCard[];
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

const FLASH_Q_MIN = 8;
const FLASH_A_MAX = 400;
export const MIN_GROUNDING = 0.4;

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function contentWords(s: string): string[] {
  return fold(s).match(/[a-z0-9]{4,}/g) ?? [];
}

// Que fraccion de las palabras significativas del texto aparece en el material fuente. Una respuesta inventada por
// el modelo (conocimiento propio, no del material) comparte pocas palabras con el.
export function groundedRatio(text: string, source: string): number {
  const words = contentWords(text);
  if (words.length === 0) return 1;
  const src = new Set(contentWords(source));
  let hit = 0;
  for (const w of words) {
    if (src.has(w) || src.has(w.replace(/es$/, '')) || src.has(w.replace(/s$/, '')) || src.has(w + 's') || src.has(w + 'es')) hit++;
  }
  return hit / words.length;
}

export function extractJsonObject(text: string): any | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const m = candidate.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  // Dentro de $...$ una barra simple es LaTeX, no un escape JSON: "\frac" se leeria como salto de pagina (\f) y
  // "\beta" como retroceso (\b) SIN dar error, asi que se doblan antes de parsear. Lo ya doblado no se toca.
  const math = m[0].replace(/\$[^$\n]*\$/g, (seg) => seg.replace(/(?<!\\)\\(?!\\)/g, '\\\\'));
  // Respaldo: barras sueltas fuera de formulas que rompen el JSON.
  return tryParse(math) ?? tryParse(m[0].replace(/\\(?!["\\/bfnrtu])/g, '\\\\'));
}

export function validateGroupCards(raw: any, source: string): GroupCards {
  const out: GroupCards = { ficha: null, flashcards: [] };
  if (!raw || typeof raw !== 'object') return out;

  const f = raw.ficha;
  if (f && typeof f === 'object') {
    const titulo = str(f.titulo, 120);
    const idea = str(f.idea_principal, 600);
    const puntos = (Array.isArray(f.puntos_clave) ? f.puntos_clave : []).map((p: unknown) => str(p, 250)).filter((p: string) => p.length >= 8).slice(0, 6);
    const terminos = (Array.isArray(f.terminos) ? f.terminos : [])
      .map((t: any) => ({ termino: str(t?.termino, 80), definicion: str(t?.definicion, 250) }))
      .filter((t: { termino: string; definicion: string }) => t.termino.length >= 2 && t.definicion.length >= 8)
      .slice(0, 6);
    const reflexion = str(f.pregunta_reflexion, 250);
    if (titulo.length >= 3 && idea.length >= 20 && puntos.length >= 2 && groundedRatio(`${idea} ${puntos.join(' ')}`, source) >= MIN_GROUNDING) {
      out.ficha = { kind: 'ficha', front: titulo, back: idea, extra: { puntos_clave: puntos, terminos, reflexion } };
    }
  }

  const seen = new Set<string>();
  for (const c of Array.isArray(raw.flashcards) ? raw.flashcards : []) {
    const q = str(c?.pregunta, 300);
    const a = str(c?.respuesta, FLASH_A_MAX);
    if (q.length < FLASH_Q_MIN || a.length < 3) continue;
    if (fold(a) === fold(q)) continue;
    const key = fold(q).replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) continue;
    // La respuesta debe apoyarse en el material (palabras en comun); si no, es conocimiento inventado del modelo.
    if (groundedRatio(a, source) < MIN_GROUNDING) continue;
    seen.add(key);
    out.flashcards.push({ kind: 'flashcard', front: q, back: a });
  }
  return out;
}
