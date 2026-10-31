import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SERVER_GRADED_GAME_TYPES, buildGameReveal, gradeGame, isGradedGameType, sanitizeGameData } from './gameGrading';
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
const GAMES = { impostor_cognitivo: IMPOSTOR, alquimia_conceptual: ALQUIMIA, cuarto_crisis: CRISIS, juicio_conocimiento: JUICIO } as const;

const SOLUTION_STRINGS = [
  'is_impostor', 'is_correct', 'is_solution', 'guilty_paragraph_id', 'consequence',
  'exposicion_del_impostor', 'unlocked_knowledge', 'post_mortem_report', 'verdict_explanation',
  'cloroplastos, no en', 'El precio de equilibrio iguala', 'Crisis evitada', 'Colapso diferido', 'Explosion', 'perdida de moderacion', 'conservacion', 'NO-DEBE-SALIR',
];

describe('tipos', () => {
  it('son los cuatro juegos de "elegir una opcion"', () => {
    expect([...SERVER_GRADED_GAME_TYPES]).toEqual(['impostor_cognitivo', 'alquimia_conceptual', 'cuarto_crisis', 'juicio_conocimiento']);
    expect(isGradedGameType('impostor_cognitivo')).toBe(true);
    for (const t of ['linea_del_tiempo', 'categorias_rapidas', 'flashcard_rapida', 'el_descifrador', 'multiple_choice', '', undefined, null, 7]) expect(isGradedGameType(t)).toBe(false);
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
    expect(sanitizeGameData('linea_del_tiempo', IMPOSTOR)).toEqual({});
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
    expect(gradeGame('linea_del_tiempo', {}, {})).toEqual({ status: 'unsupported' });
    expect(gradeGame('multiple_choice', {}, {})).toEqual({ status: 'unsupported' });
    // el tipo se comprueba ANTES que la forma de la respuesta: un juego que no se califica aqui no es "invalid", es "unsupported"
    expect(gradeGame('linea_del_tiempo', {}, null)).toEqual({ status: 'unsupported' });
    expect(gradeGame('el_descifrador', {}, 'x')).toEqual({ status: 'unsupported' });
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
    const timeline = { id: 'g2', type: 'linea_del_tiempo', game_data: { items: [{ id: 1, text: 'a', correct_position: 1 }] } };
    expect(sanitizeQuestion(timeline, Math.random, { games: true })).toBe(timeline);
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
    { id: 'g2', type: 'linea_del_tiempo', q: 'Ordena', exp: 'EXP-TIEMPO', game_type: 'linea_del_tiempo', game_data: { items: [{ id: 1, text: 'a', correct_position: 1 }] } },
  ];

  it('con ambos interruptores: el juego sale sin solucion y entra en el intento; los juegos aun no migrados salen intactos', async () => {
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
  it('los cuatro juegos reciben `check` desde la pagina y, calificados en el servidor, no se registran desde el navegador', () => {
    for (const comp of ['ImpostorCognitivoGame', 'AlquimiaConceptualGame', 'CuartoCrisisGame', 'JuicioConocimientoGame']) {
      const block = page.slice(page.indexOf(`<${comp}`), page.indexOf('/>', page.indexOf(`<${comp}`)));
      expect(block, comp).toContain('check={gameCheck(q)}');
      expect(block, comp).toContain('finishGame(q, correct)');
      expect(block, comp).not.toContain('recordAttempt');
    }
    expect(page).toMatch(/if \(q\.serverGraded\) reactToResult\(correct\);\s*else recordAttempt\(q, correct, null\);/);
  });
  it('los juegos que aun no migran siguen registrando desde el navegador', () => {
    for (const comp of ['ElDescifrador', 'TimelineGame', 'CategoriesGame', 'FlashcardGame']) {
      const block = page.slice(page.indexOf(`<${comp}`), page.indexOf('/>', page.indexOf(`<${comp}`)));
      expect(block, comp).toContain('recordAttempt(q, correct, null)');
      expect(block, comp).not.toContain('check=');
    }
  });
  for (const comp of ['ImpostorCognitivoGame', 'AlquimiaConceptualGame', 'CuartoCrisisGame', 'JuicioConocimientoGame']) {
    it(`${comp}: con \`check\` espera al servidor, no conoce la solucion y deja reintentar si no se pudo comprobar`, () => {
      const src = read(`src/components/minigames/${comp}.tsx`);
      expect(src).toContain('check?: GameCheck');
      expect(src).toContain('await check(');
      expect(src).toContain('CHECK_ERROR');
      expect(src).toContain('Comprobando…');
      // los campos de solucion son OPCIONALES en los datos del juego (no vienen del servidor)
      expect(src).toMatch(/is_impostor\?|is_correct\?|is_solution\?|guilty_paragraph_id\?/);
    });
  }
  it('Cuarto de Crisis informa al servidor cuando se acaba el tiempo', () => {
    expect(read('src/components/minigames/CuartoCrisisGame.tsx')).toContain('check({ selectedCode: null })');
  });
});
