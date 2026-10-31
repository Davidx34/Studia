import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { EvalFailure, assertPasses, evaluateGates, formatReport, ratio, type EvalReport } from './common';
import { MEMORY_GATES, parseMemoryCases, runMemoryEval, type ExtractFn, type MemoryGenerator, type MemoryGoldenCase } from './memoryEval';
import { MEMORY_GOLDEN } from './golden/memoryGolden';
import { JUDGE_GATES, runJudgeEval, type Criterion, type JudgeFn, type JudgeGoldenCase } from './judgeEval';
import { JUDGE_GOLDEN } from './golden/judgeGolden';
import { LAB_DESIGN_GATES, runLabDesignEval, type DesignFn, type LabGenerator, type LabGoldenCase } from './labDesignEval';
import { LAB_GOLDEN } from './golden/labDesignGolden';
import { MODEL_EXAMPLES } from '@/lib/lab/modelExamples';
import { extractMaterial } from '@/lib/memory/extract';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const failing = (r: EvalReport) => r.gates.filter((g) => !g.pass).map((g) => g.metric);

// ─────────────────────────────── marco comun ───────────────────────────────
describe('common: las compuertas fallan de verdad', () => {
  const gates = [{ metric: 'a', op: '>=' as const, threshold: 0.5, why: 'x' }, { metric: 'b', op: '<=' as const, threshold: 0.1, why: 'y' }];
  it('aprueba solo si TODAS las compuertas se cumplen', () => {
    expect(evaluateGates('t', 3, { a: 0.9, b: 0 }, gates).ok).toBe(true);
    expect(evaluateGates('t', 3, { a: 0.4, b: 0 }, gates).ok).toBe(false);
    expect(evaluateGates('t', 3, { a: 0.9, b: 0.2 }, gates).ok).toBe(false);
  });
  it('los umbrales son inclusivos', () => {
    expect(evaluateGates('t', 1, { a: 0.5, b: 0.1 }, gates).ok).toBe(true);
  });
  it('SIN CASOS no aprueba, aunque las metricas sean perfectas', () => {
    expect(evaluateGates('t', 0, { a: 1, b: 0 }, gates).ok).toBe(false);
  });
  it('una metrica ausente, NaN o infinita no aprueba', () => {
    expect(evaluateGates('t', 2, { b: 0 }, gates).ok).toBe(false);
    expect(evaluateGates('t', 2, { a: Number.NaN, b: 0 }, gates).ok).toBe(false);
    expect(evaluateGates('t', 2, { a: Infinity, b: 0 }, gates).ok).toBe(false);
  });
  it('assertPasses lanza EvalFailure con el motivo; si aprobo, devuelve el informe', () => {
    const bad = evaluateGates('mi-eval', 2, { a: 0.1, b: 0 }, gates);
    expect(() => assertPasses(bad)).toThrow(EvalFailure);
    expect(() => assertPasses(bad)).toThrow(/mi-eval: NO APROBADO[\s\S]*a = 0.1/);
    const ok = evaluateGates('mi-eval', 2, { a: 1, b: 0 }, gates);
    expect(assertPasses(ok)).toBe(ok);
    expect(() => assertPasses(evaluateGates('vacio', 0, { a: 1, b: 0 }, gates))).toThrow(/ningun caso/);
  });
  it('ratio y formato', () => {
    expect(ratio(1, 4)).toBe(0.25);
    expect(ratio(1, 0)).toBe(0);
    expect(ratio(1, 0, 1)).toBe(1);
    expect(formatReport(evaluateGates('t', 2, { a: 1, b: 0 }, gates))).toMatch(/APROBADO/);
  });
});

// ─────────────────────────────── eval:memory ───────────────────────────────
const conceptsJson = (c: MemoryGoldenCase, names: string[]) =>
  names.map((nombre) => ({ nombre, tipo: 'concepto', definicion: `${nombre}.`, formula: '', unidad: '', importancia: 3 }));

