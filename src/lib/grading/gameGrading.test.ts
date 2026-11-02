import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SERVER_GRADED_GAME_TYPES, buildGameReveal, gradeGame, isGradedGameType, DECIPHER_MAX_WRONG, probeGame, sanitizeGameData } from './gameGrading';
import { sanitizeQuestion, serverGradingGamesEnabled } from './serverGrading';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

// Datos de juego con la forma que produce normalizeGeneratedQuestion (cohereGeneration.ts), mas un campo "secreto" que nadie deberia ver.
const IMPOSTOR = {
  context: 'Sobre la fotosintesis',
  statements: [
    { id: 1, text: 'Ocurre en los cloroplastos', is_impostor: false },
    { id: 2, text: 'Produce oxigeno', is_impostor: false },
    { id: 3, text: 'Ocurre en las mitocondrias', is_impostor: true },
  ],
  exposicion_del_impostor: 'La fotosintesis ocurre en los cloroplastos, no en las mitocondrias.',
  campo_secreto: 'NO-DEBE-SALIR',
};
const ALQUIMIA = {
  fusion_title: 'Oferta y demanda',
  element_a: 'Oferta',
  element_b: 'Precio',
  alchemy_enigma: 'Que une ambos?',
  bridge_options: [
    { id: 'X', text: 'El equilibrio de mercado', is_correct: true },
    { id: 'Y', text: 'La inflacion', is_correct: false },
    { id: 'Z', text: 'El monopolio', is_correct: false },
  ],
  unlocked_knowledge: 'El precio de equilibrio iguala oferta y demanda.',
  campo_secreto: 'NO-DEBE-SALIR',
};
const CRISIS = {
  crisis_scenario: 'El reactor se sobrecalienta',
  telemetry_data: ['Temperatura 900', 'Presion alta', 'Flujo bajo'],
  interventions: [
    { action_code: 'ALPHA', description: 'Insertar barras de control', is_solution: true, consequence: 'Crisis evitada: las barras absorben neutrones.' },
    { action_code: 'BETA', description: 'Esperar', is_solution: false, consequence: 'Colapso diferido.' },
    { action_code: 'GAMMA', description: 'Apagar el refrigerante', is_solution: false, consequence: 'Explosion.' },
  ],
  post_mortem_report: 'Los datos apuntaban a perdida de moderacion.',
  campo_secreto: 'NO-DEBE-SALIR',
};
const JUICIO = {
  case_file: 'Caso del testigo experto',
  expert_testimony: [
    { paragraph_id: 1, text: 'Dato correcto.' },
    { paragraph_id: 2, text: 'Aqui esta el fraude.' },
    { paragraph_id: 3, text: 'Cierre apoyado en lo anterior.' },
  ],
  guilty_paragraph_id: 2,
  cross_examination_tip: 'Revisa el segundo parrafo',
  verdict_explanation: 'El parrafo 2 viola la ley de conservacion.',
  campo_secreto: 'NO-DEBE-SALIR',
};
const TIMELINE = {
  theme: 'Egipto',
  items: [
    { id: 1, text: 'Construccion de la gran piramide', correct_position: 2, year: '2560 a. C.' },
    { id: 2, text: 'Unificacion del Alto y Bajo Egipto', correct_position: 1 },
    { id: 3, text: 'Conquista de Alejandro Magno', correct_position: 3, year: '332 a. C.' },
  ],
  pedagogical_feedback: 'EXPLICACION-LINEA: primero la unificacion.',
  campo_secreto: 'NO-DEBE-SALIR',
};
const CATEGORIES = {
  theme: 'Seres',
  categories: ['Vivo', 'Inerte'],
  items: [
    { id: 1, text: 'Perro', correct_category: 'Vivo' },
    { id: 2, text: 'Roca', correct_category: 'Inerte' },
    { id: 3, text: 'Gato', correct_category: 'Vivo' },
  ],
  time_limit_seconds: 45,
  pedagogical_feedback: 'EXPLICACION-CAT: los seres vivos nacen y mueren.',
  campo_secreto: 'NO-DEBE-SALIR',
};
const CARDS = {
  theme: 'Astronomia',
  pairs: [
    { id: 1, card1: 'Sol', card2: 'Estrella' },
    { id: 2, card1: 'Luna', card2: 'Satelite' },
    { id: 3, card1: 'Marte', card2: 'Planeta' },
  ],
  pedagogical_feedback: 'EXPLICACION-CARTAS: cada cuerpo celeste tiene su clase.',
  campo_secreto: 'NO-DEBE-SALIR',
};
const DECIPHER = {
  word_to_guess: 'ESCRIBA',
  initial_clue: 'Funcionario que registraba documentos oficiales',
  hints: ['Pista uno: llevaba registros', 'Pista dos: sin el no habria leyes escritas', 'Pista tres: viene de scribere'],
  pedagogical_feedback: 'EXPLICACION-DESCIFRADOR: el escriba preservaba la ley.',
  campo_secreto: 'NO-DEBE-SALIR',
};
const GAMES = {
  impostor_cognitivo: IMPOSTOR,
  alquimia_conceptual: ALQUIMIA,
  cuarto_crisis: CRISIS,
  juicio_conocimiento: JUICIO,
  linea_del_tiempo: TIMELINE,
  categorias_rapidas: CATEGORIES,
  flashcard_rapida: CARDS,
  el_descifrador: DECIPHER,
} as const;

const SOLUTION_STRINGS = [
  'is_impostor', 'is_correct', 'is_solution', 'guilty_paragraph_id', 'consequence', 'correct_position', 'correct_category', 'EXPLICACION-LINEA', 'EXPLICACION-CAT', 'EXPLICACION-CARTAS', 'EXPLICACION-DESCIFRADOR', 'ESCRIBA', 'word_to_guess', 'pairId', 'pair_id', 'Pista uno', 'Pista dos', 'Pista tres', 'card1', 'card2',
  'exposicion_del_impostor', 'unlocked_knowledge', 'post_mortem_report', 'verdict_explanation',
  'cloroplastos, no en', 'El precio de equilibrio iguala', 'Crisis evitada', 'Colapso diferido', 'Explosion', 'perdida de moderacion', 'conservacion', 'NO-DEBE-SALIR',
];

describe('tipos', () => {
  it('son los ocho minijuegos del catalogo', () => {
    expect([...SERVER_GRADED_GAME_TYPES]).toEqual([
      'impostor_cognitivo', 'alquimia_conceptual', 'cuarto_crisis', 'juicio_conocimiento', 'linea_del_tiempo', 'categorias_rapidas', 'flashcard_rapida', 'el_descifrador',
    ]);
    for (const t of SERVER_GRADED_GAME_TYPES) expect(isGradedGameType(t)).toBe(true);
    for (const t of ['multiple_choice', 'match', 'juego_futuro', '', undefined, null, 7]) expect(isGradedGameType(t)).toBe(false);
  });
});

describe('sanitizeGameData: lo que llega al navegador no trae la solucion', () => {
  for (const [type, gd] of Object.entries(GAMES)) {
    it(`${type}: ninguna marca de solucion, consecuencia, explicacion ni campo desconocido`, () => {
      const text = JSON.stringify(sanitizeGameData(type, gd));
      for (const secret of SOLUTION_STRINGS) expect(text, secret).not.toContain(secret);
    });
  }
  it('conserva lo necesario para jugar', () => {
    expect(sanitizeGameData('impostor_cognitivo', IMPOSTOR)).toEqual({ context: 'Sobre la fotosintesis', statements: [{ id: 1, text: 'Ocurre en los cloroplastos' }, { id: 2, text: 'Produce oxigeno' }, { id: 3, text: 'Ocurre en las mitocondrias' }] });
    expect(sanitizeGameData('alquimia_conceptual', ALQUIMIA)).toMatchObject({ fusion_title: 'Oferta y demanda', element_a: 'Oferta', element_b: 'Precio', alchemy_enigma: 'Que une ambos?' });
    expect((sanitizeGameData('alquimia_conceptual', ALQUIMIA).bridge_options as unknown[]).length).toBe(3);
    expect(sanitizeGameData('cuarto_crisis', CRISIS)).toEqual({
      crisis_scenario: 'El reactor se sobrecalienta',
      telemetry_data: ['Temperatura 900', 'Presion alta', 'Flujo bajo'],
      interventions: [{ action_code: 'ALPHA', description: 'Insertar barras de control' }, { action_code: 'BETA', description: 'Esperar' }, { action_code: 'GAMMA', description: 'Apagar el refrigerante' }],
    });
    expect(sanitizeGameData('juicio_conocimiento', JUICIO)).toMatchObject({ case_file: 'Caso del testigo experto', cross_examination_tip: 'Revisa el segundo parrafo' });
  });
  it('lista blanca: un campo nuevo que se agregue en el futuro NO sale', () => {
    const text = JSON.stringify(sanitizeGameData('impostor_cognitivo', { ...IMPOSTOR, respuesta_oculta: 'ZZZ', statements: [{ id: 1, text: 'a', is_impostor: true, pista: 'ZZZ' }] }));
    expect(text).not.toContain('ZZZ');
  });
  it('datos mal formados no revientan', () => {
    for (const t of SERVER_GRADED_GAME_TYPES) {
      for (const bad of [null, undefined, 'x', 5, [], { statements: 'no' }]) expect(() => sanitizeGameData(t, bad)).not.toThrow();
    }
    expect(sanitizeGameData('juego_futuro', IMPOSTOR)).toEqual({});
  });
});

