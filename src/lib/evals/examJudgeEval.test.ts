import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { EXAM_JUDGE_GATES, runExamJudgeEval, type ExamJudgeCase, type JudgeFn } from './examJudgeEval';
import { EXAM_JUDGE_GOLDEN } from './golden/examJudgeGolden';
import { formatReport } from './common';
import type { JudgeVerdict } from '@/lib/blueprint/examJudge';
import { hasJudgeProvider } from '@/lib/blueprint/examJudgeModel';

const failing = (r: { gates: { pass: boolean; metric: string }[] }) => r.gates.filter((g) => !g.pass).map((g) => g.metric);

// Un juez que contesta lo que se le pida segun el caso (por id) o lo esperado.
const judging =
  (decide: (c: ExamJudgeCase) => JudgeVerdict): JudgeFn =>
  async (question) => {
    const c = EXAM_JUDGE_GOLDEN.find((x) => x.question === question)!;
    const verdict = decide(c);
    return { verdict, problems: verdict === 'supported' ? [] : ['motivo de prueba'], modelCalls: 1 };
  };
const run = (judge: JudgeFn, cases: ExamJudgeCase[] = EXAM_JUDGE_GOLDEN) => runExamJudgeEval(cases, () => async () => null, { judge });
const perfect = judging((c) => c.expected);

