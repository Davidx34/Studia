import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { groupChunks, sectionOf } from './grouping';
import { extractJsonObject, groundedRatio, validateGroupCards } from './validate';
import { nextState, isDue, BOX_INTERVAL_DAYS } from './leitner';
import { generateStudyCards, buildStudyPrompt } from './generate';
import { isThemedStudentRoute } from '@/lib/design/themedRoutes';

const chunk = (i: number, body: string, section = 'Unidad 1 > Utilidad') => ({ chunk_index: i, content: `[Sección: ${section}]\n\n${body}` });
const para = (n: number) => 'La utilidad marginal decrece cuando consumimos mas unidades del mismo bien. '.repeat(n);

describe('groupChunks', () => {
  it('une chunks consecutivos hasta el tope y conserva el titulo de seccion', () => {
    const g = groupChunks([chunk(0, para(20)), chunk(1, para(20)), chunk(2, para(20))]);
    expect(g.length).toBeGreaterThanOrEqual(1);
    expect(g[0].section).toBe('Unidad 1 > Utilidad');
    expect(g[0].text).not.toContain('[Sección');
    expect(g.flatMap((x) => x.chunkIndexes).sort()).toEqual([0, 1, 2]);
  });

  it('con material enorme respeta el tope de bloques (acota costo y tiempo)', () => {
    const many = Array.from({ length: 200 }, (_, i) => chunk(i, para(25)));
    expect(groupChunks(many).length).toBeLessThanOrEqual(12);
  });

  it('descarta bloques diminutos salvo que sea lo unico que hay', () => {
    expect(groupChunks([chunk(0, 'hola')]).length).toBe(1);
    const g = groupChunks([chunk(0, para(30)), chunk(1, 'x', 'Otra')]);
    expect(g.every((x) => x.text.length >= 200)).toBe(true);
  });

  it('ordena por chunk_index y sectionOf lee el prefijo', () => {
    expect(groupChunks([chunk(2, para(5)), chunk(0, para(5))])[0].chunkIndexes[0]).toBe(0);
    expect(sectionOf('[Sección: A > B]\n\ntexto')).toBe('A > B');
    expect(sectionOf('sin prefijo')).toBeNull();
  });
});

describe('validateGroupCards', () => {
  const source = 'La utilidad marginal es el aumento de satisfaccion al consumir una unidad adicional. La utilidad marginal decrece cuando se consumen mas unidades.';
  const ficha = { titulo: 'Utilidad marginal', idea_principal: 'La utilidad marginal es la satisfaccion adicional de consumir una unidad mas.', puntos_clave: ['La utilidad marginal decrece al consumir mas unidades.', 'Mide la satisfaccion adicional.'], terminos: [{ termino: 'Utilidad marginal', definicion: 'Satisfaccion de la unidad adicional consumida.' }], pregunta_reflexion: 'Por que decrece?' };

  it('acepta una ficha y flashcards apoyadas en el material', () => {
    const r = validateGroupCards({ ficha, flashcards: [{ pregunta: 'Que es la utilidad marginal?', respuesta: 'El aumento de satisfaccion por una unidad adicional.' }] }, source);
    expect(r.ficha?.front).toBe('Utilidad marginal');
    expect(r.flashcards).toHaveLength(1);
  });

  it('rechaza respuestas que NO salen del material (conocimiento inventado por el modelo)', () => {
    const r = validateGroupCards({ flashcards: [{ pregunta: 'Quien escribio La riqueza de las naciones?', respuesta: 'Adam Smith en Escocia durante 1776.' }] }, source);
    expect(r.flashcards).toHaveLength(0);
  });

  it('descarta duplicados, preguntas cortas y respuesta igual a la pregunta', () => {
    const q = 'Que es la utilidad marginal?';
    const a = 'El aumento de satisfaccion por una unidad adicional.';
    const r = validateGroupCards({ flashcards: [{ pregunta: q, respuesta: a }, { pregunta: 'QUE es la utilidad marginal', respuesta: a }, { pregunta: 'corta', respuesta: a }, { pregunta: q + ' otra', respuesta: q + ' otra' }] }, source);
    expect(r.flashcards).toHaveLength(1);
  });

  it('una ficha incompleta o inventada no pasa', () => {
    expect(validateGroupCards({ ficha: { ...ficha, puntos_clave: ['uno solo largo'] } }, source).ficha).toBeNull();
    expect(validateGroupCards({ ficha: { ...ficha, idea_principal: 'Los dinosaurios dominaron el Mesozoico durante millones de anios.', puntos_clave: ['Los reptiles gigantes se extinguieron hace sesenta millones.', 'Los meteoritos cambiaron el clima terrestre.'] } }, source).ficha).toBeNull();
  });

  it('tolera basura', () => {
    for (const bad of [null, undefined, 'x', 3, [], {}]) expect(validateGroupCards(bad as any, source)).toEqual({ ficha: null, flashcards: [] });
  });
});