// Un buen modelo: lee los conceptos del caso... pero es INGENUO con las relaciones: pone "causa" a TODOS los pares, incluso a los que el texto no presenta como causa.
// Es la tuberia (anclaje al texto + exigencia de una expresion causal) la que debe corregirlo.
const referenceModel: MemoryGenerator = (c) => async () =>
  JSON.stringify({
    conceptos: conceptsJson(c, [...c.expectedConcepts, ...(c.acceptableConcepts ?? [])]),
    relaciones: [...c.causalEdges, ...c.notCausal, ...(c.knownGapNotCausal ?? [])].map(([de, a]) => ({ de, a, tipo: 'causa' })),
  });

describe('eval:memory', () => {
  it('conjunto dorado: sintetico, sin material de ninguna clase real, con las dos materias y trampas causales', () => {
    expect(MEMORY_GOLDEN.every((c) => c.origin === 'sintetico')).toBe(true);
    expect(new Set(MEMORY_GOLDEN.map((c) => c.profile))).toEqual(new Set(['narrativo', 'cuantitativo']));
    expect(MEMORY_GOLDEN.reduce((n, c) => n + c.notCausal.length, 0)).toBeGreaterThanOrEqual(6);
    expect(MEMORY_GOLDEN.reduce((n, c) => n + c.causalEdges.length, 0)).toBeGreaterThanOrEqual(3);
  });

  it('el modelo de referencia APRUEBA, y la tuberia vuelve "relacionado" los pares sin expresion causal', async () => {
    const r = await runMemoryEval(MEMORY_GOLDEN, referenceModel);
    // Ninguna trampa que la tuberia PUEDE descartar queda como causa (la unica excepcion es el limite conocido, que va aparte).
    expect(r.details.filter((d) => /par sin causa/.test(d) && !/limite conocido/.test(d))).toEqual([]);
    expect(assertPasses(r).ok).toBe(true);
    expect(r.metrics.profileAccuracy).toBe(1);
    expect(r.metrics.trapCausaRate).toBe(0);
    expect(r.metrics.causalRecall).toBe(1);
  });

  it('LIMITE CONOCIDO medido, no ocultado: una causa en la frase vecina deja pasar un par que no es causal', async () => {
    const r = await runMemoryEval(MEMORY_GOLDEN, referenceModel);
    expect(r.metrics.knownGapTrapCausaRate).toBeGreaterThan(0);
    expect(r.details.join('\n')).toMatch(/\[limite conocido\].*guerras púnicas/);
  });

  const defects: [string, MemoryGenerator, string[]][] = [
    ['un modelo que no devuelve nada util', () => async () => '{"conceptos":[],"relaciones":[]}', ['nodePrecision', 'nodeRecall']],
    ['un modelo que no responde (null)', () => async () => null, ['nodeRecall']],
    ['un modelo que alucina conceptos que NO estan en el texto', () => async () => JSON.stringify({ conceptos: ['Pirámides de Giza', 'Cleopatra', 'Imperio otomano'].map((nombre) => ({ nombre, tipo: 'concepto', definicion: 'x', importancia: 3 })), relaciones: [] }), ['nodeRecall']],
    ['un modelo que solo lee la mitad de los conceptos', (c) => async () => JSON.stringify({ conceptos: conceptsJson(c, c.expectedConcepts.slice(0, Math.floor(c.expectedConcepts.length / 2))), relaciones: [] }), ['nodeRecall']],
    ['un modelo que invierte el sentido de las causas', (c) => async () => JSON.stringify({ conceptos: conceptsJson(c, c.expectedConcepts), relaciones: c.causalEdges.map(([a, b]) => ({ de: b, a, tipo: 'causa' })) }), ['causaFalsePositiveRate', 'causalRecall']],
  ];
  for (const [name, gen, expectFail] of defects) {
    it(`FALLA con ${name}`, async () => {
      const r = await runMemoryEval(MEMORY_GOLDEN, gen);
      expect(r.ok).toBe(false);
      for (const m of expectFail) expect(failing(r)).toContain(m);
      expect(() => assertPasses(r)).toThrow(EvalFailure);
    });
  }

  it('FALLA con una tuberia defectuosa que marca TODO como causa (sin exigir expresion causal)', async () => {
    const allCausa: ExtractFn = async (...args) => {
      const res = await extractMaterial(...args);
      return { ...res, extraction: { ...res.extraction, edges: res.extraction.edges.map((e) => ({ ...e, relation: 'causa' as const })) } };
    };
    const r = await runMemoryEval(MEMORY_GOLDEN, referenceModel, { extract: allCausa });
    expect(r.ok).toBe(false);
    expect(failing(r)).toContain('trapCausaRate');
  });

  it('una trampa se detecta en CUALQUIER sentido: si el modelo marca como causa el par al reves de como esta declarado, igual cuenta', async () => {
    const lluvia: MemoryGoldenCase = {
      id: 'lluvia', origin: 'sintetico', profile: 'narrativo',
      text: 'Debido a la lluvia, la cosecha creció mucho ese año. Los campesinos celebraron la cosecha en la plaza del pueblo.',
      expectedConcepts: ['lluvia', 'cosecha'], causalEdges: [], notCausal: [['cosecha', 'lluvia']],
    };
    const model: MemoryGenerator = (c) => async () =>
      JSON.stringify({ conceptos: conceptsJson(c, ['lluvia', 'cosecha']), relaciones: [{ de: 'lluvia', a: 'cosecha', tipo: 'causa' }] });
    const r = await runMemoryEval([lluvia], model);
    expect(r.metrics.trapCausaRate).toBe(1);
    expect(failing(r)).toContain('trapCausaRate');
  });

  it('FALLA si el perfil detectado no es el esperado', async () => {
    const wrong = MEMORY_GOLDEN.map((c) => ({ ...c, profile: c.profile === 'narrativo' ? ('cuantitativo' as const) : ('narrativo' as const) }));
    const r = await runMemoryEval(wrong, referenceModel);
    expect(failing(r)).toContain('profileAccuracy');
  });

  it('FALLA sin casos', async () => {
    const r = await runMemoryEval([], referenceModel);
    expect(r.ok).toBe(false);
    expect(() => assertPasses(r)).toThrow(/ningun caso/);
  });

  describe('casos reales desde un archivo local (parseMemoryCases)', () => {
    const ok = () => ({
      id: 'real-1', profile: 'narrativo', text: 'Un texto real de una clase, con bastantes palabras para superar el minimo de cincuenta caracteres.',
      expectedConcepts: ['uno', 'dos'], acceptableConcepts: ['tres'], causalEdges: [['a', 'b']], notCausal: [['c', 'd']],
    });
    it('acepta un caso valido, lo marca como real y completa lo opcional', () => {
      const [c] = parseMemoryCases([ok()]);
      expect(c.origin).toBe('real');
      expect(c.expectedConcepts).toEqual(['uno', 'dos']);
      expect(c.causalEdges).toEqual([['a', 'b']]);
      const { acceptableConcepts, notCausal, ...min } = ok();
      expect(parseMemoryCases([min])[0]).toMatchObject({ acceptableConcepts: [], notCausal: [], knownGapNotCausal: [] });
    });
    it('rechaza con el motivo exacto lo mal formado', () => {
      const bad = (over: Record<string, unknown>) => () => parseMemoryCases([{ ...ok(), ...over }]);
      expect(() => parseMemoryCases([])).toThrow(/lista con al menos un caso/);
      expect(() => parseMemoryCases('x')).toThrow(/lista/);
      expect(() => parseMemoryCases([5])).toThrow(/debe ser un objeto/);
      expect(bad({ id: '' })).toThrow(/falta "id"/);
      expect(bad({ profile: 'otro' })).toThrow(/"profile"/);
      expect(bad({ text: 'corto' })).toThrow(/al menos 50 caracteres/);
      expect(bad({ expectedConcepts: [] })).toThrow(/expectedConcepts/);
      expect(bad({ expectedConcepts: ['ok', ''] })).toThrow(/expectedConcepts/);
      expect(bad({ acceptableConcepts: 'x' })).toThrow(/acceptableConcepts/);
      expect(bad({ causalEdges: [['solo uno']] })).toThrow(/pares/);
      expect(bad({ notCausal: [['a', 5]] })).toThrow(/pares/);
      expect(() => parseMemoryCases([ok(), ok()])).toThrow(/repetido/);
    });
  });

  it('las compuertas existen y son las que se documentan', () => {
    expect(MEMORY_GATES.map((g) => g.metric)).toEqual(['nodePrecision', 'nodeRecall', 'profileAccuracy', 'causaFalsePositiveRate', 'trapCausaRate', 'causalRecall']);
  });
});

