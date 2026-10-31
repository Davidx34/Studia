import type { GradeResult } from './gradeAnswer';

// Calificacion en el servidor de los MINIJUEGOS (fase 4(a) de docs/PLAN_CALIFICACION_EN_SERVIDOR.md). Funciones puras, una por juego:
//   - sanitizeGameData: lo que viaja al navegador. Es una LISTA BLANCA: solo salen los campos que el juego necesita para mostrarse; la solucion y la explicacion se
//     quedan en el servidor (un campo nuevo que se agregue algun dia NO sale por accidente).
//   - gradeGame: compara lo que el estudiante eligio con la solucion.
//   - buildGameReveal: lo que se revela al cerrar la pregunta (la solucion, las consecuencias y la explicacion).
//
// Primera entrega: los cuatro juegos de "elegir una opcion" (impostor, alquimia, cuarto de crisis y juicio). Segunda: ordenar (linea del tiempo, con 3 intentos) y clasificar
// (categorias, con "sondeos" por elemento y 2 oportunidades de tiempo). Quedan emparejar cartas y descifrar, que necesitan otra interaccion con el servidor.

export const SERVER_GRADED_GAME_TYPES = ['impostor_cognitivo', 'alquimia_conceptual', 'cuarto_crisis', 'juicio_conocimiento', 'linea_del_tiempo', 'categorias_rapidas'] as const;
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
    default:
      return { status: 'unsupported' };
  }
}

// "Sondeo" de categorias: ¿esta categoria es la de este elemento? No cierra la pregunta ni gasta intentos (el juego da retroalimentacion inmediata en cada toque y no penaliza).
// Equivale a lo que el jugador descubriria por ensayo y error con el navegador; lo que el servidor impide es DECLARAR una clasificacion que no sea la correcta.
export function probeGame(type: string, gameData: unknown, probe: unknown): GradeResult {
  if (type !== 'categorias_rapidas') return { status: 'unsupported' };
  const gd = isObj(gameData) ? gameData : {};
  const p = isObj(probe) ? probe : null;
  if (!p || typeof p.itemId !== 'number' || typeof p.category !== 'string') return { status: 'invalid' };
  const item = list(gd.items).find((it) => it.id === p.itemId);
  const categories = Array.isArray(gd.categories) ? gd.categories : [];
  if (!item || typeof item.correct_category !== 'string' || !categories.includes(p.category)) return { status: 'invalid' };
  return { status: 'graded', correct: item.correct_category === p.category };
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
    default:
      return {};
  }
}
