import { afterEach, describe, expect, it, vi } from 'vitest';
import { selfGrade, type PlayableRow } from './selfGrade';
import { gradeAnswer } from '@/lib/grading/gradeAnswer';
import { gradeGame, probeGame, sanitizeGameData } from '@/lib/grading/gameGrading';

// Los calificadores reales, con un interruptor para FORZAR un desacuerdo con los datos (lo que pasaria el dia que el calificador cambie su protocolo).
const mode = vi.hoisted(() => ({
  answer: 'real' as 'real' | 'invalid' | 'correct' | 'wrong' | 'noDefs' | 'noPairing',
  game: 'real' as 'real' | 'invalid' | 'correct' | 'wrong',
  probe: 'real' as 'real' | 'none',
}));
const forced = (m: string) => (m === 'invalid' ? { status: 'invalid' } : m === 'correct' ? { status: 'graded', correct: true } : { status: 'graded', correct: false });
vi.mock('@/lib/grading/gradeAnswer', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/grading/gradeAnswer')>();
  return {
    ...real,
    gradeAnswer: (k: any, a: any) => {
      // 'noDefs' / 'noPairing': el calificador deja de entender UNA de las dos formas de responder un emparejar.
      if (mode.answer === 'noDefs') return a && 'defs' in a ? forced('invalid') : real.gradeAnswer(k, a);
      if (mode.answer === 'noPairing') return a && 'pairing' in a ? forced('invalid') : real.gradeAnswer(k, a);
      return mode.answer === 'real' ? real.gradeAnswer(k, a) : forced(mode.answer);
    },
  };
});
vi.mock('@/lib/grading/gameGrading', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/grading/gameGrading')>();
  return {
    ...real,
    gradeGame: (t: string, d: unknown, a: unknown) => (mode.game === 'real' ? real.gradeGame(t, d, a) : forced(mode.game)),
    probeGame: (t: string, d: unknown, p: unknown) => (mode.probe === 'real' ? real.probeGame(t, d, p) : { status: 'graded', correct: false }),
  };
});
afterEach(() => {
  mode.answer = 'real';
  mode.game = 'real';
  mode.probe = 'real';
});

const fails = (row: PlayableRow) => selfGrade(row).failures.join(' | ');
const passes = (row: PlayableRow) => {
  const r = selfGrade(row);
  expect(r.failures, JSON.stringify(r.failures)).toEqual([]);
  expect(r.status).toBe('pass');
  return r;
};

// ───────────────────────────── fixtures validos ─────────────────────────────
const mc = (over: Partial<PlayableRow> = {}): PlayableRow => ({ type: 'multiple_choice', q: '¿Que mide la elasticidad?', opts: ['A. El precio', 'B. La sensibilidad', 'C. El ingreso', 'D. La cantidad'], ok: 1, ...over });
const tf = (over: Partial<PlayableRow> = {}): PlayableRow => ({ type: 'true_false', q: 'La demanda es decreciente.', ok: true, ...over });
const fill = (over: Partial<PlayableRow> = {}): PlayableRow => ({ type: 'fill_blank', q: 'La ___ mide la sensibilidad.', answers: ['elasticidad'], ...over });
const short = (over: Partial<PlayableRow> = {}): PlayableRow => ({ type: 'short_answer', q: 'Define la elasticidad.', keywords: ['sensibilidad', 'precio'], ...over });
const match = (over: Partial<PlayableRow> = {}): PlayableRow => ({
  type: 'match',
  q: 'Relaciona.',
  pairs: [
    { term: 'Oferta', def: 'Cantidad que se ofrece' },
    { term: 'Demanda', def: 'Cantidad que se pide' },
  ],
  ...over,
});
const game = (type: string, game_data: unknown): PlayableRow => ({ type, game_data });