describe('gradeGame', () => {
  it('impostor: acierta con el id falso', () => {
    expect(gradeGame('impostor_cognitivo', IMPOSTOR, { selectedId: 3 })).toEqual({ status: 'graded', correct: true });
    expect(gradeGame('impostor_cognitivo', IMPOSTOR, { selectedId: 1 })).toEqual({ status: 'graded', correct: false });
  });
  it('alquimia: acierta con la opcion correcta', () => {
    expect(gradeGame('alquimia_conceptual', ALQUIMIA, { selectedId: 'X' })).toEqual({ status: 'graded', correct: true });
    expect(gradeGame('alquimia_conceptual', ALQUIMIA, { selectedId: 'Z' })).toEqual({ status: 'graded', correct: false });
  });
  it('cuarto de crisis: acierta con la solucion; sin eleccion (se acabo el tiempo) es fallo', () => {
    expect(gradeGame('cuarto_crisis', CRISIS, { selectedCode: 'ALPHA' })).toEqual({ status: 'graded', correct: true });
    expect(gradeGame('cuarto_crisis', CRISIS, { selectedCode: 'BETA' })).toEqual({ status: 'graded', correct: false });
    expect(gradeGame('cuarto_crisis', CRISIS, { selectedCode: null })).toEqual({ status: 'graded', correct: false });
  });
  it('juicio: acierta con el parrafo culpable', () => {
    expect(gradeGame('juicio_conocimiento', JUICIO, { selectedParagraphId: 2 })).toEqual({ status: 'graded', correct: true });
    expect(gradeGame('juicio_conocimiento', JUICIO, { selectedParagraphId: 3 })).toEqual({ status: 'graded', correct: false });
  });
  it('una eleccion que no existe, de otro tipo o sin objeto es "invalid" (no se da por buena ni por mala)', () => {
    expect(gradeGame('impostor_cognitivo', IMPOSTOR, { selectedId: 99 })).toEqual({ status: 'invalid' });
    expect(gradeGame('impostor_cognitivo', IMPOSTOR, { selectedId: '3' })).toEqual({ status: 'invalid' });
    expect(gradeGame('alquimia_conceptual', ALQUIMIA, { selectedId: 'Q' })).toEqual({ status: 'invalid' });
    expect(gradeGame('alquimia_conceptual', ALQUIMIA, { selectedId: 1 })).toEqual({ status: 'invalid' });
    expect(gradeGame('cuarto_crisis', CRISIS, { selectedCode: 'OMEGA' })).toEqual({ status: 'invalid' });
    expect(gradeGame('cuarto_crisis', CRISIS, {})).toEqual({ status: 'invalid' });
    expect(gradeGame('juicio_conocimiento', JUICIO, { selectedParagraphId: 7 })).toEqual({ status: 'invalid' });
    for (const t of SERVER_GRADED_GAME_TYPES) for (const a of [null, undefined, 'x', 3, [], true]) expect(gradeGame(t, GAMES[t], a)).toEqual({ status: 'invalid' });
  });
  it('un juego SIN solucion no se califica: nunca se aprueba ni se reprueba por omision', () => {
    expect(gradeGame('impostor_cognitivo', { statements: [{ id: 1, text: 'a', is_impostor: false }] }, { selectedId: 1 })).toEqual({ status: 'invalid' });
    expect(gradeGame('alquimia_conceptual', { bridge_options: [{ id: 'X', text: 'a', is_correct: false }] }, { selectedId: 'X' })).toEqual({ status: 'invalid' });
    expect(gradeGame('cuarto_crisis', { interventions: [{ action_code: 'A', description: 'a', is_solution: false }] }, { selectedCode: null })).toEqual({ status: 'invalid' });
    expect(gradeGame('juicio_conocimiento', { expert_testimony: [{ paragraph_id: 1, text: 'a' }] }, { selectedParagraphId: 1 })).toEqual({ status: 'invalid' });
    expect(gradeGame('impostor_cognitivo', null, { selectedId: 1 })).toEqual({ status: 'invalid' });
  });
  it('otros tipos: "unsupported"', () => {
    expect(gradeGame('juego_futuro', {}, {})).toEqual({ status: 'unsupported' });
    expect(gradeGame('multiple_choice', {}, {})).toEqual({ status: 'unsupported' });
    // el tipo se comprueba ANTES que la forma de la respuesta: un juego que no se califica aqui no es "invalid", es "unsupported"
    expect(gradeGame('juego_futuro', {}, null)).toEqual({ status: 'unsupported' });
    expect(gradeGame('match', {}, 'x')).toEqual({ status: 'unsupported' });
  });
  it('paridad con el navegador: con varias opciones marcadas correctas, cualquiera de ellas acierta (como hacia el juego)', () => {
    const gd = { bridge_options: [{ id: 'A', text: 'a', is_correct: true }, { id: 'B', text: 'b', is_correct: true }, { id: 'C', text: 'c', is_correct: false }] };
    expect(gradeGame('alquimia_conceptual', gd, { selectedId: 'B' })).toEqual({ status: 'graded', correct: true });
  });
});

describe('buildGameReveal', () => {
  it('revela la solucion y la explicacion de cada juego', () => {
    expect(buildGameReveal('impostor_cognitivo', IMPOSTOR)).toEqual({ impostorIds: [3], explanation: IMPOSTOR.exposicion_del_impostor });
    expect(buildGameReveal('alquimia_conceptual', ALQUIMIA)).toEqual({ correctIds: ['X'], explanation: ALQUIMIA.unlocked_knowledge });
    expect(buildGameReveal('cuarto_crisis', CRISIS)).toEqual({
      solutionCodes: ['ALPHA'],
      consequences: { ALPHA: 'Crisis evitada: las barras absorben neutrones.', BETA: 'Colapso diferido.', GAMMA: 'Explosion.' },
      explanation: CRISIS.post_mortem_report,
    });
    expect(buildGameReveal('juicio_conocimiento', JUICIO)).toEqual({ guiltyParagraphId: 2, explanation: JUICIO.verdict_explanation });
  });
  it('sin explicacion: null; datos rotos o tipo desconocido no revientan', () => {
    expect(buildGameReveal('impostor_cognitivo', { statements: [{ id: 1, text: 'a', is_impostor: true }] })).toEqual({ impostorIds: [1], explanation: null });
    expect(buildGameReveal('juicio_conocimiento', {})).toEqual({ guiltyParagraphId: null, explanation: null });
    expect(buildGameReveal('otro', JUICIO)).toEqual({});
    for (const t of SERVER_GRADED_GAME_TYPES) expect(() => buildGameReveal(t, null)).not.toThrow();
  });
});

