import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { gradeAnswer } from './gradeAnswer';
import { isValidQuestion } from '@/lib/lesson/validateQuestion';
import { buildReveal, isFinalTry, isServerGradedType, sanitizeQuestion, serverGradingEnabled, MAX_TRIES } from './serverGrading';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

const MC = { id: 'q1', type: 'multiple_choice', q: '¿Capital?', opts: ['A. Lima', 'B. Bogotá'], ok: 1, exp: 'Bogotá es la capital', concept_tag: 'geo' };
const TF = { id: 'q2', type: 'true_false', q: 'El agua hierve a 100 C', ok: true, exp: 'A nivel del mar' };
const FILL = { id: 'q3', type: 'fill_blank', q: 'La ___ produce oxigeno', answers: ['fotosintesis'], exp: 'Ocurre en las hojas' };
const SHORT = { id: 'q4', type: 'short_answer', q: 'Explica la celula', keywords: ['nucleo', 'membrana'], exp: 'Tiene nucleo y membrana' };
const MATCH = { id: 'q5', type: 'match', q: 'Conecta', pairs: [{ term: 'Sol', def: 'Estrella' }, { term: 'Luna', def: 'Satelite' }, { term: 'Marte', def: 'Planeta' }], exp: 'Astronomia' };

describe('sanitizeQuestion: lo que llega al navegador no trae la solucion', () => {
  it.each([MC, TF, FILL, SHORT, MATCH])('$type: ni claves ni explicacion', (q) => {
    const out = sanitizeQuestion(q);
    expect(out.serverGraded).toBe(true);
    for (const k of ['ok', 'answers', 'keywords', 'pairs', 'exp']) expect(out).not.toHaveProperty(k);
    const text = JSON.stringify(out);
    for (const secret of ['Bogotá es la capital', 'A nivel del mar', 'fotosintesis', 'nucleo', 'Astronomia']) expect(text).not.toContain(secret);
  });

  it('conserva lo necesario para mostrarla (id, enunciado, opciones, concepto)', () => {
    const out = sanitizeQuestion(MC);
    expect(out).toMatchObject({ id: 'q1', type: 'multiple_choice', q: '¿Capital?', opts: ['A. Lima', 'B. Bogotá'], concept_tag: 'geo' });
  });

  it('emparejar: terminos y definiciones por separado, mismas definiciones, mezcladas', () => {
    const out = sanitizeQuestion(MATCH, () => 0.1);
    expect(out.terms).toEqual(['Sol', 'Luna', 'Marte']);
    expect([...out.defs].sort()).toEqual(['Estrella', 'Planeta', 'Satelite']);
    // el orden no puede delatar quien va con quien: nunca queda exactamente en el orden de los terminos
    expect(out.defs).not.toEqual(['Estrella', 'Satelite', 'Planeta']);
  });

  it('un minijuego o una pregunta sin id no se tocan (se siguen calificando como antes)', () => {
    const game = { id: 'g1', type: 'linea_del_tiempo', game_data: { x: 1 } };
    expect(sanitizeQuestion(game)).toBe(game);
    const sinId = { type: 'multiple_choice', q: 'x', opts: ['a'], ok: 0 };
    expect(sanitizeQuestion(sinId)).toBe(sinId);
  });
});

describe('la pregunta sin claves la acepta la validacion de la leccion', () => {
  it.each([MC, TF, FILL, SHORT, MATCH])('$type', (q) => {
    // Regresion: la validacion exigia la respuesta correcta y la leccion mostraba "Falta la respuesta correcta".
    expect(isValidQuestion(sanitizeQuestion(q)).valid).toBe(true);
  });
});

