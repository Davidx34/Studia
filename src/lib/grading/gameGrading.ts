import type { GradeResult } from './gradeAnswer';

// Calificacion en el servidor de los MINIJUEGOS (fase 4(a) de docs/PLAN_CALIFICACION_EN_SERVIDOR.md). Funciones puras, una por juego:
//   - sanitizeGameData: lo que viaja al navegador. Es una LISTA BLANCA: solo salen los campos que el juego necesita para mostrarse; la solucion y la explicacion se
//     quedan en el servidor (un campo nuevo que se agregue algun dia NO sale por accidente).
//   - gradeGame: compara lo que el estudiante eligio con la solucion.
//   - buildGameReveal: lo que se revela al cerrar la pregunta (la solucion, las consecuencias y la explicacion).
//
// Primera entrega: los cuatro juegos de "elegir una opcion" (impostor, alquimia, cuarto de crisis y juicio). Segunda: ordenar (linea del tiempo, con 3 intentos) y clasificar
// (categorias, con "sondeos" por elemento y 2 oportunidades de tiempo). Tercera: las cartas (memoria de pares) y el descifrador (palabra letra por letra), tambien con sondeos.
//
// SONDEO: una consulta que no cierra la pregunta, no gasta intentos y no escribe nada. Responde solo lo que el juego ya mostraba al instante (esta categoria es la del elemento,
// estas dos cartas coinciden, esta letra esta en la palabra y en que posiciones, la pista n). Lo que el servidor impide es DECLARAR un resultado sin haberlo logrado.

export const SERVER_GRADED_GAME_TYPES = [
  'impostor_cognitivo',
  'alquimia_conceptual',
  'cuarto_crisis',
  'juicio_conocimiento',
  'linea_del_tiempo',
  'categorias_rapidas',
  'flashcard_rapida',
  'el_descifrador',
] as const;

