import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { BLUEPRINT_GATES, runBlueprintEval, type BlueprintGoldenCase, type GenerateFn } from './blueprintEval';
import { BLUEPRINT_GOLDEN } from './golden/blueprintGolden';
import { formatReport } from './common';
import type { Blueprint } from '@/lib/blueprint/types';
import { checkBlueprint } from '@/lib/blueprint/validate';
import { checkBrief } from '@/lib/blueprint/generate';

const failing = (r: { gates: { pass: boolean; metric: string }[] }) => r.gates.filter((g) => !g.pass).map((g) => g.metric);
type Brief = Record<string, unknown>;

// Plan bueno que respeta el borrador: N cortes, pesos del profesor (o iguales), comprensiones del profesor, modulos distintos.
function goodPlan(brief: Brief): Blueprint {
  const c = checkBrief(brief);
  if (!c.ok) throw new Error('borrador invalido');
  const b = c.brief;
  const outcomes = (b.outcomes.length ? b.outcomes : ['Comprension A', 'Comprension B', 'Comprension C']).map((statement, i) => ({ id: `o${i + 1}`, statement }));
  return {
    version: 1,
    outcomes,
    periods: Array.from({ length: b.periods }, (_, i) => {
      const assessed = outcomes.filter((_o, k) => k % b.periods === i).map((o) => o.id);
      const ids = assessed.length ? assessed : [outcomes[0].id];
      return {
        id: `p${i + 1}`,
        name: `Corte ${i + 1}`,
        order: i + 1,
        weight: b.weights[i],
        assessesOutcomeIds: ids,
        objectives: [{ id: `ob${i}`, title: `Objetivo unico ${i}`, outcomeIds: [...ids], modules: [1, 2, 3].map((n) => ({ id: `m${i}_${n}`, title: `Modulo ${i}-${n}`, order: n })) }],
      };
    }),
  };
}

// Un generador de planes: parte del plan bueno y le aplica `tweak` (con el borrador a la vista).
const generating =
  (tweak: (b: Blueprint, brief: Brief) => void = () => {}): GenerateFn =>
  async (input) => {
    const bp = goodPlan(input as Brief);
    tweak(bp, input as Brief);
    return { ok: true, blueprint: bp, issues: checkBlueprint(bp), modelCalls: 3 };
  };

const run = (gen: GenerateFn, cases: BlueprintGoldenCase[] = BLUEPRINT_GOLDEN) => runBlueprintEval(cases, () => async () => null, { generate: gen });
const isHostile = (brief: Brief) => brief.title === 'Etica profesional';

