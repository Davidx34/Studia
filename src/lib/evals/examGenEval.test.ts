import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ENOUGH, EXAM_GEN_GATES, runExamGenEval, type ExamGenCase, type GenerateFn } from './examGenEval';
import { EXAM_GEN_GOLDEN } from './golden/examGenGolden';
import { formatReport } from './common';
import { quoteIsInChunk } from '@/lib/blueprint/examQuestion';
import type { ExamQuestion } from '@/lib/blueprint/examQuestion';

const failing = (r: { gates: { pass: boolean; metric: string }[] }) => r.gates.filter((g) => !g.pass).map((g) => g.metric);
const q = (n: number, type = 'multiple_choice', over: Partial<ExamQuestion> = {}): ExamQuestion => ({
  outcomeId: 'o1', nodeId: 'm1', type: type as ExamQuestion['type'], q: `Pregunta ${n}`, exp: 'Explicacion de fondo suficientemente larga para pasar.', source: { materialId: 'x', chunkIndex: 0, quote: 'cita' }, ...over,
});
const isScarce = (c: ExamGenCase) => c.chunks.length === 1 && c.chunks[0].text.length < 120;

// Un generador que produce `n` preguntas por caso con los tipos dados (y `rej` rechazadas).
const producing =
  (n: number | ((c: ExamGenCase) => number), types: string[] = ['multiple_choice', 'true_false', 'fill_blank'], rej = 0, tweak?: (qs: ExamQuestion[], c: ExamGenCase) => void): GenerateFn =>
  async (input) => {
    const c = EXAM_GEN_GOLDEN.find((x) => x.chunks === input.chunks)!;
    const count = typeof n === 'function' ? n(c) : n;
    const accepted = Array.from({ length: count }, (_, i) => q(i, types[i % types.length]));
    tweak?.(accepted, c);
    return { ok: true, accepted, rejected: Array.from({ length: rej }, () => ({ errors: ['La cita NO aparece en el material citado (x)'] })), excludedChunks: [], judged: false, rejectedByJudge: 0, needsReview: [], modelCalls: 1, judgeCalls: 0 };
  };
const run = (gen: GenerateFn, cases: ExamGenCase[] = EXAM_GEN_GOLDEN) => runExamGenEval(cases, () => async () => null, { generate: gen });
const good = () => producing((c) => (isScarce(c) ? 2 : 5), ['multiple_choice', 'true_false', 'fill_blank']);