// ─────────────────────────────── eval:judge ───────────────────────────────
// Un juez PERFECTO: da el veredicto esperado por el conjunto dorado para el criterio activo.
const perfectJudge = (criterion: Criterion): JudgeFn => async (qs) => {
  const out = new Map<string, { verdict: 'pass' | 'fail' | 'review'; reason: string } | null>();
  for (const q of qs) {
    const c = JUDGE_GOLDEN.find((x) => x.question.id === q.id)!;
    out.set(q.id, { verdict: c.expect[criterion] === 'approve' ? 'pass' : 'fail', reason: 'perfecto' });
  }
  return out;
};
const constant = (verdict: 'pass' | 'fail' | 'review' | null): JudgeFn => async (qs) => new Map(qs.map((q) => [q.id, verdict ? { verdict, reason: 'const' } : null]));
const byKind = (fn: (c: JudgeGoldenCase) => 'pass' | 'fail'): JudgeFn => async (qs) =>
  new Map(qs.map((q) => [q.id, { verdict: fn(JUDGE_GOLDEN.find((x) => x.question.id === q.id)!), reason: 'k' }]));

describe('eval:judge', () => {
  it('conjunto dorado: las cuatro familias, con alucinaciones sutiles y ids unicos', () => {
    expect(new Set(JUDGE_GOLDEN.map((c) => c.kind))).toEqual(new Set(['fiel', 'sutil_falsa', 'contradice_material', 'ausente_verdadera']));
    expect(new Set(JUDGE_GOLDEN.map((c) => c.id)).size).toBe(JUDGE_GOLDEN.length);
    expect(JUDGE_GOLDEN.every((c) => c.id === c.question.id)).toBe(true);
  });

  it('SOLO las verdaderas-pero-ausentes cambian de resultado esperado segun el criterio', () => {
    for (const c of JUDGE_GOLDEN) {
      if (c.kind === 'ausente_verdadera') expect(c.expect).toEqual({ subject: 'approve', material: 'reject' });
      else expect(c.expect.subject).toBe(c.expect.material);
    }
  });

  for (const crit of ['subject', 'material'] as const) {
    it(`un juez perfecto APRUEBA con el criterio ${crit}`, async () => {
      const r = await runJudgeEval(JUDGE_GOLDEN, perfectJudge(crit), crit);
      expect(assertPasses(r).ok).toBe(true);
      expect(r.metrics.falseApprovalRate).toBe(0);
      expect(r.metrics.answeredRate).toBe(1);
    });
    it(`FALLA con un juez que aprueba todo (${crit})`, async () => {
      const r = await runJudgeEval(JUDGE_GOLDEN, constant('pass'), crit);
      expect(failing(r)).toContain('falseApprovalRate');
      expect(failing(r)).toContain('subtleFalseApprovalRate');
      expect(() => assertPasses(r)).toThrow(EvalFailure);
    });
    it(`FALLA con un juez que rechaza todo (${crit})`, async () => {
      const r = await runJudgeEval(JUDGE_GOLDEN, constant('fail'), crit);
      expect(failing(r)).toContain('falseRejectRate');
    });
    it(`FALLA con un juez que no responde (${crit})`, async () => {
      const r = await runJudgeEval(JUDGE_GOLDEN, constant(null), crit);
      expect(failing(r)).toContain('answeredRate');
    });
  }

  it('FALLA con un juez que se deja engañar por las alucinaciones SUTILES (aprueba lo casi-cierto) aunque acierte lo demas', async () => {
    const r = await runJudgeEval(JUDGE_GOLDEN, byKind((c) => (c.kind === 'sutil_falsa' ? 'pass' : c.expect.material === 'approve' ? 'pass' : 'fail')), 'material');
    expect(failing(r)).toContain('subtleFalseApprovalRate');
    expect(r.details.join('\n')).toMatch(/FALSO APROBADO \(sutil_falsa\)/);
  });

  it('con el criterio MATERIAL, un juez que aprueba lo verdadero-pero-ausente es un falso aprobado; con SUBJECT no', async () => {
    const lenient = byKind((c) => (c.expect.material === 'approve' || c.kind === 'ausente_verdadera' ? 'pass' : 'fail'));
    const material = await runJudgeEval(JUDGE_GOLDEN, lenient, 'material');
    const subject = await runJudgeEval(JUDGE_GOLDEN, lenient, 'subject');
    expect(material.ok).toBe(false);
    expect(failing(material)).toContain('subtleFalseApprovalRate');
    expect(subject.ok).toBe(true);
  });

  it('con el criterio SUBJECT, un juez que aplica el criterio estricto del material rechaza demasiado contenido bueno', async () => {
    const r = await runJudgeEval(JUDGE_GOLDEN, perfectJudge('material'), 'subject');
    expect(failing(r)).toEqual(['falseRejectRate']);
  });

  it('el tope GENERAL de falsos aprobados frena por si solo: dos contradicciones del material aprobadas, con las sutiles bien', async () => {
    const perfect = perfectJudge('material');
    const flawed: JudgeFn = async (qs, material) => {
      const out = await perfect(qs, material);
      for (const q of qs) {
        const c = JUDGE_GOLDEN.find((x) => x.question.id === q.id)!;
        if (c.kind === 'contradice_material') out.set(q.id, { verdict: 'pass', reason: 'se dejo llevar por lo habitual' });
      }
      return out;
    };
    const r = await runJudgeEval(JUDGE_GOLDEN, flawed, 'material');
    expect(r.metrics.subtleFalseApprovalRate).toBe(0);
    expect(r.metrics.falseApprovalRate).toBeGreaterThan(0.1);
    expect(failing(r)).toEqual(['falseApprovalRate']);
  });

  it('un veredicto "review" nunca cuenta como aprobacion', async () => {
    const r = await runJudgeEval(JUDGE_GOLDEN, constant('review'), 'material');
    expect(r.metrics.falseApprovalRate).toBe(0);
    expect(r.metrics.falseRejectRate).toBe(0);
  });

  it('FALLA sin casos', async () => {
    expect((await runJudgeEval([], perfectJudge('subject'), 'subject')).ok).toBe(false);
  });

  it('las compuertas existen', () => {
    expect(JUDGE_GATES.map((g) => g.metric)).toEqual(['falseApprovalRate', 'subtleFalseApprovalRate', 'falseRejectRate', 'answeredRate']);
  });
});