describe('sanitizeQuestion con minijuegos', () => {
  const q = (type: keyof typeof GAMES) => ({ id: 'g1', type, q: 'Juega', exp: 'EXPLICACION-SECRETA', concept_tag: 'tema', game_type: type, game_data: GAMES[type], ok: null, answers: null, pairs: null, keywords: null });
  it('con el interruptor de juegos: sin explicacion y con los datos reducidos, marcada como calificada en el servidor', () => {
    for (const t of SERVER_GRADED_GAME_TYPES) {
      const out = sanitizeQuestion(q(t), Math.random, { games: true });
      expect(out.serverGraded).toBe(true);
      expect(out).not.toHaveProperty('exp');
      expect(out).toMatchObject({ id: 'g1', type: t, q: 'Juega', concept_tag: 'tema', game_type: t });
      const text = JSON.stringify(out);
      for (const secret of [...SOLUTION_STRINGS, 'EXPLICACION-SECRETA']) expect(text, secret).not.toContain(secret);
    }
  });
  it('SIN el interruptor, el minijuego se sirve intacto (lo califica el navegador como siempre)', () => {
    const game = q('impostor_cognitivo');
    expect(sanitizeQuestion(game)).toBe(game);
    expect(sanitizeQuestion(game, Math.random, { games: false })).toBe(game);
  });
  it('los juegos que aun no se califican en el servidor no se tocan, ni con el interruptor', () => {
    const futuro = { id: 'g2', type: 'juego_futuro', game_data: { secreto: 1 } };
    expect(sanitizeQuestion(futuro, Math.random, { games: true })).toBe(futuro);
  });
  it('sin id no se toca', () => {
    const sinId = { type: 'impostor_cognitivo', game_data: IMPOSTOR };
    expect(sanitizeQuestion(sinId, Math.random, { games: true })).toBe(sinId);
  });
});

describe('interruptor de juegos', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('hace falta SERVER_GRADING=on, la llave de servicio Y SERVER_GRADING_GAMES=on', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ejemplo.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'x'.repeat(40));
    vi.stubEnv('SERVER_GRADING', 'on');
    vi.stubEnv('SERVER_GRADING_GAMES', '');
    expect(serverGradingGamesEnabled()).toBe(false);
    vi.stubEnv('SERVER_GRADING_GAMES', 'on');
    expect(serverGradingGamesEnabled()).toBe(true);
    vi.stubEnv('SERVER_GRADING', 'off');
    expect(serverGradingGamesEnabled()).toBe(false);
    vi.stubEnv('SERVER_GRADING', 'on');
    h.hasKey = false; // sin la llave de servicio (el modulo de la base esta simulado en este archivo)
    expect(serverGradingGamesEnabled()).toBe(false);
    h.hasKey = true;
    vi.stubEnv('SERVER_GRADING_GAMES', 'si');
    expect(serverGradingGamesEnabled()).toBe(false);
  });
});

// ───────────────────── la ruta y la entrega de la leccion, con una base simulada en memoria ─────────────────────
type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  user: { id: 'stu-1' } as { id: string } | null,
  db: {} as Record<string, Row[]>,
  hasKey: true,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));
vi.mock('@/lib/supabase/admin', () => {
  function from(name: string) {
    const filters: [string, unknown][] = [];
    let op: 'select' | 'update' = 'select';
    let payload: Row = {};
    const match = () => (h.db[name] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (k: string, v: unknown) => (filters.push([k, v]), builder),
      update: (p: Row) => ((op = 'update'), (payload = p), builder),
      maybeSingle: async () => ({ data: match()[0] ?? null }),
      insert: (p: Row) => {
        (h.db[name] ??= []).push({ ...p });
        const done = { error: null as null | { message: string } };
        return Object.assign(Promise.resolve(done), { select: () => ({ single: async () => ({ data: { id: 'att-new' }, error: null }) }) });
      },
      then: (resolve: (v: unknown) => void) => {
        if (op === 'update') {
          const rows = match();
          rows.forEach((r) => Object.assign(r, payload));
          return resolve({ data: rows.map((r) => ({ tries: r.tries })) });
        }
        return resolve({ data: match() });
      },
    };
    return builder;
  }
  return { hasServiceRoleKey: () => h.hasKey, MISSING_SERVICE_KEY_MESSAGE: 'sin llave', createAdminSupabase: () => ({ from }) };
});

const ATT = '11111111-1111-4111-8111-111111111111';
const QID = '22222222-2222-4222-8222-222222222222';
const MOD = '33333333-3333-4333-8333-333333333333';
const questionRow = (type: keyof typeof GAMES, over: Row = {}): Row => ({ id: QID, type, q: 'Juega', opts: null, ok: null, answers: null, pairs: null, keywords: null, exp: 'Explicacion de la pregunta', concept_tag: 'tema', game_type: type, game_data: GAMES[type], ...over });

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/lesson/answer/route');
  return POST(new Request('http://localhost/api/lesson/answer', { method: 'POST', body: JSON.stringify(body) }) as never);
};

function seed(type: keyof typeof GAMES, over: { attempt?: Row; question?: Row } = {}) {
  h.db = {
    lesson_attempts: [{ id: ATT, student_id: 'stu-1', module_id: MOD, question_ids: [QID], status: 'in_progress', ...over.attempt }],
    lesson_questions: [questionRow(type, over.question)],
    lesson_attempt_answers: [],
    content_modules: [{ id: MOD, classroom_id: 'cls-1', source_material_ids: [] }],
    question_attempts: [],
  };
}