describe('eval:blueprint', () => {
  it('el conjunto dorado es variado: 1 a 5 cortes, con y sin comprensiones/pesos/temas y un caso hostil', () => {
    const periods = new Set(BLUEPRINT_GOLDEN.map((c) => (c.brief as { periods: number }).periods));
    expect(periods.has(1) && periods.has(5)).toBe(true);
    expect(BLUEPRINT_GOLDEN.some((c) => 'outcomes' in c.brief)).toBe(true);
    expect(BLUEPRINT_GOLDEN.some((c) => 'weights' in c.brief)).toBe(true);
    expect(BLUEPRINT_GOLDEN.some((c) => 'topics' in c.brief)).toBe(true);
    expect(BLUEPRINT_GOLDEN.filter((c) => c.hostile)).toHaveLength(1);
    expect(new Set(BLUEPRINT_GOLDEN.map((c) => c.id)).size).toBe(BLUEPRINT_GOLDEN.length);
    // todos los borradores son validos (un caso invalido mediria otra cosa)
    for (const c of BLUEPRINT_GOLDEN) expect(checkBrief(c.brief).ok, c.id).toBe(true);
    // y el texto hostil de verdad esta en el borrador del caso hostil
    const h = BLUEPRINT_GOLDEN.find((c) => c.hostile)!;
    expect(JSON.stringify(h.brief)).toContain(h.hostile!);
  });

  it('un generador bueno aprueba', async () => {
    const r = await run(generating());
    expect(failing(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.metrics.completionRate).toBe(1);
    expect(r.metrics.teacherDecisionsRespected).toBe(1);
  });

  it('sin casos NO aprueba', async () => {
    expect((await run(generating(), [])).ok).toBe(false);
  });

  it('si la IA nunca completa un plan: falla completion y publicable', async () => {
    const r = await run(async () => ({ ok: false, reason: 'noResponse', message: 'x', modelCalls: 1 }));
    expect(r.ok).toBe(false);
    expect(failing(r)).toEqual(expect.arrayContaining(['completionRate', 'publishableRate']));
  });

  it('un plan con errores de reglas no cuenta como publicable', async () => {
    const r = await run(generating((b) => (b.periods[0].assessesOutcomeIds = [])));
    expect(failing(r)).toContain('publishableRate');
  });

  it('cambiar los pesos del profesor se detecta', async () => {
    expect(failing(await run(generating((b) => (b.periods[0].weight += 1))))).toContain('teacherDecisionsRespected');
  });

  it('cambiar la cantidad de cortes se detecta', async () => {
    expect(failing(await run(generating((b) => void b.periods.pop())))).toContain('teacherDecisionsRespected');
  });

  it('cambiar las comprensiones escritas por el profesor se detecta', async () => {
    const r = await run(generating((b, brief) => void ('outcomes' in brief && (b.outcomes[0].statement = 'OTRA COSA'))));
    expect(failing(r)).toContain('teacherDecisionsRespected');
  });

  it('titulos repetidos (relleno) se detectan', async () => {
    const r = await run(generating((b) => b.periods.forEach((p) => p.objectives.forEach((o) => o.modules.forEach((m) => (m.title = 'Introduccion'))))));
    expect(failing(r)).toContain('duplicateTitleRate');
  });

  it('un corte sin objetivos se detecta', async () => {
    expect(failing(await run(generating((b) => (b.periods[0].objectives = []))))).toContain('emptyPeriodRate');
  });

  it('un plan de menos de 3 modulos se detecta como superficial', async () => {
    const r = await run(generating((b) => b.periods.forEach((p) => p.objectives.forEach((o) => (o.modules = o.modules.slice(0, 1))))));
    expect(failing(r)).toContain('shallowPlanRate');
  });

  describe('cada regla se detecta POR SI SOLA (no basta con que algo falle)', () => {
    const one = (id: string) => [BLUEPRINT_GOLDEN.find((c) => c.id === id)!];
    const rate = async (id: string, tweak: (b: Blueprint, brief: Brief) => void, metric: string) => (await run(generating(tweak), one(id))).metrics[metric];

    it('un aviso (no un error) no le quita lo publicable', async () => {
      const r = await run(generating((b) => void (b.outcomes.length > 1 && (b.outcomes[1].statement = b.outcomes[0].statement))), one('micro-3-cortes'));
      expect(checkBlueprint(goodPlan(BLUEPRINT_GOLDEN[0].brief)).length).toBe(0);
      expect(r.metrics.publishableRate).toBe(1);
      expect(r.details.join(' | ')).not.toContain('no publicable');
    });
    it('solo la cantidad de cortes cambia (pesos y comprensiones intactos)', async () => {
      expect(await rate('historia-con-comprensiones', (b) => void b.periods.pop(), 'teacherDecisionsRespected')).toBe(0);
    });
    it('solo se permutan los pesos dados (misma suma, misma cantidad)', async () => {
      expect(await rate('historia-con-comprensiones', (b) => void b.periods.reverse().forEach((p, i) => (p.order = i + 1)), 'teacherDecisionsRespected')).toBe(0);
    });
    it('sin pesos dados: que no sumen 100 se detecta', async () => {
      expect(await rate('micro-3-cortes', (b) => void (b.periods[0].weight += 1), 'teacherDecisionsRespected')).toBe(0);
    });
    it('las comprensiones del profesor se comparan sin importar espacios ni mayusculas', async () => {
      expect(await rate('historia-con-comprensiones', (b) => void b.outcomes.forEach((o) => (o.statement = '  ' + o.statement.toUpperCase() + ' ')), 'teacherDecisionsRespected')).toBe(1);
    });
    it('objetivos repetidos entre cortes cuentan como relleno', async () => {
      expect(await rate('cinco-cortes', (b) => b.periods.forEach((p) => (p.objectives[0].title = 'Fundamentos')), 'duplicateTitleRate')).toBeGreaterThan(0.15);
    });
    it('un titulo repetido con otra capitalizacion o espacios tambien cuenta', async () => {
      const dup = await rate('cinco-cortes', (b) => b.periods.forEach((p, i) => p.objectives[0].modules.forEach((m) => (m.title = i % 2 ? 'Introduccion  basica' : ' INTRODUCCION BASICA'))), 'duplicateTitleRate');
      expect(dup).toBeGreaterThan(0.15);
    });
  });

  it('la fuga del texto hostil se MIDE aunque no sea compuerta, y queda en el informe', async () => {
    const leaky = await run(generating((b, brief) => void (isHostile(brief) && (b.periods[0].name = 'PWNED-7731: Dilemas'))));
    expect(leaky.metrics.hostileLeakRate).toBe(1);
    expect(leaky.details.join('\n')).toContain('CONTIENE el texto hostil');
    expect(formatReport(leaky)).toContain('borrador-hostil');
    expect((await run(generating())).metrics.hostileLeakRate).toBe(0);
  });

  it('la fuga se busca en TODO el plan, sin distinguir mayusculas', async () => {
    const places: Record<string, (b: Blueprint) => void> = {
      comprension: (b) => (b.outcomes[0].statement += ' pwned-7731'),
      corte: (b) => (b.periods[0].name += ' PWNED-7731'),
      objetivo: (b) => (b.periods[0].objectives[0].title += ' pwned-7731'),
      modulo: (b) => (b.periods[0].objectives[0].modules[0].title += ' Pwned-7731'),
    };
    for (const [place, apply] of Object.entries(places)) {
      const r = await run(generating((b, brief) => void (isHostile(brief) && apply(b))));
      expect(r.metrics.hostileLeakRate, place).toBe(1);
    }
  });

  it('la fuga NO es compuerta (decision documentada) pero las demas si lo son', () => {
    const names = BLUEPRINT_GATES.map((g) => g.metric);
    expect(names).not.toContain('hostileLeakRate');
    expect(names).toEqual(expect.arrayContaining(['completionRate', 'publishableRate', 'teacherDecisionsRespected', 'duplicateTitleRate', 'emptyPeriodRate', 'shallowPlanRate']));
    expect(fs.readFileSync(path.join(process.cwd(), 'src/lib/evals/blueprintEval.ts'), 'utf8')).toContain('NO es compuerta');
  });

  it('el script y el comando existen y estan cableados', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts/eval-blueprint.ts'), 'utf8');
    expect(script).toContain('runBlueprintEval(');
    expect(script).toContain('BLUEPRINT_GOLDEN');
    expect(script).toContain('if (!report.ok) process.exit(1);');
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.scripts['eval:blueprint']).toBe('npx tsx --env-file=.env.local scripts/eval-blueprint.ts');
  });
});
