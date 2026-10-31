import type { GradeResult } from './gradeAnswer';

// Calificacion en el servidor de los MINIJUEGOS (fase 4(a) de docs/PLAN_CALIFICACION_EN_SERVIDOR.md). Funciones puras, una por juego:
//   - sanitizeGameData: lo que viaja al navegador. Es una LISTA BLANCA: solo salen los campos que el juego necesita para mostrarse; la solucion y la explicacion se
//     quedan en el servidor (un campo nuevo que se agregue algun dia NO sale por accidente).
//   - gradeGame: compara lo que el estudiante eligio con la solucion.
//   - buildGameReveal: lo que se revela al cerrar la pregunta (la solucion, las consecuencias y la explicacion).
//
// Primera entrega: los cuatro juegos de "elegir una opcion" (impostor, alquimia, cuarto de crisis y juicio). Los de ordenar, clasificar, emparejar cartas y descifrar
// necesitan otra interaccion con el servidor y van aparte.

export const SERVER_GRADED_GAME_TYPES = ['impostor_cognitivo', 'alquimia_conceptual', 'cuarto_crisis', 'juicio_conocimiento'] as const;
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
    default:
      return {};
  }
}

// `answer` por juego:
//   impostor_cognitivo   { selectedId: number }
//   alquimia_conceptual  { selectedId: string }
//   cuarto_crisis        { selectedCode: string | null }   (null = se acabo el tiempo)
//   juicio_conocimiento  { selectedParagraphId: number }
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
    default:
      return {};
  }
}