describe('POST /api/lesson/answer con minijuegos (comportamiento)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ejemplo.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'x'.repeat(40));
    vi.stubEnv('SERVER_GRADING', 'on');
    vi.stubEnv('SERVER_GRADING_GAMES', 'on');
    h.user = { id: 'stu-1' };
    h.hasKey = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('acierto: califica, revela la solucion y la explicacion y registra el intento con su tipo de juego', async () => {
    seed('impostor_cognitivo');
    const res = await post({ attemptId: ATT, questionId: QID, answer: { selectedId: 3 } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ correct: true, final: true, tries: 1, reveal: { impostorIds: [3] }, explanation: 'Explicacion de la pregunta' });
    expect(h.db.lesson_attempt_answers).toHaveLength(1);
    expect(h.db.lesson_attempt_answers[0]).toMatchObject({ attempt_id: ATT, question_id: QID, correct: true, final: true, tries: 1 });
    expect(h.db.question_attempts).toEqual([expect.objectContaining({ student_id: 'stu-1', question_id: QID, module_id: MOD, classroom_id: 'cls-1', was_correct: true, game_type: 'impostor_cognitivo', concept_tag: 'tema' })]);
  });

  it('fallo: tambien cierra (un solo intento) y revela la solucion', async () => {
    seed('alquimia_conceptual');
    const body = await (await post({ attemptId: ATT, questionId: QID, answer: { selectedId: 'Y' } })).json();
    expect(body).toMatchObject({ correct: false, final: true, reveal: { correctIds: ['X'] } });
    expect(h.db.question_attempts[0]).toMatchObject({ was_correct: false, game_type: 'alquimia_conceptual' });
  });

  it('cuarto de crisis: revela las consecuencias de cada intervencion; sin eleccion (tiempo) cierra como fallo', async () => {
    seed('cuarto_crisis');
    const body = await (await post({ attemptId: ATT, questionId: QID, answer: { selectedCode: null } })).json();
    expect(body).toMatchObject({ correct: false, final: true });
    expect(body.reveal.solutionCodes).toEqual(['ALPHA']);
    expect(body.reveal.consequences.BETA).toBe('Colapso diferido.');
  });

  it('juicio: revela el parrafo culpable', async () => {
    seed('juicio_conocimiento');
    const body = await (await post({ attemptId: ATT, questionId: QID, answer: { selectedParagraphId: 2 } })).json();
    expect(body).toMatchObject({ correct: true, reveal: { guiltyParagraphId: 2 } });
  });

  it('sin explicacion en la fila usa la del propio juego', async () => {
    seed('juicio_conocimiento', { question: { exp: null } });
    const body = await (await post({ attemptId: ATT, questionId: QID, answer: { selectedParagraphId: 2 } })).json();
    expect(body.explanation).toBe(JUICIO.verdict_explanation);
  });

  it('repetir una pregunta cerrada devuelve lo mismo y NO suma ni registra de nuevo', async () => {
    seed('impostor_cognitivo');
    const first = await (await post({ attemptId: ATT, questionId: QID, answer: { selectedId: 1 } })).json();
    expect(first.correct).toBe(false);
    // el segundo intento "acertando" no cambia nada: la pregunta ya cerro
    const again = await (await post({ attemptId: ATT, questionId: QID, answer: { selectedId: 3 } })).json();
    expect(again).toMatchObject({ correct: false, final: true, tries: 1 });
    expect(h.db.lesson_attempt_answers).toHaveLength(1);
    expect(h.db.question_attempts).toHaveLength(1);
  });

  it('una eleccion que no existe: 400 y no se guarda nada', async () => {
    seed('impostor_cognitivo');
    const res = await post({ attemptId: ATT, questionId: QID, answer: { selectedId: 99 } });
    expect(res.status).toBe(400);
    expect(h.db.lesson_attempt_answers).toHaveLength(0);
    expect(h.db.question_attempts).toHaveLength(0);
  });

  it('un juego sin solucion no se califica: 400, no se guarda nada', async () => {
    seed('impostor_cognitivo', { question: { game_data: { statements: [{ id: 1, text: 'a', is_impostor: false }] } } });
    const res = await post({ attemptId: ATT, questionId: QID, answer: { selectedId: 1 } });
    expect(res.status).toBe(400);
    expect(h.db.lesson_attempt_answers).toHaveLength(0);
  });

  it('con el interruptor de juegos APAGADO responde 404 (esa pregunta se sirvio con su solucion y la califica el navegador)', async () => {
    vi.stubEnv('SERVER_GRADING_GAMES', '');
    seed('impostor_cognitivo');
    expect((await post({ attemptId: ATT, questionId: QID, answer: { selectedId: 3 } })).status).toBe(404);
    expect(h.db.lesson_attempt_answers).toHaveLength(0);
  });

  it('con la calificacion apagada responde 503', async () => {
    vi.stubEnv('SERVER_GRADING', 'off');
    seed('impostor_cognitivo');
    expect((await post({ attemptId: ATT, questionId: QID, answer: { selectedId: 3 } })).status).toBe(503);
  });

  it('SEGURIDAD: intento de otro estudiante, cerrado, o pregunta que no se sirvio en ese intento', async () => {
    seed('impostor_cognitivo', { attempt: { student_id: 'otro' } });
    expect((await post({ attemptId: ATT, questionId: QID, answer: { selectedId: 3 } })).status).toBe(404);
    seed('impostor_cognitivo', { attempt: { question_ids: ['44444444-4444-4444-8444-444444444444'] } });
    expect((await post({ attemptId: ATT, questionId: QID, answer: { selectedId: 3 } })).status).toBe(404);
    seed('impostor_cognitivo', { attempt: { status: 'completed' } });
    expect((await post({ attemptId: ATT, questionId: QID, answer: { selectedId: 3 } })).status).toBe(409);
    h.user = null;
    seed('impostor_cognitivo');
    expect((await post({ attemptId: ATT, questionId: QID, answer: { selectedId: 3 } })).status).toBe(401);
    expect(h.db.lesson_attempt_answers).toHaveLength(0);
  });

  it('las preguntas clasicas siguen calificandose como antes', async () => {
    h.db = {
      lesson_attempts: [{ id: ATT, student_id: 'stu-1', module_id: MOD, question_ids: [QID], status: 'in_progress' }],
      lesson_questions: [{ id: QID, type: 'multiple_choice', q: '?', opts: ['a', 'b'], ok: 1, exp: 'porque b', concept_tag: null, game_data: null }],
      lesson_attempt_answers: [],
      content_modules: [{ id: MOD, classroom_id: 'cls-1', source_material_ids: [] }],
      question_attempts: [],
    };
    const body = await (await post({ attemptId: ATT, questionId: QID, answer: { selectedIndex: 1 } })).json();
    expect(body).toMatchObject({ correct: true, final: true, reveal: { ok: 1 }, explanation: 'porque b' });
    expect(h.db.question_attempts[0]).toMatchObject({ game_type: null });
  });
});

describe('startLessonAttempt con minijuegos (entrega de la leccion)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ejemplo.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'x'.repeat(40));
    vi.stubEnv('SERVER_GRADING', 'on');
    h.user = { id: 'stu-1' };
    h.db = {};
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  const userClient = { auth: { getUser: async () => ({ data: { user: h.user } }) } };
  const served = () => [
    { id: 'c1', type: 'multiple_choice', q: '?', opts: ['a', 'b'], ok: 1, exp: 'EXP-CLASICA' },
    { id: 'g1', type: 'impostor_cognitivo', q: 'Juega', exp: 'EXP-JUEGO', game_type: 'impostor_cognitivo', game_data: IMPOSTOR },
    { id: 'g2', type: 'juego_futuro', q: 'Nuevo', exp: 'EXP-FUTURO', game_type: 'juego_futuro', game_data: { x: 1 } },
  ];

  it('con ambos interruptores: el juego sale sin solucion y entra en el intento; un tipo desconocido sale intacto', async () => {
    vi.stubEnv('SERVER_GRADING_GAMES', 'on');
    const { startLessonAttempt } = await import('./lessonAttempt');
    const r = await startLessonAttempt(userClient, MOD, served());
    expect(r.attemptId).toBe('att-new');
    expect(h.db.lesson_attempts[0].question_ids).toEqual(['c1', 'g1']);
    const text = JSON.stringify(r.questions[1]);
    for (const secret of [...SOLUTION_STRINGS, 'EXP-JUEGO']) expect(text, secret).not.toContain(secret);
    expect(r.questions[1]).toMatchObject({ id: 'g1', serverGraded: true });
    expect(r.questions[2]).toEqual(served()[2]); // linea del tiempo: igual que antes
    expect(JSON.stringify(r.questions[0])).not.toContain('EXP-CLASICA');
  });

  it('solo con SERVER_GRADING: los juegos se sirven COMO ANTES (con su solucion) y no entran en el intento', async () => {
    vi.stubEnv('SERVER_GRADING_GAMES', '');
    const { startLessonAttempt } = await import('./lessonAttempt');
    const r = await startLessonAttempt(userClient, MOD, served());
    expect(h.db.lesson_attempts[0].question_ids).toEqual(['c1']);
    expect(r.questions[1]).toEqual(served()[1]);
    expect(JSON.stringify(r.questions[1])).toContain('is_impostor');
  });

  it('una leccion solo de juegos migrados crea el intento (antes no habia nada que calificar en el servidor)', async () => {
    vi.stubEnv('SERVER_GRADING_GAMES', 'on');
    const { startLessonAttempt } = await import('./lessonAttempt');
    const r = await startLessonAttempt(userClient, MOD, [served()[1]]);
    expect(r.attemptId).toBe('att-new');
    expect(r.questions[0]).toMatchObject({ serverGraded: true });
  });
});

describe('el navegador', () => {
  const page = read('src/app/(student)/lesson/[id]/page.tsx');
  it('los ocho juegos reciben `check` desde la pagina y, calificados en el servidor, no se registran desde el navegador', () => {
    for (const comp of ['ImpostorCognitivoGame', 'AlquimiaConceptualGame', 'CuartoCrisisGame', 'JuicioConocimientoGame', 'TimelineGame', 'CategoriesGame', 'FlashcardGame', 'ElDescifrador']) {
      const block = page.slice(page.indexOf(`<${comp}`), page.indexOf('/>', page.indexOf(`<${comp}`)));
      expect(block, comp).toContain('check={gameCheck(q)}');
      expect(block, comp).toContain('finishGame(q, correct)');
      expect(block, comp).not.toContain('recordAttempt');
    }
    // el navegador solo reacciona al resultado: el intento de lo que califica el servidor lo registra el servidor, y ya no hay camino de escritura desde el navegador
    expect(page).toMatch(/const finishGame = \(_q: LessonPageQuestion, correct: boolean\) => \{\s*reactToResult\(correct\);\s*\};/);
    // (sin contar los comentarios: uno historico todavia lo nombra)
    const codeOnly = page
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(codeOnly).not.toContain('recordAttempt');
  });
  for (const comp of ['ImpostorCognitivoGame', 'AlquimiaConceptualGame', 'CuartoCrisisGame', 'JuicioConocimientoGame', 'TimelineGame', 'CategoriesGame', 'FlashcardGame', 'ElDescifrador']) {
    it(`${comp}: con \`check\` espera al servidor, no conoce la solucion y deja reintentar si no se pudo comprobar`, () => {
      const src = read(`src/components/minigames/${comp}.tsx`);
      expect(src).toContain('check?: GameCheck');
      expect(src).toContain('await check(');
      expect(src).toContain('CHECK_ERROR');
      expect(src).toContain('Comprobando…');
      // los campos de solucion son OPCIONALES en los datos del juego (no vienen del servidor)
      expect(src).toMatch(/is_impostor\?|is_correct\?|is_solution\?|guilty_paragraph_id\?|correct_position\?|correct_category\?|word_to_guess\?|pairs\?/);
    });
  }
  it('Cuarto de Crisis informa al servidor cuando se acaba el tiempo', () => {
    expect(read('src/components/minigames/CuartoCrisisGame.tsx')).toContain('check({ selectedCode: null })');
  });
});