const impostor = () => ({ context: 'ctx', statements: [{ id: 1, text: 'a', is_impostor: false }, { id: 2, text: 'b', is_impostor: false }, { id: 3, text: 'c', is_impostor: true }] });
const alquimia = () => ({ bridge_options: [{ id: 'a', text: 'x', is_correct: false }, { id: 'b', text: 'y', is_correct: true }, { id: 'c', text: 'z', is_correct: false }] });
const crisis = () => ({ interventions: [{ action_code: 'ALPHA', is_solution: true }, { action_code: 'BETA', is_solution: false }, { action_code: 'GAMMA', is_solution: false }] });
const juicio = () => ({ expert_testimony: [{ paragraph_id: 1, text: 'a' }, { paragraph_id: 2, text: 'b' }, { paragraph_id: 3, text: 'c' }], guilty_paragraph_id: 2 });
const timeline = () => ({ items: [{ id: 1, text: 'a', correct_position: 2 }, { id: 2, text: 'b', correct_position: 1 }, { id: 3, text: 'c', correct_position: 3 }] });
const categories = () => ({ categories: ['Alta', 'Baja'], items: [{ id: 1, text: 'a', correct_category: 'Alta' }, { id: 2, text: 'b', correct_category: 'Baja' }, { id: 3, text: 'c', correct_category: 'Alta' }] });
const flash = () => ({ pairs: [{ id: 1, card1: 'Oferta', card2: 'Lo que se ofrece' }, { id: 2, card1: 'Demanda', card2: 'Lo que se pide' }, { id: 3, card1: 'Precio', card2: 'Valor de cambio' }] });
const decipher = () => ({ word_to_guess: 'ELASTICIDAD', hints: ['mide la sensibilidad'], initial_clue: '?' });

describe('selfGrade: lo bien formado pasa', () => {
  it.each([
    ['opcion multiple', mc()],
    ['verdadero/falso', tf()],
    ['verdadero/falso con falso', tf({ ok: false })],
    ['completar', fill()],
    ['respuesta corta', short()],
    ['emparejar', match()],
    ['impostor', game('impostor_cognitivo', impostor())],
    ['alquimia', game('alquimia_conceptual', alquimia())],
    ['cuarto de crisis', game('cuarto_crisis', crisis())],
    ['juicio', game('juicio_conocimiento', juicio())],
    ['linea del tiempo', game('linea_del_tiempo', timeline())],
    ['categorias', game('categorias_rapidas', categories())],
    ['cartas', game('flashcard_rapida', flash())],
    ['descifrador', game('el_descifrador', decipher())],
  ] as [string, PlayableRow][])('%s', (_n, row) => {
    const r = passes(row);
    expect(r.kind).toBe(row.type === 'multiple_choice' || row.type === 'true_false' || row.type === 'fill_blank' || row.type === 'short_answer' || row.type === 'match' ? 'classic' : 'game');
  });
  it('una palabra con tildes y Ñ se descifra (la Ñ no es la N)', () => {
    passes(game('el_descifrador', { word_to_guess: 'AÑO ÁRBOL', hints: ['h'] }));
  });
  it('las opciones con letra (A., B)) o sin letra valen igual', () => {
    passes(mc({ opts: ['uno', 'dos', 'tres'], ok: 2 }));
    passes(mc({ opts: ['A) uno', 'B) dos'], ok: 0 }));
  });
});

describe('selfGrade: opcion multiple', () => {
  it('sin enunciado', () => expect(fails(mc({ q: '' }))).toMatch(/enunciado/));
  it('menos de 2 opciones, mas de 8, vacias o que no son texto', () => {
    expect(fails(mc({ opts: ['A. solo'], ok: 0 }))).toMatch(/menos de 2 opciones/);
    expect(fails(mc({ opts: Array.from({ length: 9 }, (_, i) => `opcion ${i}`), ok: 0 }))).toMatch(/mas de 8/);
    expect(fails(mc({ opts: ['A. uno', 'B. ', 'C. tres'], ok: 0 }))).toMatch(/vacia/);
    expect(fails(mc({ opts: ['A. uno', 5, 'C. tres'], ok: 0 }))).toMatch(/vacia|no es texto/);
    expect(fails(mc({ opts: 'no es lista' }))).toMatch(/menos de 2 opciones/);
  });
  it.each([[-1], [4], [1.5], ['1'], [null], [undefined]])('la respuesta correcta invalida (%s)', (ok) => {
    expect(fails(mc({ ok }))).toMatch(/no apunta a ninguna opcion/);
  });
  it('dos opciones que dicen lo mismo (sin importar letra, mayusculas ni tildes) son ambiguas', () => {
    expect(fails(mc({ opts: ['A. La sensibilidad', 'B. otra', 'C. la SENSIBILIDAD'], ok: 0 }))).toMatch(/dicen lo mismo/);
    expect(fails(mc({ opts: ['A. Elasticidad', 'B. Elástícidad'.replace('í', 'i'), 'C. otra'], ok: 2 }))).toMatch(/dicen lo mismo/);
  });
  it('la correcta en cualquier posicion (0 y la ultima) pasa', () => {
    passes(mc({ ok: 0 }));
    passes(mc({ ok: 3 }));
  });
});

