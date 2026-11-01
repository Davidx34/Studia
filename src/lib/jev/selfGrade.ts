// JEV-1: AUTO-CALIFICACION. Antes de guardar (o al auditar lo ya guardado) una pregunta o un minijuego, se simula la JUGADA PERFECTA con los calificadores REALES del servidor
// (gradeAnswer y gradeGame) y se exige que: (1) la jugada perfecta salga correcta, (2) cualquier otra opcion salga incorrecta y (3) la solucion no sea ambigua (dos opciones iguales,
// dos impostores, categorias repetidas...). Si el propio calificador del servidor no le da el 100 % a la respuesta oficial, el ejercicio esta mal formado o es contradictorio y el
// estudiante lo veria como una pregunta imposible o con dos respuestas correctas.
//
// Funcion PURA (sin base de datos ni red). Distingue FALLAS (el ejercicio no sirve) de AVISOS (sospechoso pero legitimo: p. ej. una respuesta de un solo caracter, que el calificador
// acepta si la palabra aparece en cualquier parte del texto del estudiante).

import { gradeAnswer } from '@/lib/grading/gradeAnswer';
import { gradeGame, isGradedGameType, letterKey, probeGame, sanitizeGameData } from '@/lib/grading/gameGrading';
import { SERVER_GRADED_TYPES } from '@/lib/grading/serverGrading';
import { normalizeAnswer } from '@/lib/lesson/normalize';

export interface PlayableRow {
  type: string;
  q?: unknown;
  opts?: unknown;
  ok?: unknown;
  answers?: unknown;
  pairs?: unknown;
  keywords?: unknown;
  game_data?: unknown;
}

export type SelfGradeStatus = 'pass' | 'fail' | 'skip';

export interface SelfGradeResult {
  status: SelfGradeStatus;
  kind: 'classic' | 'game' | 'unsupported';
  failures: string[];
  warnings: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

class Collector {
  failures: string[] = [];
  warnings: string[] = [];
  fail(msg: string) {
    this.failures.push(msg);
  }
  warn(msg: string) {
    this.warnings.push(msg);
  }
  result(kind: SelfGradeResult['kind']): SelfGradeResult {
    return { status: this.failures.length > 0 ? 'fail' : 'pass', kind, failures: this.failures, warnings: this.warnings };
  }
}

// La respuesta oficial debe puntuar como correcta, y nada mas debe hacerlo.
function expectCorrect(c: Collector, got: { status: string; correct?: boolean }, label: string) {
  if (got.status !== 'graded') c.fail(`${label}: el calificador no la acepta (${got.status}).`);
  else if (got.correct !== true) c.fail(`${label}: el calificador la da por INCORRECTA.`);
}
function expectWrong(c: Collector, got: { status: string; correct?: boolean }, label: string) {
  if (got.status === 'graded' && got.correct === true) c.fail(`${label}: tambien se califica como correcta (la solucion es ambigua).`);
}

const optionText = (o: unknown): string => (typeof o === 'string' ? o.replace(/^\s*[A-Ha-h][.)]\s*/, '').trim() : '');

// ───────────────────────────── preguntas clasicas ─────────────────────────────