// ───────────────────── linea del tiempo y categorias ─────────────────────
describe('linea del tiempo (funciones puras)', () => {
  it('al navegador solo salen el id, el texto y el año: la posicion correcta y la explicacion no', () => {
    expect(sanitizeGameData('linea_del_tiempo', TIMELINE)).toEqual({
      theme: 'Egipto',
      items: [
        { id: 1, text: 'Construccion de la gran piramide', year: '2560 a. C.' },
        { id: 2, text: 'Unificacion del Alto y Bajo Egipto' },
        { id: 3, text: 'Conquista de Alejandro Magno', year: '332 a. C.' },
      ],
    });
  });
  it('el orden correcto acierta y marca todas las posiciones', () => {
    expect(gradeGame('linea_del_tiempo', TIMELINE, { order: [2, 1, 3] })).toEqual({ status: 'graded', correct: true, detail: { perSlot: [true, true, true] } });
  });
  it('un orden incorrecto falla y dice QUE POSICIONES estaban mal (lo mismo que mostraba el juego), nada mas', () => {
    expect(gradeGame('linea_del_tiempo', TIMELINE, { order: [1, 2, 3] })).toEqual({ status: 'graded', correct: false, detail: { perSlot: [false, false, true] } });
    expect(gradeGame('linea_del_tiempo', TIMELINE, { order: [2, 3, 1] })).toEqual({ status: 'graded', correct: false, detail: { perSlot: [true, false, false] } });
  });
  it('formas invalidas: no es lista, largo distinto, repetidos, id desconocido, ids de otro tipo', () => {
    for (const order of [undefined, 'x', {}, [2, 1], [2, 1, 3, 3], [2, 2, 1], [2, 1, 99], ['2', '1', '3'], [2, 1, null]]) {
      expect(gradeGame('linea_del_tiempo', TIMELINE, { order }), JSON.stringify(order)).toEqual({ status: 'invalid' });
    }
  });
  it('datos sin solucion utilizable (posiciones repetidas, con huecos o faltantes) no se califican', () => {
    const items = (positions: unknown[]) => ({ items: positions.map((correct_position, i) => ({ id: i + 1, text: `e${i}`, correct_position })) });
    for (const pos of [[1, 1, 2], [1, 2, 4], [0, 1, 2], [1, 2, undefined], ['1', '2', '3']]) expect(gradeGame('linea_del_tiempo', items(pos), { order: [1, 2, 3] }), JSON.stringify(pos)).toEqual({ status: 'invalid' });
    expect(gradeGame('linea_del_tiempo', { items: [] }, { order: [] })).toEqual({ status: 'invalid' });
    expect(gradeGame('linea_del_tiempo', null, { order: [] })).toEqual({ status: 'invalid' });
  });
  it('revela el orden correcto (ids) y la explicacion', () => {
    expect(buildGameReveal('linea_del_tiempo', TIMELINE)).toEqual({ correctOrder: [2, 1, 3], explanation: TIMELINE.pedagogical_feedback });
    expect(buildGameReveal('linea_del_tiempo', {})).toEqual({ correctOrder: [], explanation: null });
  });
});

describe('categorias (funciones puras)', () => {
  it('al navegador salen las categorias y los elementos SIN su categoria', () => {
    expect(sanitizeGameData('categorias_rapidas', CATEGORIES)).toEqual({
      theme: 'Seres',
      categories: ['Vivo', 'Inerte'],
      items: [{ id: 1, text: 'Perro' }, { id: 2, text: 'Roca' }, { id: 3, text: 'Gato' }],
      time_limit_seconds: 45,
    });
  });
  it('la clasificacion completa y correcta acierta; con un error, falla', () => {
    expect(gradeGame('categorias_rapidas', CATEGORIES, { assignment: { 1: 'Vivo', 2: 'Inerte', 3: 'Vivo' } })).toEqual({ status: 'graded', correct: true });
    expect(gradeGame('categorias_rapidas', CATEGORIES, { assignment: { 1: 'Vivo', 2: 'Vivo', 3: 'Vivo' } })).toEqual({ status: 'graded', correct: false });
  });
  it('se acabo el tiempo = intento fallido', () => {
    expect(gradeGame('categorias_rapidas', CATEGORIES, { timeout: true })).toEqual({ status: 'graded', correct: false });
    // solo `timeout: true` cuenta: otra cosa no es una respuesta
    expect(gradeGame('categorias_rapidas', CATEGORIES, { timeout: 'si' })).toEqual({ status: 'invalid' });
    expect(gradeGame('categorias_rapidas', CATEGORIES, { timeout: false })).toEqual({ status: 'invalid' });
  });
  it('formas invalidas: sin clasificacion, faltan o sobran elementos, categoria desconocida, valores que no son texto', () => {
    const bad: unknown[] = [undefined, null, 'x', [], { 1: 'Vivo', 2: 'Inerte' }, { 1: 'Vivo', 2: 'Inerte', 3: 'Vivo', 4: 'Vivo' }, { 1: 'Vivo', 2: 'Inerte', 3: 'Raro' }, { 1: 'Vivo', 2: 'Inerte', 3: 7 }, { 1: 'Vivo', 2: 'Inerte', 9: 'Vivo' }];
    for (const assignment of bad) expect(gradeGame('categorias_rapidas', CATEGORIES, { assignment }), JSON.stringify(assignment)).toEqual({ status: 'invalid' });
  });
  it('datos sin solucion utilizable (categoria que no existe, sin elementos) no se califican', () => {
    expect(gradeGame('categorias_rapidas', { categories: ['A'], items: [{ id: 1, text: 'x', correct_category: 'B' }] }, { assignment: { 1: 'A' } })).toEqual({ status: 'invalid' });
    expect(gradeGame('categorias_rapidas', { categories: ['A'], items: [] }, { assignment: {} })).toEqual({ status: 'invalid' });
    expect(gradeGame('categorias_rapidas', { categories: ['A'], items: [{ id: 1, text: 'x' }] }, { timeout: true })).toEqual({ status: 'invalid' });
  });
  it('revela la clasificacion correcta y la explicacion', () => {
    expect(buildGameReveal('categorias_rapidas', CATEGORIES)).toEqual({ assignment: { 1: 'Vivo', 2: 'Inerte', 3: 'Vivo' }, explanation: CATEGORIES.pedagogical_feedback });
  });
});

describe('probeGame: el sondeo de categorias', () => {
  it('dice si esa categoria es la del elemento', () => {
    expect(probeGame('categorias_rapidas', CATEGORIES, { itemId: 1, category: 'Vivo' })).toEqual({ status: 'graded', correct: true });
    expect(probeGame('categorias_rapidas', CATEGORIES, { itemId: 1, category: 'Inerte' })).toEqual({ status: 'graded', correct: false });
  });
  it('invalido: elemento o categoria que no existen, tipos equivocados, sin objeto', () => {
    for (const probe of [null, undefined, 'x', {}, { itemId: 99, category: 'Vivo' }, { itemId: 1, category: 'Raro' }, { itemId: '1', category: 'Vivo' }, { itemId: 1, category: 5 }]) {
      expect(probeGame('categorias_rapidas', CATEGORIES, probe), JSON.stringify(probe)).toEqual({ status: 'invalid' });
    }
  });
  it('solo existe para las categorias', () => {
    for (const t of ['impostor_cognitivo', 'linea_del_tiempo', 'multiple_choice']) expect(probeGame(t, CATEGORIES, { itemId: 1, category: 'Vivo' })).toEqual({ status: 'unsupported' });
  });
});