describe('eval:exam-judge: el conjunto dorado', () => {
  it('tiene casos BIEN respaldados, MAL respaldados (plantados, con su defecto) y una ambigua, y ids unicos', () => {
    const by = (v: string) => EXAM_JUDGE_GOLDEN.filter((c) => c.expected === v);
    expect(by('supported').length).toBeGreaterThanOrEqual(10);
    expect(by('unsupported').length).toBeGreaterThanOrEqual(10);
    expect(by('unclear')).toHaveLength(1);
    expect(new Set(EXAM_JUDGE_GOLDEN.map((c) => c.id)).size).toBe(EXAM_JUDGE_GOLDEN.length);
    for (const c of EXAM_JUDGE_GOLDEN) {
      if (c.expected === 'unsupported') expect(c.id.startsWith('mal-')).toBe(true);
      if (c.expected === 'supported') expect(c.id.startsWith('bien-')).toBe(true);
    }
  });
  it('incluye los defectos que motivaron al juez: mecanismo que el material no dice, conocimiento externo VERDADERO, generalizacion, dato de mas, fecha/numero cambiados', () => {
    const ids = EXAM_JUDGE_GOLDEN.map((c) => c.id).join(' ');
    for (const k of ['krebs', 'conocimiento-externo', 'generalizacion', 'dato-extra', 'fecha', 'numero', 'efecto-invertido', 'negacion', 'cifra-no-dicha']) expect(ids).toContain(k);
  });
  it('cada caso tiene material y una pregunta completa (explicacion, clave y tipo calificable)', () => {
    for (const c of EXAM_JUDGE_GOLDEN) {
      expect(c.chunks.length).toBeGreaterThan(0);
      expect(c.question.exp.length).toBeGreaterThan(40);
      expect(['multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'match']).toContain(c.question.type);
    }
  });
  it('en los casos BIEN respaldados la afirmacion de la explicacion SI esta en el material (el caso dorado no esta mal etiquetado)', () => {
    // Comprobacion mecanica minima: las palabras de contenido de la respuesta clave aparecen en el material.
    const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 6);
    for (const c of EXAM_JUDGE_GOLDEN.filter((x) => x.expected === 'supported')) {
      const material = new Set(c.chunks.flatMap((k) => words(k.text)));
      const exp = words(c.question.exp);
      const inMat = exp.filter((w) => material.has(w)).length / Math.max(exp.length, 1);
      expect(inMat, c.id).toBeGreaterThan(0.4);
    }
  });
});

describe('eval:exam-judge: las compuertas', () => {
  it('un juez perfecto aprueba', async () => {
    const r = await run(perfect);
    expect(failing(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.metrics.badApprovedRate).toBe(0);
    expect(r.metrics.goodApprovedRate).toBe(1);
  });
  it('sin casos NO aprueba', async () => {
    expect((await run(perfect, [])).ok).toBe(false);
  });
  it('un juez que APRUEBA todo falla badApprovedRate (el riesgo que motivo al juez)', async () => {
    const r = await run(judging(() => 'supported'));
    expect(failing(r)).toContain('badApprovedRate');
    expect(r.metrics.badApprovedRate).toBe(1);
  });
  it('una pregunta AMBIGUA aprobada cuenta como un fallo grave igual que una mal respaldada', async () => {
    const r = await run(judging((c) => (c.expected === 'unclear' ? 'supported' : c.expected)));
    expect(r.metrics.badApprovedRate).toBeGreaterThan(0);
    expect(r.metrics.ambiguousFlaggedRate).toBe(0);
  });
  it('un juez que RECHAZA todo falla goodRejectedRate', async () => {
    const r = await run(judging(() => 'unsupported'));
    expect(failing(r)).toContain('goodRejectedRate');
    expect(r.metrics.badApprovedRate).toBe(0);
  });
  it('un juez que siempre dice "no se" falla unclearRate (y no aprueba nada malo)', async () => {
    const r = await run(judging(() => 'unclear'));
    expect(failing(r)).toContain('unclearRate');
    expect(r.metrics.badApprovedRate).toBe(0);
    expect(r.metrics.goodRejectedRate).toBe(0);
  });
  it('una ambigua marcada como unsupported o unclear se considera detectada', async () => {
    for (const v of ['unsupported', 'unclear'] as const) {
      const r = await run(judging((c) => (c.expected === 'unclear' ? v : c.expected)));
      expect(r.metrics.ambiguousFlaggedRate).toBe(1);
      expect(r.metrics.badApprovedRate).toBe(0);
    }
  });
  it('los umbrales son los documentados', () => {
    expect(Object.fromEntries(EXAM_JUDGE_GATES.map((g) => [g.metric, [g.op, g.threshold]]))).toEqual({ badApprovedRate: ['<=', 0.2], goodRejectedRate: ['<=', 0.25], unclearRate: ['<=', 0.3] });
  });
  it('el informe marca cada caso: acierto, duda y error', async () => {
    const r = await run(judging((c) => (c.id === 'mal-fecha-cambiada' ? 'supported' : c.id === 'mal-generalizacion' ? 'unclear' : c.expected)));
    const text = formatReport(r);
    expect(text).toMatch(/MAL mal-fecha-cambiada/);
    expect(text).toMatch(/\?\s+mal-generalizacion/);
    expect(text).toMatch(/ok\s+bien-elasticidad-mc/);
  });
  it('el script y el comando existen y estan cableados', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts/eval-exam-judge.ts'), 'utf8');
    expect(script).toContain('runExamJudgeEval(');
    expect(script).toContain('callJudgeModel');
    expect(script).toContain('if (!report.ok) process.exit(1);');
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.scripts['eval:exam-judge']).toBe('npx tsx --env-file=.env.local scripts/eval-exam-judge.ts');
  });
});

describe('hasJudgeProvider: sin otro proveedor que Cohere NO hay juez', () => {
  it('solo con la llave de Cohere: no hay juez', () => {
    expect(hasJudgeProvider({ COHERE_API_KEY: 'k' })).toBe(false);
    expect(hasJudgeProvider({})).toBe(false);
  });
  it('con la llave de otro proveedor de la cadena judge: si hay juez', () => {
    expect(hasJudgeProvider({ COHERE_API_KEY: 'k', GEMINI_API_KEY: 'k' })).toBe(true);
  });
});

describe('el modelo del juez nunca es Cohere', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/blueprint/examJudgeModel.ts'), 'utf8');
  it('usa la tarea judge del gateway, excluye a Cohere y devuelve null si no hay otro proveedor', () => {
    expect(src).toContain("task: 'judge'");
    expect(src).toContain("exclude: ['cohere']");
    // determinista: un juez con temperatura alta daria veredictos distintos para la misma pregunta
    expect(src).toContain('temperature: 0,');
    expect(src).toContain("c.provider !== 'cohere'");
    expect(src).toContain('if (!hasJudgeProvider()) return null;');
  });
});