describe('selfGrade: verdadero/falso, completar, respuesta corta y emparejar', () => {
  it('verdadero/falso sin booleano', () => {
    for (const ok of ['true', 1, null, undefined]) expect(fails(tf({ ok }))).toMatch(/verdadera o falsa/);
  });
  it('completar y respuesta corta sin respuestas, o con una vacia', () => {
    expect(fails(fill({ answers: [] }))).toMatch(/respuestas esperadas/);
    expect(fails(fill({ answers: undefined }))).toMatch(/respuestas esperadas/);
    expect(fails(short({ keywords: [] }))).toMatch(/palabras clave/);
    expect(fails(fill({ answers: ['ok', '  '] }))).toMatch(/vacia/);
    expect(fails(short({ keywords: ['ok', ''] }))).toMatch(/vacia/);
  });
  it('una respuesta de un solo caracter es un AVISO (no una falla): se acepta si aparece en cualquier parte del texto', () => {
    const r = selfGrade(fill({ answers: ['y'] }));
    expect(r.status).toBe('pass');
    expect(r.warnings.join()).toMatch(/un solo caracter/);
    expect(selfGrade(short({ keywords: ['x', 'y', 'lambda'] })).warnings.join()).toMatch(/un solo caracter/);
    expect(selfGrade(fill()).warnings).toEqual([]);
  });
  it('emparejar: menos de 2 pares, par vacio', () => {
    expect(fails(match({ pairs: [{ term: 'a', def: 'b' }] }))).toMatch(/menos de 2 pares/);
    expect(fails(match({ pairs: [{ term: 'a', def: '' }, { term: 'b', def: 'c' }] }))).toMatch(/vacios/);
    expect(fails(match({ pairs: [{ term: ' ', def: 'x' }, { term: 'b', def: 'c' }] }))).toMatch(/vacios/);
    expect(fails(match({ pairs: 'no' }))).toMatch(/menos de 2 pares/);
  });
  it('emparejar con definiciones iguales es un AVISO: intercambiar esos terminos tambien es correcto', () => {
    const r = selfGrade(match({ pairs: [{ term: 'Vaca', def: 'Animal' }, { term: 'Cerdo', def: 'Animal' }, { term: 'Trigo', def: 'Vegetal' }] }));
    expect(r.status).toBe('pass');
    expect(r.warnings.join()).toMatch(/definiciones son iguales/);
  });
});