// ─────────────────────────────── eval:lab-design ───────────────────────────────
const example = (id: string) => MODEL_EXAMPLES.find((x) => x.id === id)!;
const designJson = (modelId: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: example(modelId).title,
    objective: '¿Qué valor de la variable independiente produce el resultado más alto?',
    context: '',
    hypothesisPrompt: 'Antes de empezar: ¿qué crees que va a pasar y por qué?',
    independent: modelId === 'gases' ? 'V' : 'x',
    mode: 'controlado',
    minTrials: 5,
    questions: ['¿Con qué valor obtuviste el mejor resultado? Apóyate en tu tabla.', '¿Qué pasó con la otra variable al aumentar la primera?'],
    model: example(modelId).raw,
    ...over,
  });
const reqJson = (reqs: { termino: string; esencial?: boolean; formula?: boolean }[]) => JSON.stringify({ requisitos: reqs });

// Un buen modelo: pide los requisitos que el pedido necesita y disena con el ejemplo correspondiente.
const REQS: Record<string, string> = {
  'consumidor-suficiente': reqJson([{ termino: 'restricción presupuestal', formula: true }, { termino: 'función de utilidad Cobb-Douglas', formula: true }, { termino: 'equilibrio del consumidor', esencial: false }]),
  'gases-suficiente': reqJson([{ termino: 'ley de los gases ideales', formula: true }, { termino: 'presión' }, { termino: 'volumen' }]),
  'curva-parcial': reqJson([{ termino: 'restricción presupuestal', formula: true }, { termino: 'curva de indiferencia' }]),
  'juegos-insuficiente': reqJson([{ termino: 'teoría de juegos' }, { termino: 'equilibrio de Nash' }]),
  'fotosintesis-insuficiente': reqJson([{ termino: 'fotosíntesis' }, { termino: 'intensidad de la luz' }]),
  'poema-nofit': JSON.stringify({ requisitos: null, motivo: 'Un poema no es un experimento numérico que se pueda simular.' }),
};
const DESIGN_OF: Record<string, string> = {
  'consumidor-suficiente': designJson('consumidor'),
  'gases-suficiente': designJson('gases'),
  'curva-parcial': designJson('consumidor'),
};
const labOracle: LabGenerator = (c) => async (prompt) => (prompt.includes('{"requisitos": null') ? REQS[c.id] : DESIGN_OF[c.id] ?? null);