function classic(row: PlayableRow): SelfGradeResult {
  const c = new Collector();
  if (!nonEmpty(row.q)) c.fail('No tiene enunciado.');

  switch (row.type) {
    case 'multiple_choice': {
      const opts = Array.isArray(row.opts) ? row.opts : [];
      if (opts.length < 2) c.fail('Tiene menos de 2 opciones.');
      if (opts.length > 8) c.fail('Tiene mas de 8 opciones.');
      if (opts.some((o) => !nonEmpty(optionText(o)))) c.fail('Hay una opcion vacia o que no es texto.');
      const ok = row.ok;
      if (typeof ok !== 'number' || !Number.isInteger(ok) || ok < 0 || ok >= opts.length) {
        c.fail('La respuesta correcta no apunta a ninguna opcion.');
        break;
      }
      const seen = new Set<string>();
      for (const o of opts) {
        const k = normalizeAnswer(optionText(o));
        if (k && seen.has(k)) c.fail(`Dos opciones dicen lo mismo («${optionText(o).slice(0, 40)}»): la correcta es ambigua.`);
        seen.add(k);
      }
      expectCorrect(c, gradeAnswer(row, { selectedIndex: ok }), 'La opcion marcada como correcta');
      opts.forEach((_, i) => {
        if (i !== ok) expectWrong(c, gradeAnswer(row, { selectedIndex: i }), `La opcion ${i + 1}`);
      });
      break;
    }
    case 'true_false': {
      if (typeof row.ok !== 'boolean') {
        c.fail('No dice si es verdadera o falsa.');
        break;
      }
      expectCorrect(c, gradeAnswer(row, { selected: row.ok }), 'La respuesta oficial');
      expectWrong(c, gradeAnswer(row, { selected: !row.ok }), 'La respuesta contraria');
      break;
    }
    case 'fill_blank':
    case 'short_answer': {
      const expected = strs(row.type === 'fill_blank' ? row.answers : row.keywords);
      const field = row.type === 'fill_blank' ? 'respuestas esperadas' : 'palabras clave';
      if (expected.length === 0) {
        c.fail(`No tiene ${field}.`);
        break;
      }
      if (expected.some((e) => normalizeAnswer(e) === '')) {
        c.fail(`Una de las ${field} esta vacia: cualquier texto la cumpliria.`);
        break;
      }
      expectCorrect(c, gradeAnswer(row, { text: expected.join(' ') }), 'Escribir todas las respuestas esperadas');
      expectWrong(c, gradeAnswer(row, { text: '' }), 'No escribir nada');
      if (expected.some((e) => normalizeAnswer(e).length <= 1)) c.warn(`Una de las ${field} tiene un solo caracter: el calificador la acepta si aparece en cualquier parte del texto.`);
      break;
    }
    case 'match': {
      const pairs = list(row.pairs);
      if (pairs.length < 2) {
        c.fail('Tiene menos de 2 pares.');
        break;
      }
      if (pairs.some((p) => !nonEmpty(p.def) || (p.term !== undefined && !nonEmpty(p.term)))) {
        c.fail('Un par tiene el termino o la definicion vacios.');
        break;
      }
      const defs = pairs.map((p) => normalizeAnswer(String(p.def)));
      // Dos definiciones iguales no son un defecto (dos alimentos con el mismo origen: intercambiarlos es correcto), pero el estudiante no puede fallar entre esos dos terminos.
      if (new Set(defs).size !== defs.length) c.warn('Dos definiciones son iguales: esos terminos se pueden intercambiar y ambas combinaciones cuentan como correctas.');
      expectCorrect(c, gradeAnswer(row, { defs: pairs.map((p) => p.def) }), 'Conectar cada termino con su definicion');
      expectCorrect(c, gradeAnswer(row, { pairing: pairs.map((_, i) => i) }), 'Conectar en orden (modo sombra)');
      break;
    }
  }
  return c.result('classic');
}

// ───────────────────────────── minijuegos ─────────────────────────────

// Elegir UNA opcion: exactamente una correcta, y todas las demas incorrectas.
function singleChoice(c: Collector, type: string, gd: Obj, o: { items: Obj[]; idKey: string; flag: string; answer: (v: unknown) => Obj; idType: 'number' | 'string'; label: string }) {
  const { items, idKey, flag } = o;
  if (items.length < 2) c.fail(`Tiene menos de 2 ${o.label}.`);
  const ids = items.map((it) => it[idKey]);
  if (ids.some((i) => typeof i !== o.idType) || new Set(ids).size !== ids.length) c.fail(`Los identificadores de ${o.label} faltan o se repiten.`);
  const right = items.filter((it) => it[flag] === true);
  if (right.length === 0) c.fail('Ninguna opcion esta marcada como la solucion.');
  if (right.length > 1) c.fail(`Hay ${right.length} soluciones marcadas: debe haber exactamente una.`);
  if (right.length !== 1) return;
  expectCorrect(c, gradeGame(type, gd, o.answer(right[0][idKey])), 'La solucion marcada');
  for (const it of items) if (it !== right[0]) expectWrong(c, gradeGame(type, gd, o.answer(it[idKey])), `La opcion «${String(it[idKey])}»`);
}