describe('selfGrade: elegir UNA opcion (impostor, alquimia, cuarto de crisis, juicio)', () => {
  it('impostor: ninguno, dos, ids repetidos, ids que no son numeros, menos de 2', () => {
    const g = impostor();
    expect(fails(game('impostor_cognitivo', { ...g, statements: g.statements.map((s) => ({ ...s, is_impostor: false })) }))).toMatch(/Ninguna opcion/);
    expect(fails(game('impostor_cognitivo', { ...g, statements: g.statements.map((s) => ({ ...s, is_impostor: true })) }))).toMatch(/3 soluciones/);
    expect(fails(game('impostor_cognitivo', { ...g, statements: [{ id: 1, is_impostor: false }, { id: 1, is_impostor: true }] }))).toMatch(/identificadores/);
    expect(fails(game('impostor_cognitivo', { ...g, statements: [{ id: '1', is_impostor: false }, { id: '2', is_impostor: true }] }))).toMatch(/identificadores/);
    expect(fails(game('impostor_cognitivo', { ...g, statements: [{ id: 1, is_impostor: true }] }))).toMatch(/menos de 2/);
  });
  it('alquimia: sin correcta, dos correctas, ids repetidos', () => {
    const o = alquimia().bridge_options;
    expect(fails(game('alquimia_conceptual', { bridge_options: o.map((x) => ({ ...x, is_correct: false })) }))).toMatch(/Ninguna/);
    expect(fails(game('alquimia_conceptual', { bridge_options: o.map((x) => ({ ...x, is_correct: true })) }))).toMatch(/3 soluciones/);
    expect(fails(game('alquimia_conceptual', { bridge_options: [{ id: 'a', is_correct: true }, { id: 'a', is_correct: false }] }))).toMatch(/identificadores/);
  });
  it('cuarto de crisis: sin solucion, dos soluciones, codigos repetidos', () => {
    const iv = crisis().interventions;
    expect(fails(game('cuarto_crisis', { interventions: iv.map((x) => ({ ...x, is_solution: false })) }))).toMatch(/Ninguna/);
    expect(fails(game('cuarto_crisis', { interventions: iv.map((x) => ({ ...x, is_solution: true })) }))).toMatch(/3 soluciones/);
    expect(fails(game('cuarto_crisis', { interventions: [{ action_code: 'A', is_solution: true }, { action_code: 'A', is_solution: false }] }))).toMatch(/identificadores/);
  });
  it('juicio: el culpable no es ningun parrafo, ids repetidos, un solo parrafo', () => {
    const j = juicio();
    expect(fails(game('juicio_conocimiento', { ...j, guilty_paragraph_id: 9 }))).toMatch(/no es ninguno de los parrafos/);
    expect(fails(game('juicio_conocimiento', { ...j, guilty_paragraph_id: '2' }))).toMatch(/no es ninguno de los parrafos/);
    expect(fails(game('juicio_conocimiento', { ...j, expert_testimony: [{ paragraph_id: 1 }, { paragraph_id: 1 }], guilty_paragraph_id: 1 }))).toMatch(/identificadores/);
    expect(fails(game('juicio_conocimiento', { ...j, expert_testimony: [{ paragraph_id: 2 }], guilty_paragraph_id: 2 }))).toMatch(/menos de 2/);
  });
});