// El descifrador termina con 6 letras equivocadas (igual que el juego en el navegador).
export const DECIPHER_MAX_WRONG = 6;
// Las letras que cuenta el descifrador (mismo criterio que el juego al ocultar y mostrar la palabra).
const DECIPHER_LETTER = /[a-zA-ZÑñ]/;
// Ñ es una letra distinta de N; las demas se normalizan sin tilde.
export function letterKey(ch: string): string {
  const upper = ch.toUpperCase();
  if (upper === 'Ñ') return 'Ñ';
  return upper.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function decipherWord(gd: Obj): string {
  return str(gd.word_to_guess) ?? '';
}
function decipherTarget(word: string): Set<string> {
  return new Set(word.split('').filter((ch) => DECIPHER_LETTER.test(ch)).map(letterKey));
}

// Cartas: se sirven en un orden DETERMINISTA que no delata la pareja (un hash del texto), con una clave numerica = posicion en ese orden. Servir y sondear calculan el mismo orden
// a partir de los mismos datos, sin guardar nada. Las dos cartas de un par no quedan juntas ni en un patron.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
interface FlashCard {
  pairId: number;
  text: string;
}
function flashCards(gd: Obj): FlashCard[] | null {
  const pairs = list(gd.pairs);
  const ids = pairs.map((p) => num(p.id));
  if (pairs.length < 2 || ids.some((i) => i === undefined) || new Set(ids).size !== ids.length) return null;
  const flat: { pairId: number; text: string; order: number; h: number }[] = [];
  for (const p of pairs) {
    const a = str(p.card1);
    const b = str(p.card2);
    if (a === undefined || b === undefined) return null;
    const id = p.id as number;
    flat.push({ pairId: id, text: a, order: flat.length, h: fnv1a(`${id}:${a}`) });
    flat.push({ pairId: id, text: b, order: flat.length, h: fnv1a(`${id}:${b}`) });
  }
  return flat.sort((x, y) => x.h - y.h || x.order - y.order).map(({ pairId, text }) => ({ pairId, text }));
}
export const isGradedGameType = (t: unknown): boolean => typeof t === 'string' && (SERVER_GRADED_GAME_TYPES as readonly string[]).includes(t);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// Copia solo las claves de texto que existen.
function pickStrings(src: Obj, keys: string[]): Obj {
  const out: Obj = {};
  for (const k of keys) {
    const v = str(src[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function sanitizeGameData(type: string, gameData: unknown): Obj {
  const gd = isObj(gameData) ? gameData : {};
  switch (type) {
    case 'impostor_cognitivo':
      return {
        ...pickStrings(gd, ['context']),
        statements: list(gd.statements).map((s) => ({ id: num(s.id), text: str(s.text) ?? '' })),
      };
    case 'alquimia_conceptual':
      return {
        ...pickStrings(gd, ['fusion_title', 'element_a', 'element_b', 'alchemy_enigma']),
        bridge_options: list(gd.bridge_options).map((o) => ({ id: str(o.id) ?? '', text: str(o.text) ?? '' })),
      };
    case 'cuarto_crisis':
      return {
        ...pickStrings(gd, ['crisis_scenario']),
        telemetry_data: Array.isArray(gd.telemetry_data) ? gd.telemetry_data.filter((t): t is string => typeof t === 'string') : [],
        interventions: list(gd.interventions).map((iv) => ({ action_code: str(iv.action_code) ?? '', description: str(iv.description) ?? '' })),
      };
    case 'juicio_conocimiento':
      return {
        ...pickStrings(gd, ['case_file', 'cross_examination_tip']),
        expert_testimony: list(gd.expert_testimony).map((p) => ({ paragraph_id: num(p.paragraph_id), text: str(p.text) ?? '' })),
      };
    case 'linea_del_tiempo':
      return {
        ...pickStrings(gd, ['theme']),
        items: list(gd.items).map((it) => ({ id: num(it.id), text: str(it.text) ?? '', ...(str(it.year) ? { year: str(it.year) } : {}) })),
      };
    case 'categorias_rapidas':
      return {
        ...pickStrings(gd, ['theme']),
        categories: Array.isArray(gd.categories) ? gd.categories.filter((c): c is string => typeof c === 'string') : [],
        items: list(gd.items).map((it) => ({ id: num(it.id), text: str(it.text) ?? '' })),
        ...(num(gd.time_limit_seconds) !== undefined ? { time_limit_seconds: num(gd.time_limit_seconds) } : {}),
      };
    case 'flashcard_rapida': {
      const cards = flashCards(gd);
      return { ...pickStrings(gd, ['theme']), cards: (cards ?? []).map((c, key) => ({ key, text: c.text })) };
    }
    case 'el_descifrador': {
      const word = decipherWord(gd);
      return {
        ...pickStrings(gd, ['initial_clue']),
        // Letras ocultas (null); lo que no es letra (espacios, guiones, tildes) se muestra tal cual, como hacia el juego.
        mask: word.split('').map((ch) => (DECIPHER_LETTER.test(ch) ? null : ch)),
        // Las pistas se piden de a una (sondeo): no viajan todas juntas.
        hint_count: Array.isArray(gd.hints) ? gd.hints.filter((h) => typeof h === 'string').length : 0,
      };
    }
    default:
      return {};
  }
}

// `answer` por juego:
//   impostor_cognitivo   { selectedId: number }
//   alquimia_conceptual  { selectedId: string }
//   cuarto_crisis        { selectedCode: string | null }   (null = se acabo el tiempo)
//   juicio_conocimiento  { selectedParagraphId: number }
//   linea_del_tiempo     { order: number[] }                         (los id de los eventos en el orden que puso el jugador)
//   categorias_rapidas   { assignment: { [id]: categoria } }         (todos los elementos clasificados)  |  { timeout: true }  (se acabo el tiempo = intento fallido)
//   flashcard_rapida     { matches: [[clave, clave], ...] }           (todos los pares encontrados)
//   el_descifrador       { letters: string[] }                        (las letras que el jugador probo)
// Un solo intento. Si el juego no tiene ninguna opcion correcta, no se puede calificar ('invalid'): nunca se da por buena ni por mala una pregunta sin solucion.
export function gradeGame(type: string, gameData: unknown, answer: unknown): GradeResult {
  if (!isGradedGameType(type)) return { status: 'unsupported' };
  const gd = isObj(gameData) ? gameData : {};
  const a = isObj(answer) ? answer : null;
  if (!a) return { status: 'invalid' };

  switch (type) {
    case 'impostor_cognitivo': {
      const statements = list(gd.statements);
      const chosen = typeof a.selectedId === 'number' ? statements.find((s) => s.id === a.selectedId) : undefined;
      if (!chosen || !statements.some((s) => s.is_impostor === true)) return { status: 'invalid' };
      return { status: 'graded', correct: chosen.is_impostor === true };
    }
    case 'alquimia_conceptual': {
      const options = list(gd.bridge_options);
      const chosen = typeof a.selectedId === 'string' ? options.find((o) => o.id === a.selectedId) : undefined;
      if (!chosen || !options.some((o) => o.is_correct === true)) return { status: 'invalid' };
      return { status: 'graded', correct: chosen.is_correct === true };
    }
    case 'cuarto_crisis': {
      const interventions = list(gd.interventions);
      if (!interventions.some((iv) => iv.is_solution === true)) return { status: 'invalid' };
      // null: se acabo el tiempo = no contuvo la crisis.
      if (a.selectedCode === null) return { status: 'graded', correct: false };
      const chosen = typeof a.selectedCode === 'string' ? interventions.find((iv) => iv.action_code === a.selectedCode) : undefined;
      if (!chosen) return { status: 'invalid' };
      return { status: 'graded', correct: chosen.is_solution === true };
    }
    case 'juicio_conocimiento': {
      const paragraphs = list(gd.expert_testimony);
      const guilty = num(gd.guilty_paragraph_id);
      const chosen = typeof a.selectedParagraphId === 'number' ? paragraphs.find((p) => p.paragraph_id === a.selectedParagraphId) : undefined;
      if (!chosen || guilty === undefined) return { status: 'invalid' };
      return { status: 'graded', correct: chosen.paragraph_id === guilty };
    }
    case 'linea_del_tiempo': {
      const items = list(gd.items);
      // Sin solucion utilizable (posiciones repetidas o con huecos) no se puede calificar.
      const positions = items.map((it) => it.correct_position);
      const isPermutation =
        items.length > 0 &&
        positions.every((p) => typeof p === 'number') &&
        new Set(positions).size === items.length &&
        positions.every((p) => (p as number) >= 1 && (p as number) <= items.length);
      if (!isPermutation) return { status: 'invalid' };
      const order = Array.isArray(a.order) ? a.order : null;
      if (!order || order.length !== items.length || new Set(order).size !== order.length) return { status: 'invalid' };
      const placed = order.map((id) => items.find((it) => it.id === id));
      if (placed.some((it) => !it)) return { status: 'invalid' };
      const perSlot = placed.map((it, pos) => it!.correct_position === pos + 1);
      return { status: 'graded', correct: perSlot.every(Boolean), detail: { perSlot } };
    }
    case 'categorias_rapidas': {
      const items = list(gd.items);
      const categories = Array.isArray(gd.categories) ? gd.categories.filter((c): c is string => typeof c === 'string') : [];
      if (items.length === 0 || !items.every((it) => typeof it.correct_category === 'string' && categories.includes(it.correct_category))) return { status: 'invalid' };
      // Se acabo el tiempo: intento fallido (el servidor no vigila el reloj; el navegador lo avisa).
      if (a.timeout === true) return { status: 'graded', correct: false };
      const assignment = isObj(a.assignment) ? a.assignment : null;
      if (!assignment) return { status: 'invalid' };
      if (Object.keys(assignment).length !== items.length) return { status: 'invalid' };
      let all = true;
      for (const it of items) {
        const given = assignment[String(it.id)];
        if (typeof given !== 'string' || !categories.includes(given)) return { status: 'invalid' };
        if (given !== it.correct_category) all = false;
      }
      return { status: 'graded', correct: all };
    }
    case 'flashcard_rapida': {
      const cards = flashCards(gd);
      if (!cards) return { status: 'invalid' };
      // Solo se cierra con TODOS los pares encontrados y bien: el juego no tiene un final "perdido" (termina al encontrar el ultimo par).
      const matches = Array.isArray(a.matches) ? a.matches : null;
      if (!matches || matches.length !== cards.length / 2) return { status: 'invalid' };
      const used = new Set<number>();
      for (const m of matches) {
        if (!Array.isArray(m) || m.length !== 2) return { status: 'invalid' };
        const [x, y] = m;
        if (!Number.isInteger(x) || !Number.isInteger(y) || x === y || x < 0 || y < 0 || x >= cards.length || y >= cards.length || used.has(x) || used.has(y)) return { status: 'invalid' };
        used.add(x);
        used.add(y);
        if (cards[x].pairId !== cards[y].pairId) return { status: 'invalid' };
      }
      return { status: 'graded', correct: true };
    }
    case 'el_descifrador': {
      const target = decipherTarget(decipherWord(gd));
      if (target.size === 0) return { status: 'invalid' };
      if (!Array.isArray(a.letters)) return { status: 'invalid' };
      const played = new Set<string>();
      for (const l of a.letters) {
        if (typeof l !== 'string' || l.length !== 1) return { status: 'invalid' };
        const k = letterKey(l);
        if (!/^[A-ZÑ]$/.test(k)) return { status: 'invalid' };
        played.add(k);
      }
      const wrong = Array.from(played).filter((k) => !target.has(k)).length;
      const covered = Array.from(target).every((k) => played.has(k));
      if (covered && wrong < DECIPHER_MAX_WRONG) return { status: 'graded', correct: true };
      if (wrong >= DECIPHER_MAX_WRONG) return { status: 'graded', correct: false };
      // El juego no ha terminado (faltan letras y quedan intentos): todavia no se puede cerrar.
      return { status: 'invalid' };
    }
    default:
      return { status: 'unsupported' };
  }
}

// "Sondeo" de categorias: ¿esta categoria es la de este elemento? No cierra la pregunta ni gasta intentos (el juego da retroalimentacion inmediata en cada toque y no penaliza).
// Equivale a lo que el jugador descubriria por ensayo y error con el navegador; lo que el servidor impide es DECLARAR una clasificacion que no sea la correcta.
export type ProbeResult = { status: 'graded'; correct: boolean; data?: Obj } | { status: 'invalid' } | { status: 'unsupported' };

//   categorias_rapidas   { itemId, category }        -> correct
//   flashcard_rapida     { a, b }  (claves de carta) -> correct (coinciden)
//   el_descifrador       { letter }                  -> correct (esta en la palabra) + data { positions, chars }   |   { hint: n }  -> data { hint: texto }
export function probeGame(type: string, gameData: unknown, probe: unknown): ProbeResult {
  const gd = isObj(gameData) ? gameData : {};
  const p = isObj(probe) ? probe : null;
  if (!p) return isGradedGameType(type) ? { status: 'invalid' } : { status: 'unsupported' };

  switch (type) {
    case 'categorias_rapidas': {
      if (typeof p.itemId !== 'number' || typeof p.category !== 'string') return { status: 'invalid' };
      const item = list(gd.items).find((it) => it.id === p.itemId);
      const categories = Array.isArray(gd.categories) ? gd.categories : [];
      if (!item || typeof item.correct_category !== 'string' || !categories.includes(p.category)) return { status: 'invalid' };
      return { status: 'graded', correct: item.correct_category === p.category };
    }
    case 'flashcard_rapida': {
      const cards = flashCards(gd);
      if (!cards || !Number.isInteger(p.a) || !Number.isInteger(p.b) || p.a === p.b) return { status: 'invalid' };
      const a = cards[p.a as number];
      const b = cards[p.b as number];
      if (!a || !b) return { status: 'invalid' };
      return { status: 'graded', correct: a.pairId === b.pairId };
    }
    case 'el_descifrador': {
      const word = decipherWord(gd);
      if (typeof p.hint === 'number') {
        const hints = Array.isArray(gd.hints) ? gd.hints.filter((h): h is string => typeof h === 'string') : [];
        if (!Number.isInteger(p.hint) || p.hint < 0 || p.hint >= hints.length) return { status: 'invalid' };
        return { status: 'graded', correct: true, data: { hint: hints[p.hint] } };
      }
      if (typeof p.letter !== 'string' || p.letter.length !== 1) return { status: 'invalid' };
      const k = letterKey(p.letter);
      if (!/^[A-ZÑ]$/.test(k) || decipherTarget(word).size === 0) return { status: 'invalid' };
      const positions: number[] = [];
      const chars: string[] = [];
      word.split('').forEach((ch, i) => {
        if (DECIPHER_LETTER.test(ch) && letterKey(ch) === k) {
          positions.push(i);
          chars.push(ch);
        }
      });
      return { status: 'graded', correct: positions.length > 0, data: { positions, chars } };
    }
    default:
      return { status: 'unsupported' };
  }
}

export function buildGameReveal(type: string, gameData: unknown): Obj {
  const gd = isObj(gameData) ? gameData : {};
  switch (type) {
    case 'impostor_cognitivo':
      return {
        impostorIds: list(gd.statements).filter((s) => s.is_impostor === true).map((s) => s.id),
        explanation: str(gd.exposicion_del_impostor) ?? null,
      };
    case 'alquimia_conceptual':
      return {
        correctIds: list(gd.bridge_options).filter((o) => o.is_correct === true).map((o) => o.id),
        explanation: str(gd.unlocked_knowledge) ?? null,
      };
    case 'cuarto_crisis': {
      const ivs = list(gd.interventions);
      const consequences: Record<string, string> = {};
      for (const iv of ivs) if (typeof iv.action_code === 'string' && typeof iv.consequence === 'string') consequences[iv.action_code] = iv.consequence;
      return {
        solutionCodes: ivs.filter((iv) => iv.is_solution === true).map((iv) => iv.action_code),
        consequences,
        explanation: str(gd.post_mortem_report) ?? null,
      };
    }
    case 'juicio_conocimiento':
      return { guiltyParagraphId: num(gd.guilty_paragraph_id) ?? null, explanation: str(gd.verdict_explanation) ?? null };
    case 'linea_del_tiempo':
      return {
        correctOrder: list(gd.items)
          .filter((it) => typeof it.correct_position === 'number')
          .sort((x, y) => (x.correct_position as number) - (y.correct_position as number))
          .map((it) => it.id),
        explanation: str(gd.pedagogical_feedback) ?? null,
      };
    case 'categorias_rapidas': {
      const assignment: Record<string, string> = {};
      for (const it of list(gd.items)) if (typeof it.correct_category === 'string') assignment[String(it.id)] = it.correct_category;
      return { assignment, explanation: str(gd.pedagogical_feedback) ?? null };
    }
    case 'flashcard_rapida':
      return { explanation: str(gd.pedagogical_feedback) ?? null };
    case 'el_descifrador':
      return { word: decipherWord(gd), explanation: str(gd.pedagogical_feedback) ?? null };
    default:
      return {};
  }
}