describe('POST /api/lesson/answer: varios intentos y sondeos (comportamiento)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ejemplo.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'x'.repeat(40));
    vi.stubEnv('SERVER_GRADING', 'on');
    vi.stubEnv('SERVER_GRADING_GAMES', 'on');
    h.user = { id: 'stu-1' };
    h.hasKey = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  const send = async (answer: unknown) => (await post({ attemptId: ATT, questionId: QID, answer })).json();

  it('linea del tiempo: un intento fallido NO cierra ni revela; dice solo las posiciones; el tercero cierra y revela', async () => {
    seed('linea_del_tiempo');
    const first = await send({ order: [1, 2, 3] });
    expect(first).toEqual({ correct: false, final: false, tries: 1, triesLeft: 2, detail: { perSlot: [false, false, true] } });
    expect(JSON.stringify(first)).not.toContain('EXPLICACION-LINEA');
    expect(h.db.question_attempts).toHaveLength(0);
    expect(h.db.lesson_attempt_answers[0]).toMatchObject({ tries: 1, final: false, correct: false });

    const second = await send({ order: [2, 3, 1] });
    expect(second).toMatchObject({ correct: false, final: false, tries: 2, triesLeft: 1, detail: { perSlot: [true, false, false] } });

    const third = await send({ order: [3, 2, 1] });
    expect(third).toMatchObject({ correct: false, final: true, tries: 3, reveal: { correctOrder: [2, 1, 3] }, explanation: 'Explicacion de la pregunta' });
    expect(h.db.lesson_attempt_answers).toHaveLength(1);
    expect(h.db.question_attempts).toEqual([expect.objectContaining({ was_correct: false, game_type: 'linea_del_tiempo' })]);
  });

  it('linea del tiempo: acertar en el segundo intento cierra con 2 intentos y se registra como acierto', async () => {
    seed('linea_del_tiempo');
    await send({ order: [1, 2, 3] });
    const body = await send({ order: [2, 1, 3] });
    expect(body).toMatchObject({ correct: true, final: true, tries: 2, reveal: { correctOrder: [2, 1, 3] } });
    expect(h.db.question_attempts).toEqual([expect.objectContaining({ was_correct: true, game_type: 'linea_del_tiempo' })]);
  });

  it('linea del tiempo: pasado el cierre, otro envio no cambia nada', async () => {
    seed('linea_del_tiempo');
    await send({ order: [2, 1, 3] });
    const again = await send({ order: [1, 2, 3] });
    expect(again).toMatchObject({ correct: true, final: true, tries: 1 });
    expect(h.db.lesson_attempt_answers).toHaveLength(1);
    expect(h.db.question_attempts).toHaveLength(1);
  });

  it('linea del tiempo: un orden con formas invalidas es 400 y no gasta un intento', async () => {
    seed('linea_del_tiempo');
    const res = await post({ attemptId: ATT, questionId: QID, answer: { order: [1, 2] } });
    expect(res.status).toBe(400);
    expect(h.db.lesson_attempt_answers).toHaveLength(0);
  });

  it('categorias: el sondeo no cierra, no gasta intentos y no escribe nada', async () => {
    seed('categorias_rapidas');
    expect(await send({ probe: { itemId: 1, category: 'Vivo' } })).toEqual({ correct: true, final: false, probe: true });
    expect(await send({ probe: { itemId: 1, category: 'Inerte' } })).toEqual({ correct: false, final: false, probe: true });
    expect(h.db.lesson_attempt_answers).toHaveLength(0);
    expect(h.db.question_attempts).toHaveLength(0);
  });

  it('categorias: un sondeo invalido, o sobre un juego que no es de categorias, es 400', async () => {
    seed('categorias_rapidas');
    expect((await post({ attemptId: ATT, questionId: QID, answer: { probe: { itemId: 99, category: 'Vivo' } } })).status).toBe(400);
    expect((await post({ attemptId: ATT, questionId: QID, answer: { probe: 'x' } })).status).toBe(400);
    seed('impostor_cognitivo');
    expect((await post({ attemptId: ATT, questionId: QID, answer: { probe: { itemId: 1, category: 'Vivo' } } })).status).toBe(400);
    expect(h.db.lesson_attempt_answers).toHaveLength(0);
  });

  it('categorias: un sondeo no se acepta con el interruptor de juegos apagado ni en un intento ajeno', async () => {
    vi.stubEnv('SERVER_GRADING_GAMES', '');
    seed('categorias_rapidas');
    expect((await post({ attemptId: ATT, questionId: QID, answer: { probe: { itemId: 1, category: 'Vivo' } } })).status).toBe(404);
    vi.stubEnv('SERVER_GRADING_GAMES', 'on');
    seed('categorias_rapidas', { attempt: { student_id: 'otro' } });
    expect((await post({ attemptId: ATT, questionId: QID, answer: { probe: { itemId: 1, category: 'Vivo' } } })).status).toBe(404);
  });

  it('categorias: la clasificacion completa y correcta cierra con acierto y revela la clasificacion', async () => {
    seed('categorias_rapidas');
    const body = await send({ assignment: { 1: 'Vivo', 2: 'Inerte', 3: 'Vivo' } });
    expect(body).toMatchObject({ correct: true, final: true, tries: 1, reveal: { assignment: { 1: 'Vivo', 2: 'Inerte', 3: 'Vivo' } } });
    expect(h.db.question_attempts).toEqual([expect.objectContaining({ was_correct: true, game_type: 'categorias_rapidas' })]);
  });

  it('categorias: una clasificacion completa pero equivocada es un intento fallido (no se puede "declarar" lo que no es)', async () => {
    seed('categorias_rapidas');
    const body = await send({ assignment: { 1: 'Inerte', 2: 'Inerte', 3: 'Vivo' } });
    expect(body).toMatchObject({ correct: false, final: false, tries: 1, triesLeft: 1 });
    expect(body.reveal).toBeUndefined();
  });

  it('categorias: el tiempo agotado cuenta; la segunda vez cierra como fallada y revela', async () => {
    seed('categorias_rapidas');
    expect(await send({ timeout: true })).toMatchObject({ correct: false, final: false, tries: 1, triesLeft: 1 });
    const second = await send({ timeout: true });
    expect(second).toMatchObject({ correct: false, final: true, tries: 2, reveal: { assignment: { 1: 'Vivo', 2: 'Inerte', 3: 'Vivo' } } });
    expect(h.db.question_attempts).toEqual([expect.objectContaining({ was_correct: false, game_type: 'categorias_rapidas' })]);
  });

  it('categorias: acertar despues de un tiempo agotado cierra con acierto en el segundo intento', async () => {
    seed('categorias_rapidas');
    await send({ timeout: true });
    expect(await send({ assignment: { 1: 'Vivo', 2: 'Inerte', 3: 'Vivo' } })).toMatchObject({ correct: true, final: true, tries: 2 });
  });

  it('categorias: una clasificacion incompleta es 400 y no gasta intentos', async () => {
    seed('categorias_rapidas');
    expect((await post({ attemptId: ATT, questionId: QID, answer: { assignment: { 1: 'Vivo' } } })).status).toBe(400);
    expect(h.db.lesson_attempt_answers).toHaveLength(0);
  });
});

describe('los dos juegos nuevos en el navegador', () => {
  it('la linea del tiempo manda el ORDEN (ids) y marca solo las posiciones que el servidor dice', () => {
    const src = read('src/components/minigames/TimelineGame.tsx');
    expect(src).toContain('check({ order: placed.map((idx) => items[idx].id) })');
    expect(src).toContain('verdict.detail?.perSlot');
    expect(src).toContain('failedAttempt(closes, true)'); // con el servidor, SU cuenta de intentos manda
  });
  it('las categorias sondean cada toque, informan el tiempo agotado y cierran con la clasificacion completa', () => {
    const src = read('src/components/minigames/CategoriesGame.tsx');
    expect(src).toContain('check({ probe: { itemId: item.id, category: cat } })');
    expect(src).toContain('check({ timeout: true })');
    expect(src).toContain('check!({ assignment: finalAssignment })');
    expect(src).toContain('Reintentar'); // si falla la comprobacion final, se puede reintentar
  });
  it('la pagina pasa a `check` el estado de cierre y el detalle del servidor', () => {
    const page = read('src/app/(student)/lesson/[id]/page.tsx');
    expect(page).toContain('final: r.final, detail: r.detail');
  });
});