describe('selfGrade: ordenar, clasificar, cartas y descifrador', () => {
  it('linea del tiempo: posiciones repetidas, con huecos, fuera de rango, menos de 2 eventos, ids repetidos', () => {
    const t = timeline();
    expect(fails(game('linea_del_tiempo', { items: t.items.map((it, i) => ({ ...it, correct_position: i === 2 ? 1 : it.correct_position })) }))).toMatch(/orden valido/);
    expect(fails(game('linea_del_tiempo', { items: t.items.map((it, i) => ({ ...it, correct_position: i + 2 })) }))).toMatch(/orden valido/);
    expect(fails(game('linea_del_tiempo', { items: t.items.map((it) => ({ ...it, correct_position: 0 })) }))).toMatch(/orden valido/);
    expect(fails(game('linea_del_tiempo', { items: [t.items[0]] }))).toMatch(/menos de 2/);
    expect(fails(game('linea_del_tiempo', { items: [{ id: 1, correct_position: 1 }, { id: 1, correct_position: 2 }] }))).toMatch(/identificadores/);
    expect(fails(game('linea_del_tiempo', { items: t.items.map((it) => ({ ...it, correct_position: String(it.correct_position) })) }))).toMatch(/orden valido/);
  });
  it('categorias: una categoria correcta que no existe, categorias repetidas, menos de 2, sin elementos, ids repetidos', () => {
    const c = categories();
    expect(fails(game('categorias_rapidas', { ...c, items: [{ id: 1, correct_category: 'Otra' }, { id: 2, correct_category: 'Alta' }] }))).toMatch(/no esta entre las categorias/);
    expect(fails(game('categorias_rapidas', { ...c, categories: ['Alta', 'alta'] }))).toMatch(/repetidas/);
    expect(fails(game('categorias_rapidas', { ...c, categories: ['Alta'] }))).toMatch(/menos de 2 categorias/);
    expect(fails(game('categorias_rapidas', { ...c, items: [] }))).toMatch(/No tiene elementos/);
    expect(fails(game('categorias_rapidas', { ...c, items: [{ id: 1, correct_category: 'Alta' }, { id: 1, correct_category: 'Baja' }] }))).toMatch(/identificadores/);
  });
  it('categorias: todos en la misma categoria es un AVISO', () => {
    const c = categories();
    const r = selfGrade(game('categorias_rapidas', { ...c, items: c.items.map((it) => ({ ...it, correct_category: 'Alta' })) }));
    expect(r.status).toBe('pass');
    expect(r.warnings.join()).toMatch(/misma categoria/);
  });
  it('cartas: ids repetidos, menos de 2 pares, una carta sin texto', () => {
    expect(fails(game('flashcard_rapida', { pairs: [{ id: 1, card1: 'a', card2: 'b' }, { id: 1, card1: 'c', card2: 'd' }] }))).toMatch(/cartas no son validas/);
    expect(fails(game('flashcard_rapida', { pairs: [{ id: 1, card1: 'a', card2: 'b' }] }))).toMatch(/cartas no son validas/);
    expect(fails(game('flashcard_rapida', { pairs: [{ id: 1, card1: 'a', card2: 'b' }, { id: 2, card1: 'c' }] }))).toMatch(/cartas no son validas/);
  });
  it('cartas: encuentra la pareja de cada una con el sondeo del servidor, con 2 y con 6 pares', () => {
    passes(game('flashcard_rapida', { pairs: [{ id: 1, card1: 'a1', card2: 'b1' }, { id: 2, card1: 'a2', card2: 'b2' }] }));
    passes(game('flashcard_rapida', { pairs: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, card1: `termino ${i}`, card2: `definicion ${i}` })) }));
  });
  it('descifrador: una palabra sin letras, vacia o sin datos', () => {
    expect(fails(game('el_descifrador', { word_to_guess: '1234 --' }))).toMatch(/ninguna letra/);
    expect(fails(game('el_descifrador', { word_to_guess: '' }))).toMatch(/ninguna letra/);
    expect(fails(game('el_descifrador', { hints: ['h'] }))).toMatch(/ninguna letra/);
  });
  it('descifrador: avisos de palabra casi imposible de fallar y de pistas ausentes', () => {
    const r = selfGrade(game('el_descifrador', { word_to_guess: 'OO' }));
    expect(r.status).toBe('pass');
    expect(r.warnings.join()).toMatch(/menos de 3 letras/);
    expect(r.warnings.join()).toMatch(/No tiene pistas/);
    expect(selfGrade(game('el_descifrador', decipher())).warnings).toEqual([]);
  });
});