describe('intentos por pregunta', () => {
  it('opcion multiple, V/F y respuesta corta: 1; completar: 2; emparejar: 3', () => {
    expect(MAX_TRIES).toEqual({ multiple_choice: 1, true_false: 1, short_answer: 1, fill_blank: 2, match: 3, linea_del_tiempo: 3, categorias_rapidas: 2 });
  });

  it('se cierra al acertar o al agotar los intentos', () => {
    expect(isFinalTry('fill_blank', 1, false)).toBe(false);
    expect(isFinalTry('fill_blank', 2, false)).toBe(true);
    expect(isFinalTry('fill_blank', 1, true)).toBe(true);
    expect(isFinalTry('match', 2, false)).toBe(false);
    expect(isFinalTry('match', 3, false)).toBe(true);
    expect(isFinalTry('multiple_choice', 1, false)).toBe(true);
  });

  it('solo los 5 tipos clasicos se califican en el servidor', () => {
    for (const t of ['multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'match']) expect(isServerGradedType(t)).toBe(true);
    for (const t of ['linea_del_tiempo', 'impostor_cognitivo', 'el_descifrador', undefined, 5]) expect(isServerGradedType(t)).toBe(false);
  });
});

describe('buildReveal', () => {
  it('revela solo lo de cada tipo', () => {
    expect(buildReveal(MC)).toEqual({ ok: 1 });
    expect(buildReveal(TF)).toEqual({ ok: true });
    expect(buildReveal(FILL)).toEqual({ answers: ['fotosintesis'] });
    expect(buildReveal(SHORT)).toEqual({ keywords: ['nucleo', 'membrana'] });
    expect(buildReveal(MATCH)).toEqual({ defs: ['Estrella', 'Satelite', 'Planeta'] });
  });
});

describe('gradeAnswer: emparejar con definiciones (servidor)', () => {
  it('acierto por termino', () => {
    const r = gradeAnswer(MATCH, { defs: ['Estrella', 'Planeta', 'Satelite'] });
    expect(r).toEqual({ status: 'graded', correct: false, detail: { perTerm: [true, false, false] } });
    expect(gradeAnswer(MATCH, { defs: ['Estrella', 'Satelite', 'Planeta'] })).toMatchObject({ correct: true });
  });

  it('sin conectar cuenta como incorrecto y la forma invalida se rechaza', () => {
    expect(gradeAnswer(MATCH, { defs: ['Estrella', null, 'Planeta'] })).toMatchObject({ correct: false, detail: { perTerm: [true, false, true] } });
    expect(gradeAnswer(MATCH, { defs: ['Estrella'] }).status).toBe('invalid');
    expect(gradeAnswer(MATCH, { defs: ['Estrella', 5, 'Planeta'] }).status).toBe('invalid');
  });
});

describe('gradeAnswer: detalle de completar y respuesta corta', () => {
  it('cuenta las palabras acertadas', () => {
    expect(gradeAnswer(SHORT, { text: 'tiene NÚCLEO' })).toEqual({ status: 'graded', correct: false, detail: { matched: 1, total: 2 } });
    expect(gradeAnswer(SHORT, { text: 'nucleo y membrana' })).toMatchObject({ correct: true, detail: { matched: 2, total: 2 } });
  });
});

describe('interruptor', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('hace falta pedirlo Y tener la llave de servicio', () => {
    vi.stubEnv('SERVER_GRADING', 'on');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ejemplo.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(serverGradingEnabled()).toBe(false);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'x'.repeat(40));
    expect(serverGradingEnabled()).toBe(true);
    vi.stubEnv('SERVER_GRADING', 'off');
    expect(serverGradingEnabled()).toBe(false);
    vi.stubEnv('SERVER_GRADING', '');
    expect(serverGradingEnabled()).toBe(false);
  });
});

describe('integracion', () => {
  it('la ruta de respuestas: sesion, intento propio y abierto, pregunta del intento, cierre y registro', () => {
    const src = read('src/app/api/lesson/answer/route.ts');
    expect(src).toContain('supabase.auth.getUser()');
    expect(src).toContain(".eq('student_id', user.id)");
    expect(src).toContain('question_ids');
    expect(src).toContain("attempt.status !== 'in_progress'");
    expect(src).toContain('prev?.final'); // repetir una pregunta cerrada no suma
    expect(src).toContain(".eq('tries', prev.tries)"); // control de concurrencia
    expect(src).toContain("from('question_attempts')");
    expect(src).toContain('serverGradingEnabled()');
  });

  it('las claves solo se revelan al cerrar la pregunta', () => {
    const src = read('src/app/api/lesson/answer/route.ts');
    // la respuesta de un intento fallido con otro por delante no incluye reveal ni explicacion
    const nonFinal = src.slice(src.indexOf('if (!final)'), src.indexOf('Cierre de la pregunta'));
    expect(nonFinal).not.toMatch(/reveal|explanation|buildReveal/);
  });

  it('servir la leccion pasa por startLessonAttempt en las dos salidas (cache y generacion nueva)', () => {
    const src = read('src/app/api/generate-questions/route.ts');
    expect(src.match(/startLessonAttempt\(/g)!.length).toBe(2);
    // el repaso (preguntas efimeras, sin id) sigue sin pasar por ahi
    const remediation = src.slice(src.indexOf('0. Modo repaso'), src.indexOf('// 1. Intentar servir del cache'));
    expect(remediation).not.toContain('startLessonAttempt');
  });

  it('las tablas de intentos no dan ningun permiso a anon ni authenticated', () => {
    const sql = read('supabase/migrations/066_lesson_attempts.sql');
    expect(sql).toContain('REVOKE ALL ON public.lesson_attempts FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('REVOKE ALL ON public.lesson_attempt_answers FROM PUBLIC, anon, authenticated');
    expect(sql).not.toMatch(/GRANT /);
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)!.length).toBe(2);
  });

  it('la leccion de calificacion en el servidor no calcula el veredicto en el navegador', () => {
    const page = read('src/app/(student)/lesson/[id]/page.tsx');
    expect(page).toContain("fetch('/api/lesson/answer'");
    expect(page).toContain('attemptIdRef.current = data.attemptId');
    // los dos caminos conviven: lo que no es serverGraded sigue como antes
    expect(page).toContain('q.serverGraded');
  });
});