function game(type: string, rawGd: unknown): SelfGradeResult {
  const c = new Collector();
  const gd = isObj(rawGd) ? rawGd : null;
  if (!gd) {
    c.fail('No tiene datos de juego (game_data).');
    return c.result('game');
  }

  switch (type) {
    case 'impostor_cognitivo':
      if (list(gd.statements).length > 0 && !nonEmpty(gd.context)) c.warn('No tiene contexto.');
      singleChoice(c, type, gd, { items: list(gd.statements), idKey: 'id', flag: 'is_impostor', answer: (v) => ({ selectedId: v }), idType: 'number', label: 'afirmaciones' });
      break;
    case 'alquimia_conceptual':
      singleChoice(c, type, gd, { items: list(gd.bridge_options), idKey: 'id', flag: 'is_correct', answer: (v) => ({ selectedId: v }), idType: 'string', label: 'puentes' });
      break;
    case 'cuarto_crisis': {
      singleChoice(c, type, gd, { items: list(gd.interventions), idKey: 'action_code', flag: 'is_solution', answer: (v) => ({ selectedCode: v }), idType: 'string', label: 'intervenciones' });
      // Se acabo el tiempo = no contuvo la crisis.
      expectWrong(c, gradeGame(type, gd, { selectedCode: null }), 'Dejar acabar el tiempo');
      break;
    }
    case 'juicio_conocimiento': {
      const paragraphs = list(gd.expert_testimony);
      const ids = paragraphs.map((p) => p.paragraph_id);
      const guilty = gd.guilty_paragraph_id;
      if (paragraphs.length < 2) c.fail('Tiene menos de 2 parrafos.');
      if (ids.some((i) => typeof i !== 'number') || new Set(ids).size !== ids.length) c.fail('Los identificadores de los parrafos faltan o se repiten.');
      if (typeof guilty !== 'number' || !ids.includes(guilty)) {
        c.fail('El parrafo culpable no es ninguno de los parrafos.');
        break;
      }
      expectCorrect(c, gradeGame(type, gd, { selectedParagraphId: guilty }), 'El parrafo culpable');
      for (const id of ids) if (id !== guilty) expectWrong(c, gradeGame(type, gd, { selectedParagraphId: id }), `El parrafo ${String(id)}`);
      break;
    }
    case 'linea_del_tiempo': {
      const items = list(gd.items);
      if (items.length < 2) c.fail('Tiene menos de 2 eventos.');
      const ids = items.map((it) => it.id);
      if (ids.some((i) => typeof i !== 'number') || new Set(ids).size !== ids.length) c.fail('Los identificadores de los eventos faltan o se repiten.');
      const pos = items.map((it) => it.correct_position);
      const permutation = items.length > 0 && pos.every((p) => typeof p === 'number') && new Set(pos).size === items.length && pos.every((p) => (p as number) >= 1 && (p as number) <= items.length);
      if (!permutation) {
        c.fail('Las posiciones correctas no son un orden valido (repetidas o con huecos).');
        break;
      }
      if (c.failures.length > 0) break;
      const perfect = items.slice().sort((a, b) => (a.correct_position as number) - (b.correct_position as number)).map((it) => it.id);
      expectCorrect(c, gradeGame(type, gd, { order: perfect }), 'El orden correcto');
      const reversed = perfect.slice().reverse();
      expectWrong(c, gradeGame(type, gd, { order: reversed }), 'El orden inverso');
      break;
    }
    case 'categorias_rapidas': {
      const items = list(gd.items);
      const categories = strs(gd.categories);
      if (items.length === 0) c.fail('No tiene elementos.');
      if (categories.length < 2) c.fail('Tiene menos de 2 categorias.');
      if (new Set(categories.map(normalizeAnswer)).size !== categories.length) c.fail('Hay categorias repetidas.');
      const ids = items.map((it) => it.id);
      if (ids.some((i) => i === undefined || i === null) || new Set(ids).size !== ids.length) c.fail('Los identificadores de los elementos faltan o se repiten.');
      if (items.some((it) => typeof it.correct_category !== 'string' || !categories.includes(it.correct_category))) c.fail('Un elemento tiene una categoria correcta que no esta entre las categorias.');
      if (c.failures.length > 0) break;
      const perfect = Object.fromEntries(items.map((it) => [String(it.id), it.correct_category]));
      expectCorrect(c, gradeGame(type, gd, { assignment: perfect }), 'La clasificacion correcta');
      expectWrong(c, gradeGame(type, gd, { timeout: true }), 'Dejar acabar el tiempo');
      if (new Set(items.map((it) => it.correct_category)).size < 2) c.warn('Todos los elementos son de la misma categoria.');
      break;
    }
    case 'flashcard_rapida': {
      const sanitized = sanitizeGameData(type, gd);
      const cards = Array.isArray(sanitized.cards) ? (sanitized.cards as { key: number; text: string }[]) : null;
      // El sanitizador devuelve un arreglo VACIO (no undefined) cuando los pares no son validos.
      if (!cards || cards.length === 0) {
        c.fail('Las cartas no son validas (hacen falta al menos 2 pares con ids distintos y texto).');
        break;
      }
      // La jugada perfecta: para cada carta, la que "coincide" segun el sondeo del servidor.
      const used = new Set<number>();
      const matches: [number, number][] = [];
      const coincide = (x: number, y: number): boolean => {
        const p = probeGame(type, gd, { a: x, b: y });
        return p.status === 'graded' && p.correct === true;
      };
      for (const a of cards) {
        if (used.has(a.key)) continue;
        // El servidor garantiza ids de par distintos, asi que cada carta tiene EXACTAMENTE una pareja; si el sondeo no la encuentra, el calificador y los datos no se entienden.
        const partner = cards.find((b) => b.key !== a.key && !used.has(b.key) && coincide(a.key, b.key));
        if (!partner) {
          c.fail(`La carta «${a.text.slice(0, 30)}» no tiene pareja segun el calificador.`);
          break;
        }
        used.add(a.key);
        used.add(partner.key);
        matches.push([a.key, partner.key]);
      }
      if (c.failures.length > 0) break;
      expectCorrect(c, gradeGame(type, gd, { matches }), 'Encontrar todas las parejas');
      break;
    }
    case 'el_descifrador': {
      const word = typeof gd.word_to_guess === 'string' ? gd.word_to_guess : '';
      const letters = Array.from(new Set(word.split('').filter((ch) => /[a-zA-ZÑñ]/.test(ch)).map(letterKey)));
      if (letters.length === 0) {
        c.fail('La palabra no tiene ninguna letra que adivinar.');
        break;
      }
      expectCorrect(c, gradeGame(type, gd, { letters }), 'Adivinar todas las letras');
      if (letters.length < 3) c.warn('La palabra tiene menos de 3 letras distintas: es casi imposible fallar.');
      if (!Array.isArray(gd.hints) || strs(gd.hints).length === 0) c.warn('No tiene pistas.');
      break;
    }
  }
  return c.result('game');
}

// ───────────────────────────── entrada ─────────────────────────────

export function selfGrade(row: PlayableRow): SelfGradeResult {
  if (!row || typeof row !== 'object' || typeof row.type !== 'string') return { status: 'fail', kind: 'unsupported', failures: ['La fila no tiene tipo.'], warnings: [] };
  if ((SERVER_GRADED_TYPES as readonly string[]).includes(row.type)) return classic(row);
  if (isGradedGameType(row.type)) return game(row.type, row.game_data);
  return { status: 'skip', kind: 'unsupported', failures: [], warnings: [] };
}