describe('selfGrade: entradas raras', () => {
  it('un juego sin datos o con datos que no son un objeto', () => {
    for (const gd of [null, undefined, 'texto', 5, [], true]) expect(fails(game('impostor_cognitivo', gd)), String(gd)).toMatch(/No tiene datos de juego/);
  });
  it('un tipo que no se califica en el servidor se omite', () => {
    expect(selfGrade({ type: 'tipo_futuro', q: 'x' })).toEqual({ status: 'skip', kind: 'unsupported', failures: [], warnings: [] });
  });
  it('una fila sin tipo falla', () => {
    expect(selfGrade({} as PlayableRow).status).toBe('fail');
    expect(selfGrade(null as unknown as PlayableRow).status).toBe('fail');
    expect(selfGrade({ type: 5 } as unknown as PlayableRow).status).toBe('fail');
  });
  it('NUNCA lanza con basura en cualquier campo', () => {
    let seed = 31;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
    const junk = (d: number): unknown => {
      const r = rnd();
      if (d === 0 || r < 0.3) return [null, undefined, 1, -1, 'x', '', true, NaN, {}, [], 'A. t'][Math.floor(rnd() * 11)];
      if (r < 0.6) return Array.from({ length: Math.floor(rnd() * 4) }, () => junk(d - 1));
      const o: Record<string, unknown> = {};
      for (const k of ['id', 'text', 'is_impostor', 'is_correct', 'is_solution', 'action_code', 'paragraph_id', 'correct_position', 'correct_category', 'card1', 'card2', 'statements', 'bridge_options', 'interventions', 'expert_testimony', 'guilty_paragraph_id', 'items', 'categories', 'pairs', 'word_to_guess', 'hints']) if (rnd() < 0.35) o[k] = junk(d - 1);
      return o;
    };
    const types = ['multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'match', 'impostor_cognitivo', 'alquimia_conceptual', 'cuarto_crisis', 'juicio_conocimiento', 'linea_del_tiempo', 'categorias_rapidas', 'flashcard_rapida', 'el_descifrador', 'otro'];
    for (let i = 0; i < 1500; i++) {
      const row = { type: types[i % types.length], q: junk(1), opts: junk(2), ok: junk(1), answers: junk(2), pairs: junk(3), keywords: junk(2), game_data: junk(4) } as PlayableRow;
      expect(() => selfGrade(row)).not.toThrow();
    }
  });
});

describe('selfGrade usa los calificadores REALES (no los reimplementa)', () => {
  it('PROPIEDAD: todo juego bien formado que sale "pass" lo califica el servidor como 100 %, y viceversa para uno roto', () => {
    let seed = 77;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
    const int = (n: number) => Math.floor(rnd() * n);
    for (let i = 0; i < 200; i++) {
      const n = 2 + int(5);
      // linea del tiempo con una permutacion al azar
      const perm = Array.from({ length: n }, (_, k) => k + 1).sort(() => rnd() - 0.5);
      const tl = { items: perm.map((p, k) => ({ id: k + 1, text: `e${k}`, correct_position: p })) };
      expect(selfGrade(game('linea_del_tiempo', tl)).status).toBe('pass');
      const order = tl.items.slice().sort((a, b) => a.correct_position - b.correct_position).map((it) => it.id);
      expect(gradeGame('linea_del_tiempo', tl, { order })).toMatchObject({ status: 'graded', correct: true });
      // cartas al azar
      const pairs = Array.from({ length: n }, (_, k) => ({ id: k + 10, card1: `t${k}-${int(99)}`, card2: `d${k}-${int(99)}` }));
      expect(selfGrade(game('flashcard_rapida', { pairs })).status).toBe('pass');
      // descifrador al azar
      const word = Array.from({ length: 3 + int(8) }, () => 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'[int(27)]).join('');
      expect(selfGrade(game('el_descifrador', { word_to_guess: word, hints: ['p'] })).status).toBe('pass');
      // y uno roto (dos impostores) falla siempre
      const st = Array.from({ length: n }, (_, k) => ({ id: k + 1, text: `s${k}`, is_impostor: k < 2 }));
      expect(selfGrade(game('impostor_cognitivo', { statements: st })).status).toBe('fail');
    }
  });
  it('la respuesta que simula la compuerta es la misma que acepta el calificador (preguntas clasicas)', () => {
    const row = mc();
    expect(gradeAnswer(row as any, { selectedIndex: row.ok })).toMatchObject({ status: 'graded', correct: true });
    expect(gradeAnswer(row as any, { selectedIndex: 0 })).toMatchObject({ status: 'graded', correct: false });
  });
  it('las cartas: la clave de cada carta que usa la compuerta es la del servidor', () => {
    const gd = flash();
    const cards = sanitizeGameData('flashcard_rapida', gd).cards as { key: number; text: string }[];
    expect(cards).toHaveLength(6);
    const partner = cards.filter((b) => b.key !== cards[0].key && (probeGame('flashcard_rapida', gd, { a: cards[0].key, b: b.key }) as { correct?: boolean }).correct);
    expect(partner).toHaveLength(1);
  });
});

describe('selfGrade DETECTA el desacuerdo con el calificador real (si el calificador cambia, la simulacion lo nota)', () => {
  const classicRows: [string, PlayableRow][] = [['opcion multiple', mc()], ['verdadero/falso', tf()], ['completar', fill()], ['respuesta corta', short()], ['emparejar', match()]];
  const allGames: [string, PlayableRow][] = [
    ['impostor', game('impostor_cognitivo', impostor())],
    ['alquimia', game('alquimia_conceptual', alquimia())],
    ['cuarto de crisis', game('cuarto_crisis', crisis())],
    ['juicio', game('juicio_conocimiento', juicio())],
    ['linea del tiempo', game('linea_del_tiempo', timeline())],
    ['categorias', game('categorias_rapidas', categories())],
    ['cartas', game('flashcard_rapida', flash())],
    ['descifrador', game('el_descifrador', decipher())],
  ];

  it.each(classicRows)('clasica (%s): si el calificador RECHAZA la respuesta oficial, falla', (_n, row) => {
    mode.answer = 'invalid';
    expect(fails(row)).toMatch(/no la acepta/);
  });
  it.each(classicRows)('clasica (%s): si el calificador la da por INCORRECTA, falla', (_n, row) => {
    mode.answer = 'wrong';
    expect(fails(row)).toMatch(/INCORRECTA/);
  });
  it.each(classicRows.filter(([n]) => n !== 'emparejar'))('clasica (%s): si el calificador da por correcta CUALQUIER respuesta, es ambigua', (_n, row) => {
    mode.answer = 'correct';
    expect(fails(row)).toMatch(/tambien se califica como correcta/);
  });
  it.each(allGames)('juego (%s): si el calificador RECHAZA la jugada perfecta, falla', (_n, row) => {
    mode.game = 'invalid';
    expect(fails(row)).toMatch(/no la acepta/);
  });
  it.each(allGames)('juego (%s): si el calificador da la jugada perfecta por INCORRECTA, falla', (_n, row) => {
    mode.game = 'wrong';
    expect(fails(row)).toMatch(/INCORRECTA/);
  });
  it.each(allGames.filter(([n]) => !['cartas', 'descifrador'].includes(n)))('juego (%s): si el calificador da por correcta CUALQUIER jugada, es ambiguo', (_n, row) => {
    mode.game = 'correct';
    expect(fails(row)).toMatch(/tambien se califica como correcta/);
  });
  it('emparejar: cada una de las DOS formas de responder se simula por separado', () => {
    mode.answer = 'noDefs';
    expect(fails(match())).toMatch(/Conectar cada termino con su definicion: el calificador no la acepta/);
    mode.answer = 'noPairing';
    expect(fails(match())).toMatch(/Conectar en orden \(modo sombra\): el calificador no la acepta/);
  });
  it('cartas: si el sondeo del servidor no encuentra la pareja de una carta, falla con un mensaje claro (no se rompe)', () => {
    mode.probe = 'none';
    expect(fails(game('flashcard_rapida', flash()))).toMatch(/no tiene pareja segun el calificador/);
  });
  it('cada comprobacion de "otra opcion" apunta a la opcion concreta', () => {
    mode.game = 'correct';
    expect(fails(game('impostor_cognitivo', impostor()))).toMatch(/La opcion «1»/);
    expect(fails(game('cuarto_crisis', crisis()))).toMatch(/Dejar acabar el tiempo/);
    expect(fails(game('categorias_rapidas', categories()))).toMatch(/Dejar acabar el tiempo/);
    expect(fails(game('linea_del_tiempo', timeline()))).toMatch(/El orden inverso/);
    expect(fails(game('juicio_conocimiento', juicio()))).toMatch(/El parrafo 1/);
    mode.answer = 'correct';
    expect(fails(mc())).toMatch(/La opcion 1/);
    expect(fails(tf())).toMatch(/La respuesta contraria/);
    expect(fails(fill())).toMatch(/No escribir nada/);
  });
  it('con los calificadores reales (sin forzar nada) todo vuelve a pasar', () => {
    for (const [, row] of [...classicRows, ...allGames]) passes(row);
  });
});