describe('eval:lab-design', () => {
  it('conjunto dorado: cubre suficiente, parcial, insuficiente y "no es un experimento"', () => {
    expect(new Set(LAB_GOLDEN.map((c) => c.expected))).toEqual(new Set(['sufficient', 'partial', 'insufficient', 'noFit']));
    expect(new Set(LAB_GOLDEN.map((c) => c.id)).size).toBe(LAB_GOLDEN.length);
  });

  it('el modelo de referencia APRUEBA: clasifica bien, no inventa y disena con formulas coherentes', async () => {
    const r = await runLabDesignEval(LAB_GOLDEN, labOracle);
    expect(r.details.join('\n')).toBe('');
    expect(assertPasses(r).ok).toBe(true);
    expect(r.metrics).toMatchObject({ sufficiencyAccuracy: 1, designForInsufficientRate: 0, invalidAcceptedRate: 0, contradictoryFormulaRate: 0, designRate: 1 });
    // El ejemplo del consumidor topa Y en 0 (`max(..., 0)`): el verificador lo marca divergente al 88 %, pero no es una contradiccion.
    expect(r.metrics.divergentFormulaRate).toBeGreaterThan(0);
  });

  it('FALLA con un modelo que SUBESTIMA los requisitos: con materiales insuficientes igual entrega un laboratorio', async () => {
    const understating: LabGenerator = (c) => async (prompt) =>
      prompt.includes('{"requisitos": null') ? reqJson([{ termino: 'restricción presupuestal' }, { termino: 'precios', esencial: false }]) : designJson('consumidor');
    const r = await runLabDesignEval(LAB_GOLDEN, understating);
    expect(failing(r)).toContain('designForInsufficientRate');
    expect(r.details.join('\n')).toMatch(/DISEÑO INVENTADO/);
  });

  it('FALLA con un modelo cuyo diseño es basura (numeros que no se pueden calcular)', async () => {
    const garbage: LabGenerator = (c) => async (prompt) => (prompt.includes('{"requisitos": null') ? REQS[c.id] : '{"title":"x","model":{"variables":[]}}');
    const r = await runLabDesignEval(LAB_GOLDEN, garbage);
    expect(r.ok).toBe(false);
    // La suficiencia se clasifica bien (la decide la memoria, no el diseño); lo que falla es lograr un laboratorio válido.
    expect(failing(r)).toEqual(['designRate']);
  });

  it('FALLA con un modelo que nunca responde', async () => {
    const r = await runLabDesignEval(LAB_GOLDEN, () => async () => null);
    expect(r.ok).toBe(false);
  });

  it('FALLA con un modelo que dice "no es un experimento" para todo (no clasifica la suficiencia)', async () => {
    const r = await runLabDesignEval(LAB_GOLDEN, () => async () => REQS['poema-nofit']);
    expect(failing(r)).toContain('sufficiencyAccuracy');
  });

  it('FALLA con una tuberia defectuosa que acepta una ficha que NO pasa la validacion', async () => {
    const reference = await import('@/lib/lab/design');
    const sloppy: DesignFn = async (input, call) => {
      const real = await reference.designLab(input, call);
      if (!real.ok) return real;
      return { ...real, spec: { ...real.spec, model: { ...real.spec.model!, outputs: [] } } };
    };
    const r = await runLabDesignEval(LAB_GOLDEN, labOracle, { design: sloppy });
    expect(failing(r)).toContain('invalidAcceptedRate');
  });

  it('FALLA con un diseño cuya formula CONTRADICE la de los apuntes', async () => {
    const wrongFormula = (id: string) => {
      const raw = JSON.parse(JSON.stringify(example(id).raw)) as { outputs: { id: string; expr: string }[] };
      raw.outputs = raw.outputs.map((o) => (o.id === 'P' ? { ...o, expr: 'n*R*T*V' } : o)); // P = nRT·V en vez de nRT/V
      return JSON.stringify({ ...JSON.parse(designJson(id)), model: raw });
    };
    const gen: LabGenerator = (c) => async (prompt) => (prompt.includes('{"requisitos": null') ? REQS[c.id] : c.id === 'gases-suficiente' ? wrongFormula('gases') : DESIGN_OF[c.id] ?? null);
    const r = await runLabDesignEval(LAB_GOLDEN, gen);
    expect(r.metrics.contradictoryFormulaRate).toBeGreaterThan(0);
    expect(failing(r)).toContain('contradictoryFormulaRate');
    expect(r.details.join('\n')).toMatch(/CONTRADICEN los apuntes: Presión/);
  });

  it('FALLA sin casos', async () => {
    const empty: LabGoldenCase[] = [];
    expect((await runLabDesignEval(empty, labOracle)).ok).toBe(false);
  });

  it('las compuertas existen', () => {
    expect(LAB_DESIGN_GATES.map((g) => g.metric)).toEqual(['sufficiencyAccuracy', 'designForInsufficientRate', 'invalidAcceptedRate', 'contradictoryFormulaRate', 'designRate']);
  });
});

// ─────────────────────────────── cableado ───────────────────────────────
describe('cableado de los scripts', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  it('package.json tiene los tres evaluadores y el barrido', () => {
    for (const s of ['eval:memory', 'eval:judge', 'eval:lab-design', 'eval:rag-sweep']) expect(pkg.scripts[s]).toBeTruthy();
  });
  it('los scripts terminan con codigo distinto de cero cuando una compuerta falla', () => {
    for (const f of ['scripts/eval-memory.ts', 'scripts/eval-lab-design.ts']) {
      const src = read(f);
      expect(src).toMatch(/process\.exit\(1\)|process\.exitCode\s*=\s*1/);
      expect(src).toMatch(/\.ok/);
    }
    expect(read('scripts/eval-judge.ts')).toMatch(/--dorado/);
  });
  it('los casos reales NO se versionan: se leen de un archivo local', () => {
    expect(read('scripts/eval-memory.ts')).toMatch(/--archivo/);
    expect(read('.gitignore')).toMatch(/evals\/golden\/local/);
  });
});