// ───────────────────── cartas (memoria de pares) ─────────────────────
describe('cartas (funciones puras)', () => {
  const served = () => (sanitizeGameData('flashcard_rapida', CARDS).cards as { key: number; text: string }[]);
  const key = (text: string) => served().find((c) => c.text === text)!.key;

  it('al navegador salen las cartas con una clave y su texto: sin parejas, sin explicacion', () => {
    const cards = served();
    expect(cards.map((c) => c.key)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(cards.map((c) => c.text).sort()).toEqual(['Estrella', 'Luna', 'Marte', 'Planeta', 'Satelite', 'Sol']);
    expect(Object.keys(sanitizeGameData('flashcard_rapida', CARDS)).sort()).toEqual(['cards', 'theme']);
    // cada carta lleva SOLO su clave y su texto: nada que diga con cual hace pareja
    for (const c of cards) expect(Object.keys(c).sort()).toEqual(['key', 'text']);
  });
  it('el orden es DETERMINISTA (servir y sondear coinciden) y no deja las parejas contiguas como en los datos', () => {
    expect(served()).toEqual(served());
    expect(served().map((c) => c.text)).not.toEqual(['Sol', 'Estrella', 'Luna', 'Satelite', 'Marte', 'Planeta']);
    // no depende del orden en que vengan los pares
    const reversed = { ...CARDS, pairs: [...CARDS.pairs].reverse() };
    const a = (sanitizeGameData('flashcard_rapida', reversed).cards as { key: number; text: string }[]).map((c) => c.text);
    expect(a.sort()).toEqual(served().map((c) => c.text).sort());
  });
  it('el sondeo dice si dos cartas coinciden', () => {
    expect(probeGame('flashcard_rapida', CARDS, { a: key('Sol'), b: key('Estrella') })).toEqual({ status: 'graded', correct: true });
    expect(probeGame('flashcard_rapida', CARDS, { a: key('Estrella'), b: key('Sol') })).toEqual({ status: 'graded', correct: true });
    expect(probeGame('flashcard_rapida', CARDS, { a: key('Sol'), b: key('Luna') })).toEqual({ status: 'graded', correct: false });
  });
  it('sondeo invalido: la misma carta, fuera de rango, que no sea entero, sin objeto, o datos sin pares utilizables', () => {
    for (const probe of [{ a: 1, b: 1 }, { a: 0, b: 99 }, { a: -1, b: 2 }, { a: 1.5, b: 2 }, { a: '1', b: 2 }, { a: 1 }, null, 'x']) {
      expect(probeGame('flashcard_rapida', CARDS, probe), JSON.stringify(probe)).toEqual({ status: 'invalid' });
    }
    expect(probeGame('flashcard_rapida', { pairs: [{ id: 1, card1: 'a', card2: 'b' }] }, { a: 0, b: 1 })).toEqual({ status: 'invalid' }); // menos de 2 pares
    expect(probeGame('flashcard_rapida', { pairs: [{ id: 1, card1: 'a', card2: 'b' }, { id: 1, card1: 'c', card2: 'd' }] }, { a: 0, b: 1 })).toEqual({ status: 'invalid' }); // ids repetidos
  });
  it('todos los pares bien se cierran como acierto; cualquier otra cosa no se puede cerrar', () => {
    const good = [[key('Sol'), key('Estrella')], [key('Luna'), key('Satelite')], [key('Marte'), key('Planeta')]];
    expect(gradeGame('flashcard_rapida', CARDS, { matches: good })).toEqual({ status: 'graded', correct: true });
    expect(gradeGame('flashcard_rapida', CARDS, { matches: [...good].reverse().map(([x, y]) => [y, x]) })).toEqual({ status: 'graded', correct: true });
    const bad: unknown[] = [
      undefined, 'x', [], good.slice(0, 2), [...good, [0, 1]],
      [[key('Sol'), key('Luna')], [key('Estrella'), key('Satelite')], [key('Marte'), key('Planeta')]], // pares equivocados
      [[key('Sol'), key('Estrella')], [key('Sol'), key('Estrella')], [key('Marte'), key('Planeta')]], // carta repetida
      [[1], [2, 3], [4, 5]], [[1, 1], [2, 3], [4, 5]], [[0, 99], [2, 3], [4, 5]], [['a', 'b'], [2, 3], [4, 5]],
    ];
    for (const matches of bad) expect(gradeGame('flashcard_rapida', CARDS, { matches }), JSON.stringify(matches)).toEqual({ status: 'invalid' });
  });
  it('revela solo la explicacion', () => {
    expect(buildGameReveal('flashcard_rapida', CARDS)).toEqual({ explanation: CARDS.pedagogical_feedback });
    expect(buildGameReveal('flashcard_rapida', {})).toEqual({ explanation: null });
  });
});

// ───────────────────── descifrador (palabra letra por letra) ─────────────────────
describe('descifrador (funciones puras)', () => {
  it('al navegador sale la MASCARA (letras ocultas, el resto visible), la pista inicial y cuantas pistas hay: ni la palabra ni las pistas', () => {
    expect(sanitizeGameData('el_descifrador', DECIPHER)).toEqual({ initial_clue: DECIPHER.initial_clue, mask: [null, null, null, null, null, null, null], hint_count: 3 });
    expect(sanitizeGameData('el_descifrador', { word_to_guess: 'AÑO NUEVO-2', hints: [] })).toEqual({ mask: [null, null, null, ' ', null, null, null, null, null, '-', '2'], hint_count: 0 });
    // una letra con tilde no cuenta como letra oculta (igual que el juego)
    expect((sanitizeGameData('el_descifrador', { word_to_guess: 'CANCIÓN' }).mask as unknown[])[5]).toBe('Ó');
  });
  it('sondeo de letra: posiciones y caracteres originales; sin importar mayusculas ni tildes', () => {
    expect(probeGame('el_descifrador', DECIPHER, { letter: 'E' })).toEqual({ status: 'graded', correct: true, data: { positions: [0], chars: ['E'] } });
    expect(probeGame('el_descifrador', DECIPHER, { letter: 'e' })).toEqual({ status: 'graded', correct: true, data: { positions: [0], chars: ['E'] } });
    expect(probeGame('el_descifrador', { word_to_guess: 'CASA' }, { letter: 'A' })).toEqual({ status: 'graded', correct: true, data: { positions: [1, 3], chars: ['A', 'A'] } });
    expect(probeGame('el_descifrador', DECIPHER, { letter: 'Z' })).toEqual({ status: 'graded', correct: false, data: { positions: [], chars: [] } });
  });
  it('la Ñ es una letra distinta de la N', () => {
    expect(probeGame('el_descifrador', { word_to_guess: 'AÑO' }, { letter: 'N' })).toMatchObject({ correct: false });
    expect(probeGame('el_descifrador', { word_to_guess: 'AÑO' }, { letter: 'Ñ' })).toMatchObject({ correct: true, data: { positions: [1] } });
  });
  it('sondeo de letra invalido: vacio, varias letras, digitos, tipos equivocados, palabra sin letras', () => {
    for (const probe of [{ letter: '' }, { letter: 'AB' }, { letter: '1' }, { letter: 5 }, { letter: '-' }, {}, null]) {
      expect(probeGame('el_descifrador', DECIPHER, probe), JSON.stringify(probe)).toEqual({ status: 'invalid' });
    }
    expect(probeGame('el_descifrador', { word_to_guess: '123' }, { letter: 'A' })).toEqual({ status: 'invalid' });
  });
  it('las pistas se piden de a una', () => {
    expect(probeGame('el_descifrador', DECIPHER, { hint: 0 })).toEqual({ status: 'graded', correct: true, data: { hint: 'Pista uno: llevaba registros' } });
    expect(probeGame('el_descifrador', DECIPHER, { hint: 2 })).toMatchObject({ data: { hint: 'Pista tres: viene de scribere' } });
    for (const hint of [3, -1, 1.5, NaN]) expect(probeGame('el_descifrador', DECIPHER, { hint }), String(hint)).toEqual({ status: 'invalid' });
  });
  const ESCRIBA = ['E', 'S', 'C', 'R', 'I', 'B', 'A'];
  it('gana si prueba todas las letras de la palabra con menos de 6 fallos', () => {
    expect(gradeGame('el_descifrador', DECIPHER, { letters: ESCRIBA })).toEqual({ status: 'graded', correct: true });
    expect(gradeGame('el_descifrador', DECIPHER, { letters: [...ESCRIBA, 'X', 'Y', 'Z', 'W', 'K'] })).toEqual({ status: 'graded', correct: true }); // 5 fallos
    expect(gradeGame('el_descifrador', DECIPHER, { letters: ['e', 's', 'c', 'r', 'i', 'b', 'a'] })).toEqual({ status: 'graded', correct: true }); // minusculas
  });
  it('pierde con 6 fallos (haya o no cubierto la palabra)', () => {
    expect(DECIPHER_MAX_WRONG).toBe(6);
    expect(gradeGame('el_descifrador', DECIPHER, { letters: ['X', 'Y', 'Z', 'W', 'K', 'J'] })).toEqual({ status: 'graded', correct: false });
    expect(gradeGame('el_descifrador', DECIPHER, { letters: [...ESCRIBA, 'X', 'Y', 'Z', 'W', 'K', 'J'] })).toEqual({ status: 'graded', correct: false }); // no se sabe cual vino primero: pierde
  });
  it('el juego aun no termino (faltan letras y quedan intentos): no se puede cerrar', () => {
    expect(gradeGame('el_descifrador', DECIPHER, { letters: ['E', 'S'] })).toEqual({ status: 'invalid' });
    expect(gradeGame('el_descifrador', DECIPHER, { letters: [] })).toEqual({ status: 'invalid' });
    expect(gradeGame('el_descifrador', DECIPHER, { letters: ['E', 'X', 'Y'] })).toEqual({ status: 'invalid' });
  });
  it('formas invalidas: no es lista, elementos que no son una letra, palabra sin letras', () => {
    for (const letters of [undefined, 'ESCRIBA', {}, ['ES'], [5], [''], ['1'], [null]]) expect(gradeGame('el_descifrador', DECIPHER, { letters }), JSON.stringify(letters)).toEqual({ status: 'invalid' });
    expect(gradeGame('el_descifrador', { word_to_guess: '123' }, { letters: ['A'] })).toEqual({ status: 'invalid' });
    expect(gradeGame('el_descifrador', {}, { letters: ['A'] })).toEqual({ status: 'invalid' });
  });
  it('letras repetidas cuentan una sola vez (un fallo repetido no suma)', () => {
    expect(gradeGame('el_descifrador', DECIPHER, { letters: [...ESCRIBA, 'X', 'X', 'X', 'X', 'X', 'X'] })).toEqual({ status: 'graded', correct: true });
  });
  it('revela la palabra y la explicacion', () => {
    expect(buildGameReveal('el_descifrador', DECIPHER)).toEqual({ word: 'ESCRIBA', explanation: DECIPHER.pedagogical_feedback });
    expect(buildGameReveal('el_descifrador', {})).toEqual({ word: '', explanation: null });
  });
});

describe('POST /api/lesson/answer: cartas y descifrador (comportamiento)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ejemplo.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'x'.repeat(40));
    vi.stubEnv('SERVER_GRADING', 'on');
    vi.stubEnv('SERVER_GRADING_GAMES', 'on');
    h.user = { id: 'stu-1' };
    h.hasKey = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  const send = async (answer: unknown) => (await post({ attemptId: ATT, questionId: QID, answer })).json();
  const key = (text: string) => (sanitizeGameData('flashcard_rapida', CARDS).cards as { key: number; text: string }[]).find((c) => c.text === text)!.key;

  it('descifrador: un sondeo de letra devuelve las posiciones y NO escribe nada', async () => {
    seed('el_descifrador');
    expect(await send({ probe: { letter: 'S' } })).toEqual({ correct: true, final: false, probe: true, detail: { positions: [1], chars: ['S'] } });
    expect(await send({ probe: { letter: 'Z' } })).toEqual({ correct: false, final: false, probe: true, detail: { positions: [], chars: [] } });
    expect(h.db.lesson_attempt_answers).toHaveLength(0);
    expect(h.db.question_attempts).toHaveLength(0);
  });
  it('descifrador: una pista se pide de a una y tampoco escribe', async () => {
    seed('el_descifrador');
    const body = await send({ probe: { hint: 1 } });
    expect(body).toMatchObject({ final: false, probe: true, detail: { hint: 'Pista dos: sin el no habria leyes escritas' } });
    expect(JSON.stringify(body)).not.toContain('Pista tres');
    expect(h.db.lesson_attempt_answers).toHaveLength(0);
  });
  it('descifrador: ganar cierra con acierto y revela la palabra', async () => {
    seed('el_descifrador');
    const body = await send({ letters: ['E', 'S', 'C', 'R', 'I', 'B', 'A'] });
    expect(body).toMatchObject({ correct: true, final: true, tries: 1, reveal: { word: 'ESCRIBA' } });
    expect(h.db.question_attempts).toEqual([expect.objectContaining({ was_correct: true, game_type: 'el_descifrador' })]);
  });
  it('descifrador: perder (6 fallos) cierra como fallo y revela la palabra', async () => {
    seed('el_descifrador');
    const body = await send({ letters: ['X', 'Y', 'Z', 'W', 'K', 'J'] });
    expect(body).toMatchObject({ correct: false, final: true, reveal: { word: 'ESCRIBA' } });
    expect(h.db.question_attempts).toEqual([expect.objectContaining({ was_correct: false, game_type: 'el_descifrador' })]);
  });
  it('descifrador: cerrar antes de terminar es 400 y no escribe ni gasta nada', async () => {
    seed('el_descifrador');
    expect((await post({ attemptId: ATT, questionId: QID, answer: { letters: ['E', 'S'] } })).status).toBe(400);
    expect(h.db.lesson_attempt_answers).toHaveLength(0);
  });
  it('descifrador: un sondeo invalido es 400', async () => {
    seed('el_descifrador');
    expect((await post({ attemptId: ATT, questionId: QID, answer: { probe: { letter: '1' } } })).status).toBe(400);
    expect((await post({ attemptId: ATT, questionId: QID, answer: { probe: { hint: 9 } } })).status).toBe(400);
  });

  it('cartas: un sondeo dice si coinciden y NO escribe nada', async () => {
    seed('flashcard_rapida');
    expect(await send({ probe: { a: key('Sol'), b: key('Estrella') } })).toEqual({ correct: true, final: false, probe: true });
    expect(await send({ probe: { a: key('Sol'), b: key('Luna') } })).toEqual({ correct: false, final: false, probe: true });
    expect(h.db.lesson_attempt_answers).toHaveLength(0);
    expect(h.db.question_attempts).toHaveLength(0);
  });
  it('cartas: encontrar todos los pares cierra con acierto', async () => {
    seed('flashcard_rapida');
    const body = await send({ matches: [[key('Sol'), key('Estrella')], [key('Luna'), key('Satelite')], [key('Marte'), key('Planeta')]] });
    expect(body).toMatchObject({ correct: true, final: true, tries: 1, reveal: { explanation: CARDS.pedagogical_feedback } });
    expect(h.db.question_attempts).toEqual([expect.objectContaining({ was_correct: true, game_type: 'flashcard_rapida' })]);
  });
  it('cartas: pares equivocados o incompletos es 400: no se puede declarar un acierto que no se logro', async () => {
    seed('flashcard_rapida');
    expect((await post({ attemptId: ATT, questionId: QID, answer: { matches: [[key('Sol'), key('Luna')], [key('Estrella'), key('Satelite')], [key('Marte'), key('Planeta')]] } })).status).toBe(400);
    expect((await post({ attemptId: ATT, questionId: QID, answer: { matches: [[key('Sol'), key('Estrella')]] } })).status).toBe(400);
    expect(h.db.lesson_attempt_answers).toHaveLength(0);
    expect(h.db.question_attempts).toHaveLength(0);
  });
  it('cartas: un sondeo invalido es 400', async () => {
    seed('flashcard_rapida');
    expect((await post({ attemptId: ATT, questionId: QID, answer: { probe: { a: 0, b: 0 } } })).status).toBe(400);
  });
});

describe('cartas y descifrador en el navegador', () => {
  it('el descifrador sondea cada letra y cada pista, y cierra con las letras jugadas', () => {
    const src = read('src/components/minigames/ElDescifrador.tsx');
    expect(src).toContain('check({ probe: { letter: norm } })');
    expect(src).toContain('check({ probe: { hint: hintsRevealed } })');
    expect(src).toContain('check!({ letters: Array.from(played) })');
  });
  it('las cartas sondean cada par volteado y cierran con la lista de pares', () => {
    const src = read('src/components/minigames/FlashcardGame.tsx');
    expect(src).toContain('check({ probe: { a: cards[a].key, b: cards[b].key } })');
    expect(src).toContain('check!({ matches })');
  });
});