describe('extractJsonObject / groundedRatio', () => {
  it('lee JSON en bloque de codigo y rescata barras de LaTeX sin doblar', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    const bs = String.fromCharCode(92);
    expect(extractJsonObject(`{"a":"$${bs}frac{1}{2}$"}`)?.a).toBe(`$${bs}frac{1}{2}$`);
    expect(extractJsonObject('sin json')).toBeNull();
  });

  it('groundedRatio ignora tildes, plurales y palabras cortas', () => {
    expect(groundedRatio('satisfacción', 'satisfaccion')).toBe(1);
    expect(groundedRatio('unidades', 'unidad')).toBe(1);
    expect(groundedRatio('de la en', 'nada')).toBe(1);
    expect(groundedRatio('elefantes', 'utilidad')).toBe(0);
  });
});

describe('Leitner', () => {
  const now = new Date('2026-03-10T15:30:00');
  it('una tarjeta nueva acertada sube a la caja 2 y vuelve manana a las 4', () => {
    const n = nextState(null, 'good', now);
    expect(n.box).toBe(2);
    expect(n.reviews).toBe(1);
    const due = new Date(n.due_at);
    expect(due.getDate()).toBe(11);
    expect(due.getHours()).toBe(4);
  });

  it('fallar regresa a la caja 1, cuenta la recaida y vuelve en 10 minutos', () => {
    const n = nextState({ box: 4, reviews: 5, lapses: 1 }, 'again', now);
    expect(n.box).toBe(1);
    expect(n.lapses).toBe(2);
    expect(new Date(n.due_at).getTime() - now.getTime()).toBe(10 * 60 * 1000);
  });

  it('dudar conserva la caja y la caja 5 es el techo', () => {
    expect(nextState({ box: 3, reviews: 2, lapses: 0 }, 'hard', now).box).toBe(3);
    expect(nextState({ box: 5, reviews: 9, lapses: 0 }, 'good', now).box).toBe(5);
    expect(BOX_INTERVAL_DAYS[5]).toBeGreaterThan(BOX_INTERVAL_DAYS[4]);
  });

  it('isDue: nunca repasada o vencida', () => {
    expect(isDue(null)).toBe(true);
    expect(isDue({ due_at: '2020-01-01T00:00:00Z' })).toBe(true);
    expect(isDue({ due_at: '2999-01-01T00:00:00Z' })).toBe(false);
  });
});

describe('generateStudyCards', () => {
  const group = { section: 'S', text: 'La utilidad marginal decrece cuando consumimos mas unidades del mismo bien. '.repeat(10), chunkIndexes: [0] };
  const good = JSON.stringify({
    ficha: { titulo: 'Utilidad marginal', idea_principal: 'La utilidad marginal decrece cuando consumimos mas unidades del bien.', puntos_clave: ['La utilidad marginal decrece al consumir mas unidades.', 'Aplica al mismo bien consumido.'], terminos: [], pregunta_reflexion: '' },
    flashcards: [{ pregunta: 'Que pasa con la utilidad marginal al consumir mas?', respuesta: 'La utilidad marginal decrece al consumir mas unidades del bien.' }],
  });

  it('reintenta un bloque cuya primera respuesta no sirve y reporta los que fallan del todo', async () => {
    const call = vi.fn().mockResolvedValueOnce('no es json').mockResolvedValueOnce(good).mockResolvedValue(null);
    const r = await generateStudyCards([group, { ...group, section: 'T' }], 'Mat', call, 1);
    expect(r.groupsOk).toBe(1);
    expect(r.groupsFailed).toBe(1);
    expect(r.fichas[0].section).toBe('S');
    expect(r.flashcards).toHaveLength(1);
  });

  it('el prompt obliga a usar solo el fragmento y lleva su seccion', () => {
    const p = buildStudyPrompt(group, 'Mat');
    expect(p).toContain('SOLO informacion que este en el fragmento');
    expect(p).toContain('Seccion: "S"');
  });
});

describe('integracion de la funcion', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
  const sql = read('supabase/migrations/055_study_cards.sql').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it('las tarjetas y la generacion solo las escribe el servidor; el avance es del estudiante', () => {
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.study_cards FROM anon, authenticated/);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.study_card_generation FROM anon, authenticated/);
    expect(sql).not.toMatch(/FOR ALL/);
    for (const t of ['study_cards', 'study_card_generation', 'student_card_state']) expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
    expect(sql).toMatch(/INSERT WITH CHECK \(\s*student_id = auth\.uid\(\)\s*AND EXISTS \(SELECT 1 FROM public\.study_cards/);
  });

  it('la ruta valida usuario, acceso por RLS al material, y reclama la generacion de forma atomica', () => {
    const route = read('src/app/api/study/generate/route.ts');
    expect(route).toContain('auth.getUser()');
    expect(route).toContain("processing_status !== 'completed'");
    expect(route).toContain(".eq('started_at', current.started_at)"); // compare-and-set
    expect(route).toContain('RETRY_COOLDOWN_MS');
  });

  it('la pagina de estudio y el resto de mis clases aceptan el tema claro', () => {
    expect(isThemedStudentRoute('/my-classes/abc/study')).toBe(true);
    expect(isThemedStudentRoute('/my-classes/abc/library')).toBe(true);
    expect(isThemedStudentRoute('/my-classes/abc')).toBe(true);
    expect(isThemedStudentRoute('/my-classesx/abc')).toBe(false);
  });

  it('StudyClient no usa colores fijos', () => {
    const src = read('src/app/(student)/my-classes/[id]/study/StudyClient.tsx');
    expect(src).not.toMatch(/\btext-white\b|\b(bg|text|border)-(slate|gray|violet|blue|green|red)-\d/);
  });
});