describe('eval:exam-gen', () => {
  it('el conjunto dorado es variado: materias distintas, un caso de material escaso y uno hostil, con material REAL en cada caso', () => {
    expect(EXAM_GEN_GOLDEN.length).toBeGreaterThanOrEqual(5);
    expect(EXAM_GEN_GOLDEN.filter(isScarce)).toHaveLength(1);
    expect(EXAM_GEN_GOLDEN.filter((c) => c.hostile)).toHaveLength(1);
    expect(new Set(EXAM_GEN_GOLDEN.map((c) => c.id)).size).toBe(EXAM_GEN_GOLDEN.length);
    for (const c of EXAM_GEN_GOLDEN) {
      expect(c.chunks.length).toBeGreaterThan(0);
      expect(c.chunks.every((k) => /^[0-9a-f-]{36}$/i.test(k.materialId) && k.text.trim().length > 0)).toBe(true);
      expect(c.plan).toMatchObject({ outcomes: [{ id: 'o1' }] });
    }
    // el caso hostil tiene de verdad la orden escondida en el material
    const h = EXAM_GEN_GOLDEN.find((c) => c.hostile)!;
    expect(h.chunks.some((k) => k.text.includes(h.hostile!))).toBe(true);
    // y cada caso normal tiene material para al menos 3 citas distintas (si no, no podria sacar 3 preguntas)
    for (const c of EXAM_GEN_GOLDEN.filter((x) => !isScarce(x))) expect(c.chunks.length).toBeGreaterThanOrEqual(3);
  });
  it('un generador bueno aprueba', async () => {
    const r = await run(good());
    expect(failing(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it('sin casos NO aprueba', async () => {
    expect((await run(good(), [])).ok).toBe(false);
  });
  it('si casi todo se rechaza, falla acceptRate', async () => {
    const r = await run(producing((c) => (isScarce(c) ? 2 : 5), undefined, 100));
    expect(failing(r)).toContain('acceptRate');
  });
  it('si no alcanza para un examen con material suficiente, falla enoughRate', async () => {
    const r = await run(producing((c) => (isScarce(c) ? 1 : ENOUGH - 1)));
    expect(failing(r)).toContain('enoughRate');
  });
  it('un caso normal que NO se genera cuenta contra la suficiencia (no se ignora)', async () => {
    const names = EXAM_GEN_GOLDEN.filter((c) => !isScarce(c)).map((c) => c.id);
    const failTwo: GenerateFn = async (input) => {
      const c = EXAM_GEN_GOLDEN.find((x) => x.chunks === input.chunks)!;
      if (c.id === names[0] || c.id === names[1]) return { ok: false, reason: 'noResponse', message: 'x', modelCalls: 1 };
      return good()(input, undefined as never);
    };
    const r = await run(failTwo);
    expect(r.metrics.enoughRate).toBe(0.5);
    expect(failing(r)).toContain('enoughRate');
  });
  it('un caso normal sin ninguna pregunta aceptada no baja el promedio de variedad (ya lo castiga enoughRate)', async () => {
    const empty = EXAM_GEN_GOLDEN.find((c) => !isScarce(c) && !c.hostile)!.id;
    const gen: GenerateFn = async (input) => {
      const c = EXAM_GEN_GOLDEN.find((x) => x.chunks === input.chunks)!;
      const n = c.id === empty ? 0 : isScarce(c) ? 2 : 5;
      return { ok: true, accepted: Array.from({ length: n }, (_, i) => q(i, ['multiple_choice', 'true_false'][i % 2])), rejected: [], excludedChunks: [], judged: false, rejectedByJudge: 0, needsReview: [], modelCalls: 1, judgeCalls: 0 };
    };
    const r = await run(gen);
    expect(r.metrics.typeVariety).toBe(2);
    expect(failing(r)).not.toContain('typeVariety');
  });
  it('si la IA nunca genera, falla enoughRate (los casos normales cuentan)', async () => {
    const r = await run(async () => ({ ok: false, reason: 'noResponse', message: 'x', modelCalls: 1 }));
    expect(failing(r)).toContain('enoughRate');
    expect(r.details.join('\n')).toContain('NO se genero');
  });
  it('un examen de un solo tipo de pregunta falla typeVariety', async () => {
    const r = await run(producing((c) => (isScarce(c) ? 2 : 5), ['multiple_choice']));
    expect(failing(r)).toContain('typeVariety');
  });
  it('con material de una frase, sacar un examen entero (3 o mas) falla scarceOverreachRate', async () => {
    const r = await run(producing(5));
    expect(failing(r)).toContain('scarceOverreachRate');
    const ok = await run(producing((c) => (isScarce(c) ? ENOUGH - 1 : 5)));
    expect(failing(ok)).not.toContain('scarceOverreachRate');
  });
  it('la fuga del texto hostil se MIDE (en pregunta, explicacion, opciones o respuestas) aunque no sea compuerta', async () => {
    const places: Record<string, (x: ExamQuestion) => void> = {
      pregunta: (x) => (x.q += ' pwned-5521'),
      explicacion: (x) => (x.exp += ' PWNED-5521'),
      opciones: (x) => (x.opts = ['A. PWNED-5521', 'B. otra']),
      respuestas: (x) => (x.answers = ['pwned-5521']),
    };
    for (const [place, apply] of Object.entries(places)) {
      const r = await run(producing((c) => (isScarce(c) ? 2 : 5), undefined, 0, (qs, c) => void (c.hostile && qs.forEach(apply))));
      expect(r.metrics.hostileLeakRate, place).toBe(1);
      expect(r.details.join('\n')).toContain('CONTIENEN el texto hostil');
    }
    expect((await run(good())).metrics.hostileLeakRate).toBe(0);
  });
  it('los trozos excluidos por traer ordenes para la IA se informan y se cuentan', async () => {
    const gen: GenerateFn = async (input) => {
      const c = EXAM_GEN_GOLDEN.find((x) => x.chunks === input.chunks)!;
      const n = isScarce(c) ? 2 : 5;
      return { ok: true, accepted: Array.from({ length: n }, (_, i) => q(i, ['multiple_choice', 'true_false'][i % 2])), rejected: [], excludedChunks: c.hostile ? [{ materialId: 'x', chunkIndex: 1 }] : [], judged: false, rejectedByJudge: 0, needsReview: [], modelCalls: 1, judgeCalls: 0 };
    };
    const r = await run(gen);
    expect(r.metrics.excludedChunks).toBe(1);
    expect(r.details.join(' | ')).toContain('EXCLUIDO(S) por traer ordenes para la IA');
    expect((await run(good())).metrics.excludedChunks).toBe(0);
  });
  it('los motivos de rechazo se resumen en el informe (para saber QUE falla)', async () => {
    const r = await run(producing((c) => (isScarce(c) ? 2 : 5), undefined, 3));
    expect(formatReport(r)).toContain('rechazo (');
    expect(formatReport(r)).toContain('La cita NO aparece');
  });
  it('la fuga NO es compuerta (decision documentada) pero las demas si', () => {
    const names = EXAM_GEN_GATES.map((g) => g.metric);
    expect(names).not.toContain('hostileLeakRate');
    expect(names).toEqual(['acceptRate', 'enoughRate', 'typeVariety', 'scarceOverreachRate']);
    expect(fs.readFileSync(path.join(process.cwd(), 'src/lib/evals/examGenEval.ts'), 'utf8')).toContain('no es compuerta');
  });
  it('el script y el comando existen y estan cableados', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts/eval-exam-gen.ts'), 'utf8');
    expect(script).toContain('runExamGenEval(');
    expect(script).toContain('EXAM_GEN_GOLDEN');
    expect(script).toContain('if (!report.ok) process.exit(1);');
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.scripts['eval:exam-gen']).toBe('npx tsx --env-file=.env.local scripts/eval-exam-gen.ts');
  });
  it('el material de ejemplo permite citas literales (las citas de la corrida real salen de el)', () => {
    const c = EXAM_GEN_GOLDEN[0];
    expect(quoteIsInChunk('mide cuánto cambia la cantidad demandada de un bien cuando cambia su precio', c.chunks[0].text)).toBe(true);
  });
});
