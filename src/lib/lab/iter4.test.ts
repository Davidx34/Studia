// Iteracion 4 (parte A): entregas de laboratorio. Validador del servidor (submission.ts), rutas, migracion 082 y paridad con el laboratorio del navegador.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SUBMISSION_LIMITS, computeOutputs, parseReview, validateSubmission, REVIEW_LIMITS } from './submission';
import { MODEL_EXAMPLES, exampleSpec } from './modelExamples';
import { defaultSpec, resolveLab } from './labSpec';
import { getLabTemplate } from './labTemplates';
import { parseAttemptState } from './protocol';
import type { LabAttemptState, LabSpec, LabTrial, ResolvedLab } from './types';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

function labOf(spec: LabSpec): ResolvedLab {
  const lab = resolveLab(spec);
  if (!lab) throw new Error('lab no resuelto');
  return lab;
}
const modelLab = (id: string, over: Partial<LabSpec> = {}) => labOf({ ...exampleSpec(MODEL_EXAMPLES.find((e) => e.id === id)!)!, ...over });
const fixedLab = (id: string, over: Partial<LabSpec> = {}) => labOf({ ...defaultSpec(getLabTemplate(id)!), ...over });

// Un informe VALIDO: n ensayos que recorren la variable independiente (las demas en su valor fijo si el modo es controlado), calculados con el mismo modelo.
function validState(lab: ResolvedLab, n = lab.minTrials): LabAttemptState {
  const trials: LabTrial[] = [];
  for (let i = 0; i < n; i++) {
    const inputs: Record<string, number> = {};
    lab.variables.forEach((v) => {
      const moves = !v.locked && (v.id === lab.independent || lab.mode === 'libre');
      inputs[v.id] = moves ? v.min + ((v.max - v.min) * i) / Math.max(1, n - 1) : v.default;
    });
    trials.push({ n: i + 1, control: i === 0, inputs, outputs: computeOutputs(lab, inputs)! });
  }
  return {
    hypothesis: 'Creo que al aumentar la variable el resultado cambia.',
    trials,
    answers: lab.questions.map((_, i) => `Respuesta ${i + 1} basada en mi tabla de datos.`),
    conclusion: 'Con mis datos vi que el resultado cambia al mover la variable.',
  };
}
const clone = (s: LabAttemptState): LabAttemptState => JSON.parse(JSON.stringify(s));

const LABS: [string, () => ResolvedLab][] = [
  ['modelo gases', () => modelLab('gases')],
  ['modelo enzima', () => modelLab('enzima')],
  ['modelo circuito', () => modelLab('circuito')],
  ['plantilla multiplicador', () => fixedLab('multiplicador')],
  ['plantilla trayectoria', () => fixedLab('trayectoria')],
];

// ───────────────────────────── el informe valido ─────────────────────────────
describe.each(LABS)('validateSubmission: %s', (_name, make) => {
  const lab = make();
  it('un informe honesto pasa y se devuelve limpio', () => {
    const r = validateSubmission(lab, validState(lab));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.clean.trials).toHaveLength(lab.minTrials);
      expect(r.clean.trials[0].control).toBe(true);
      expect(r.clean.answers).toHaveLength(lab.questions.length);
    }
  });
  it('un resultado retocado a mano (aunque sea 1 %) no pasa', () => {
    const s = validState(lab);
    const out = lab.outputs[0].id;
    s.trials[1].outputs[out] = s.trials[1].outputs[out] * 1.01 + 0.01;
    const r = validateSubmission(lab, s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('Ensayo 2');
  });
  it('una diferencia de redondeo entre navegadores (1e-9) si pasa', () => {
    const s = validState(lab);
    const out = lab.outputs[0].id;
    s.trials[2].outputs[out] = s.trials[2].outputs[out] * (1 + 1e-9);
    expect(validateSubmission(lab, s).ok).toBe(true);
  });
});

// ───────────────────────────── cada regla ─────────────────────────────
describe('validateSubmission: reglas', () => {
  const lab = modelLab('gases');
  const bad = (mut: (s: LabAttemptState) => void, expectText: string, l: ResolvedLab = lab) => {
    const s = validState(l);
    mut(s);
    const r = validateSubmission(l, s);
    expect(r.ok, expectText).toBe(false);
    if (!r.ok) expect(r.errors.join(' | ')).toContain(expectText);
  };

  it('hipotesis y conclusion con su minimo (10 y 20), contando sin espacios de los lados', () => {
    bad((s) => (s.hypothesis = 'corta'), 'hipótesis');
    bad((s) => (s.hypothesis = '   corta     '), 'hipótesis');
    bad((s) => (s.conclusion = 'muy corta'), 'conclusión');
    bad((s) => (s.conclusion = ' '.repeat(40)), 'conclusión');
    bad((s) => (s.hypothesis = 'x'.repeat(SUBMISSION_LIMITS.textMax + 1)), 'demasiado larga');
    const ok = validState(lab);
    ok.hypothesis = 'x'.repeat(SUBMISSION_LIMITS.hypothesisMin);
    ok.conclusion = 'y'.repeat(SUBMISSION_LIMITS.conclusionMin);
    expect(validateSubmission(lab, ok).ok).toBe(true);
  });
  it('el minimo de ensayos del laboratorio', () => {
    const l = modelLab('gases', { minTrials: 5 });
    bad((s) => (s.trials = s.trials.slice(0, 3)), 'Te faltan 2 ensayo', l);
    expect(validateSubmission(l, validState(l, 5)).ok).toBe(true);
    expect(validateSubmission(l, validState(l, 8)).ok).toBe(true);
  });
  it('no mas ensayos de los que admite el protocolo', () => {
    const l = modelLab('gases', { minTrials: 3 });
    const s = validState(l, 61);
    const r = validateSubmission(l, s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('demasiados ensayos');
  });
  it('el PRIMER ensayo es el de control (no basta con que haya alguno)', () => {
    bad((s) => (s.trials[0].control = false), 'primer ensayo debe ser el ensayo de control');
    bad((s) => {
      s.trials[0].control = false;
      s.trials[2].control = true;
    }, 'primer ensayo debe ser el ensayo de control');
  });
  it('una respuesta a cada pregunta guia', () => {
    expect(lab.questions.length).toBeGreaterThan(0);
    bad((s) => (s.answers = []), 'Responde la pregunta 1');
    bad((s) => (s.answers[1] = '  '), 'Responde la pregunta 2');
    bad((s) => (s.answers[0] = 'ab'), 'Responde la pregunta 1');
  });
  it('la numeracion de los ensayos', () => {
    bad((s) => (s.trials[1].n = 7), 'numeración');
  });
  it('las variables y resultados son exactamente los del laboratorio', () => {
    bad((s) => delete (s.trials[1].inputs as any).V, 'no trae exactamente las variables');
    bad((s) => ((s.trials[1].inputs as any).extra = 1), 'no trae exactamente las variables');
    bad((s) => delete (s.trials[1].outputs as any).P, 'no trae exactamente los resultados');
    bad((s) => ((s.trials[1].outputs as any).oculto = 1), 'no trae exactamente los resultados');
  });
  it('las variables dentro de su rango', () => {
    bad((s) => (s.trials[1].inputs.V = 9999), 'fuera de su rango');
    bad((s) => (s.trials[1].inputs.V = -5), 'fuera de su rango');
    bad((s) => (s.trials[1].inputs.V = NaN), 'fuera de su rango');
    bad((s) => (s.trials[1].inputs.V = Infinity), 'fuera de su rango');
  });
  it('en modo controlado las variables bloqueadas no se mueven; en modo libre si', () => {
    const controlled = modelLab('gases', { mode: 'controlado', independent: 'V' });
    const lockedVar = controlled.variables.find((v) => v.locked)!;
    expect(lockedVar.id).toBe('T');
    bad((s) => (s.trials[1].inputs.T = 350), 'debía quedar fija', controlled);
    const free = modelLab('gases', { mode: 'libre', independent: 'V' });
    expect(validateSubmission(free, validState(free)).ok).toBe(true);
    const s = validState(free);
    s.trials[1].inputs.T = 350;
    s.trials[1].outputs = computeOutputs(free, s.trials[1].inputs)!;
    expect(validateSubmission(free, s).ok).toBe(true);
  });
  it('si el servidor no puede calcular el laboratorio, lo dice y no acepta a ciegas', () => {
    const r = validateSubmission(lab, validState(lab), () => null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('No se pudo comprobar');
  });
  it('el calculo se hace con las constantes del laboratorio (las que fijo el profesor), no con las de fabrica', () => {
    const l = modelLab('gases', { constants: { n: 2 } });
    const s = validState(l);
    expect(validateSubmission(l, s).ok).toBe(true);
    // el mismo informe contra un laboratorio con otra constante deja de ser coherente
    const other = modelLab('gases', { constants: { n: 1 } });
    expect(validateSubmission(other, s).ok).toBe(false);
  });
  it('un resultado no finito del modelo cuenta como 0, igual que en el laboratorio', () => {
    const l = modelLab('gases');
    const c = vi.fn(() => ({ P: 0, PV: 0 }));
    const s = validState(l);
    s.trials.forEach((t) => (t.outputs = { P: 0, PV: 0 }));
    expect(validateSubmission(l, s, c).ok).toBe(true);
  });
  it('lista como maximo 8 errores', () => {
    const s = validState(lab);
    s.hypothesis = '';
    s.conclusion = '';
    s.answers = [];
    s.trials.forEach((t) => (t.outputs.P = 12345));
    const r = validateSubmission(lab, s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeLessThanOrEqual(SUBMISSION_LIMITS.maxErrors);
  });
  it('un estado hostil que pasa por el protocolo tampoco rompe nada', () => {
    const hostile = parseAttemptState({ hypothesis: 'x'.repeat(50000), trials: [{ inputs: { V: 5 }, outputs: {} }], answers: new Array(50).fill('z'), conclusion: 'c' });
    expect(hostile).not.toBeNull();
    expect(validateSubmission(lab, hostile!).ok).toBe(false); // faltan los resultados del ensayo, el minimo de ensayos...
    const s = parseAttemptState({ hypothesis: 'x'.repeat(50000), trials: [], answers: new Array(50).fill('z'), conclusion: 'c' })!;
    expect(s.hypothesis.length).toBeLessThanOrEqual(2000);
    expect(validateSubmission(lab, s).ok).toBe(false);
  });
  it('rinde: 60 ensayos validan en menos de un segundo', () => {
    const l = modelLab('circuito', { minTrials: 3 });
    const s = validState(l, 60);
    const t = Date.now();
    expect(validateSubmission(l, s).ok).toBe(true);
    expect(Date.now() - t).toBeLessThan(1000);
  });
});

describe('parseReview', () => {
  it('nota de 0 a 100 con dos decimales y comentario opcional', () => {
    expect(parseReview({ score: 85.555, feedback: '  Muy bien  ' })).toEqual({ ok: true, score: 85.56, feedback: 'Muy bien' });
    expect(parseReview({ score: 0 })).toEqual({ ok: true, score: 0, feedback: null });
    expect(parseReview({ score: 100, feedback: '   ' })).toEqual({ ok: true, score: 100, feedback: null });
  });
  it('rechaza lo que no es una nota valida o un comentario valido', () => {
    for (const body of [null, 'x', {}, { score: '90' }, { score: -1 }, { score: 100.1 }, { score: NaN }, { score: Infinity }, { score: 50, feedback: 5 }, { score: 50, feedback: 'x'.repeat(REVIEW_LIMITS.feedbackMax + 1) }]) {
      expect(parseReview(body as any).ok, JSON.stringify(body)).toBe(false);
    }
  });
});

// ───────────────────────────── rutas ─────────────────────────────
describe('POST /api/lab/attempt', () => {
  const route = read('src/app/api/lab/attempt/route.ts');
  const code = codeOnly(route);
  it('lee el laboratorio con la sesion del estudiante (RLS), exige publicado e inscripcion y valida ANTES de guardar', () => {
    const lab = code.indexOf(".from('labs')");
    const enr = code.indexOf("'class_enrollments'");
    const published = code.indexOf("row.status !== 'published'");
    const validate = code.indexOf('validateSubmission(');
    const insert = code.indexOf(".insert(");
    expect(lab).toBeGreaterThan(-1);
    for (const i of [enr, published, validate, insert]) expect(i).toBeGreaterThan(-1);
    expect(enr).toBeGreaterThan(lab);
    expect(validate).toBeGreaterThan(enr);
    expect(validate).toBeGreaterThan(published);
    expect(insert).toBeGreaterThan(validate);
  });
  it('la llave de servicio solo sirve para el INSERT de la entrega ya validada; el dueño sale de la sesion, no del cuerpo', () => {
    expect(code.match(/admin\s*\.from\(/g)?.length).toBe(1);
    expect(code).toMatch(/admin\s*\n?\s*\.from\('lab_attempts'\)/);
    expect(code).toContain('student_id: user.id');
    expect(code).toContain('classroom_id: row.classroom_id');
    expect(code).not.toMatch(/student_id:\s*body/);
    expect(code).not.toMatch(/classroom_id:\s*body/);
    // lo que se guarda es lo LIMPIO que devolvio el validador
    expect(code).toContain('checked.clean.trials');
    expect(code).not.toMatch(/trials:\s*state/);
  });
  it('responde 401, 404 (no revela si existe), 413, 422 con los errores y 409 si ya entrego', () => {
    for (const s of ['401', '404', '413', '422', '409']) expect(route).toContain(`fail(${s}`);
    expect(route).toContain("error.code === '23505'");
    expect(route).toContain('MAX_BODY_CHARS');
  });
});

describe('POST /api/lab/attempt/review', () => {
  const code = codeOnly(read('src/app/api/lab/attempt/review/route.ts'));
  it('califica con la sesion del PROFESOR (no con la llave de servicio): la base decide quien puede', () => {
    expect(code).not.toContain('createAdminSupabase');
    expect(code).not.toContain('SERVICE_ROLE');
    expect(code).toContain(".from('lab_attempts')");
    expect(code).toContain("status: 'reviewed'");
  });
  it('solo toca nota, comentario y estado; sin filas devuelve 404', () => {
    expect(code).toMatch(/update\(\{ score: review\.score, teacher_feedback: review\.feedback, status: 'reviewed' \}\)/);
    expect(code).toContain('data.length === 0');
    expect(code).toContain('fail(404');
    expect(code).toContain('parseReview(');
  });
});

// ───────────────────────────── migracion 082 ─────────────────────────────
describe('migracion 082', () => {
  const sql = read('supabase/migrations/082_lab_attempts.sql');
  const code = sql.replace(/--.*$/gm, '');
  it('no hay INSERT directo para el navegador: ni politica ni permiso', () => {
    expect(code).not.toMatch(/FOR INSERT/i);
    expect(code).not.toMatch(/GRANT\s+(?:ALL|INSERT)/i);
    expect(code).toMatch(/REVOKE ALL ON TABLE public\.lab_attempts FROM anon, authenticated/);
    expect(code).toMatch(/GRANT SELECT ON TABLE public\.lab_attempts TO authenticated/);
  });
  it('el profesor solo puede actualizar nota, comentario y estado (permiso por columna)', () => {
    expect(code).toMatch(/GRANT UPDATE \(status, score, teacher_feedback\) ON TABLE public\.lab_attempts TO authenticated/);
    expect(code.match(/GRANT UPDATE/g)?.length).toBe(1);
    expect(code).toMatch(/FOR UPDATE/);
    expect(code).not.toMatch(/FOR DELETE/i);
  });
  it('RLS activa; el estudiante lee las suyas y el profesor las de su clase', () => {
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(code).toMatch(/student_id = auth\.uid\(\)/);
    expect(code).toMatch(/c\.teacher_id = auth\.uid\(\)/);
    expect(code.match(/CREATE POLICY/g)?.length).toBe(3);
  });
  it('los minimos y topes de la base coinciden con los del validador', () => {
    expect(code).toContain(`char_length(hypothesis) BETWEEN ${SUBMISSION_LIMITS.hypothesisMin} AND ${SUBMISSION_LIMITS.textMax}`);
    expect(code).toContain(`char_length(conclusion) BETWEEN ${SUBMISSION_LIMITS.conclusionMin} AND ${SUBMISSION_LIMITS.textMax}`);
    expect(code).toContain('pg_column_size(trials) < 65536');
    expect(code).toContain(`char_length(teacher_feedback) <= ${REVIEW_LIMITS.feedbackMax}`);
  });
  it('una entrega por estudiante y laboratorio, y una revisada siempre tiene nota', () => {
    expect(code).toContain('UNIQUE (lab_id, student_id)');
    expect(code).toContain("CHECK ((status = 'reviewed') = (score IS NOT NULL))");
    expect(code).toContain('score >= 0 AND score <= 100');
  });
  it('se borra con el laboratorio, el estudiante o la clase', () => {
    expect(code.match(/ON DELETE CASCADE/g)?.length).toBe(3);
  });
});

// ───────────────────────────── paridad con el laboratorio del navegador ─────────────────────────────
describe('el laboratorio del navegador pide lo mismo que el servidor', () => {
  const runtime = read('public/labs/runtime.js');
  it('minimos de hipotesis y conclusion', () => {
    expect(runtime).toContain(`S.hypothesis.trim().length < ${SUBMISSION_LIMITS.hypothesisMin}`);
    expect(runtime).toContain(`S.conclusion.trim().length < ${SUBMISSION_LIMITS.conclusionMin}`);
  });
  it('el primer ensayo es el de control', () => {
    expect(runtime).toContain('S.trials.length > 0 && !S.trials[0].control');
    expect(runtime).toContain('El primer ensayo debe ser el ensayo de control');
  });
  it('lo que un estudiante no puede hacer por la consola tampoco por el navegador: el borrador no es la entrega', () => {
    const runner = read('src/app/(student)/my-classes/[id]/labs/[labId]/LabRunner.tsx');
    expect(runner).toContain("fetch('/api/lab/attempt'");
    expect(runner).not.toContain("from('lab_attempts')");
    expect(runner).not.toContain('supabase');
  });
});

describe('pantallas', () => {
  it('el profesor llega a las entregas desde cada laboratorio publicado', () => {
    const m = read('src/app/(teacher)/teacher/classrooms/[id]/lab/LabManagerClient.tsx');
    expect(m).toContain('/lab/${it.id}');
    expect(m).toContain("it.status === 'published' && (");
  });
  it('el estudiante ve el enlace a Laboratorios solo si hay publicados', () => {
    const p = read('src/app/(student)/my-classes/[id]/page.tsx');
    expect(p).toContain('hasLabs');
    expect(p).toContain('/labs`');
  });
  it('los componentes del navegador no cargan el codigo de servidor (submission.ts trae el evaluador y los modelos)', () => {
    for (const f of ['src/app/(teacher)/teacher/classrooms/[id]/lab/[labId]/AttemptsReview.tsx', 'src/app/(student)/my-classes/[id]/labs/[labId]/LabRunner.tsx']) {
      expect(read(f)).not.toContain('/lab/submission');
    }
  });
  it('la revision y el informe se vuelven a pasar por el parser del protocolo antes de mostrarse', () => {
    expect(read('src/app/(teacher)/teacher/classrooms/[id]/lab/[labId]/page.tsx')).toContain('parseAttemptState(');
    expect(read('src/app/(student)/my-classes/[id]/labs/[labId]/page.tsx')).toContain('parseAttemptState(');
  });
  it('las dos paginas comprueban que la clase es del usuario antes de leer nada', () => {
    const t = read('src/app/(teacher)/teacher/classrooms/[id]/lab/[labId]/page.tsx');
    expect(t.indexOf(".eq('teacher_id', user.id)")).toBeGreaterThan(-1);
    expect(t.indexOf(".eq('teacher_id', user.id)")).toBeLessThan(t.indexOf("from('lab_attempts')"));
    const s = read('src/app/(student)/my-classes/[id]/labs/[labId]/page.tsx');
    expect(s.indexOf("'class_enrollments'")).toBeLessThan(s.indexOf("from('lab_attempts')"));
  });
});

// ───────────────────────────── el calculo del servidor ─────────────────────────────
describe('computeOutputs', () => {
  it('un resultado no finito del modelo cuenta como 0, igual que hace el laboratorio en el navegador', () => {
    const base = modelLab('gases');
    const broken: ResolvedLab = { ...base, model: { ...base.model!, outputs: base.model!.outputs.map((o) => (o.id === 'P' ? { ...o, expr: 'ln(V - 21)' } : o)) } };
    const out = computeOutputs(broken, { V: 5, T: 300 })!;
    expect(out.P).toBe(0);
    expect(out.PV).toBeGreaterThan(0);
  });
  it('una plantilla que no existe no se calcula (nunca se arma una ruta con texto del cliente)', () => {
    const base = fixedLab('multiplicador');
    expect(computeOutputs({ ...base, template: '../../etc/passwd' }, {})).toBeNull();
    expect(computeOutputs({ ...base, template: 'inexistente' }, {})).toBeNull();
  });
});

// ───────────────────────────── las rutas, ejecutadas con una base simulada ─────────────────────────────
const h = vi.hoisted(() => ({
  user: { id: 'stu-1' } as { id: string } | null,
  row: null as Record<string, unknown> | null,
  enrolled: true,
  hasKey: true,
  insertError: null as { code?: string; message?: string } | null,
  inserted: [] as { table: string; payload: Record<string, unknown> }[],
  adminCalls: 0,
  reviewRows: [] as unknown[],
  reviewPayload: null as Record<string, unknown> | null,
  // Presupuesto de jsonb que la guardia debe rechazar en esta prueba (null = comportamiento real).
  guardFail: null as string | null,
  guardMark: false,
  guardCalls: [] as string[],
}));

vi.mock('@/lib/db/jsonbGuard', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db/jsonbGuard')>();
  return {
    ...real,
    guardJsonb: (value: unknown, budget: any, opts?: any) => {
      h.guardCalls.push(String(budget));
      if (h.guardFail === budget) return { ok: false, reason: 'size', message: 'forzado por la prueba' };
      if (h.guardMark) return { ok: true, value: [{ marca: String(budget) }], bytes: 1, report: { removedKeys: 0, strippedNul: 0, fixedSurrogates: 0, nonFinite: 0 } };
      return real.guardJsonb(value, budget, opts);
    },
  };
});

vi.mock('@/lib/supabase/server', () => {
  const chain = (result: unknown, onUpdate?: (p: Record<string, unknown>) => void) => {
    const c: any = {
      select: () => c,
      eq: () => c,
      update: (p: Record<string, unknown>) => (onUpdate?.(p), c),
      maybeSingle: async () => result,
      then: (resolve: (v: unknown) => void) => resolve(result),
    };
    return c;
  };
  return {
    createServerSupabase: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (table: string) => {
        if (table === 'labs') return chain({ data: h.row });
        if (table === 'class_enrollments') return chain({ data: h.enrolled ? { student_id: 'stu-1' } : null });
        return chain({ data: h.reviewRows, error: null }, (p) => (h.reviewPayload = p));
      },
    }),
  };
});
vi.mock('@/lib/supabase/admin', () => ({
  hasServiceRoleKey: () => h.hasKey,
  MISSING_SERVICE_KEY_MESSAGE: 'sin llave',
  createAdminSupabase: () => {
    h.adminCalls++;
    return {
      from: (table: string) => ({
        insert: (payload: Record<string, unknown>) => {
          h.inserted.push({ table, payload });
          return { select: () => ({ single: async () => (h.insertError ? { data: null, error: h.insertError } : { data: { id: 'att-1' }, error: null }) }) };
        },
      }),
    };
  },
}));

const LAB_ID = '11111111-1111-4111-8111-111111111111';
const CLS_ID = '22222222-2222-4222-8222-222222222222';
const ATT_ID = '33333333-3333-4333-8333-333333333333';
const gasesSpec = (): LabSpec => exampleSpec(MODEL_EXAMPLES.find((e) => e.id === 'gases')!)!;
const labRow = (over: Record<string, unknown> = {}) => ({ id: LAB_ID, classroom_id: CLS_ID, teacher_id: 't1', title: 'Gases', template: 'modelo', spec: gasesSpec(), source_material_id: null, status: 'published', created_at: '', updated_at: '', published_at: '', ...over });
const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/lab/attempt/route');
  return POST(new Request('http://localhost/api/lab/attempt', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }) as any);
};
const reset = () => {
  h.user = { id: 'stu-1' };
  h.row = labRow();
  h.enrolled = true;
  h.hasKey = true;
  h.insertError = null;
  h.inserted = [];
  h.adminCalls = 0;
  h.reviewRows = [{ id: ATT_ID, score: 90, teacher_feedback: 'Bien', status: 'reviewed' }];
  h.reviewPayload = null;
  h.guardFail = null;
  h.guardMark = false;
  h.guardCalls = [];
};

describe('POST /api/lab/attempt (comportamiento)', () => {
  const lab = () => resolveLab(gasesSpec())!;
  it('una entrega valida se guarda con el estudiante de la SESION y lo que devolvio el validador', async () => {
    reset();
    const res = await post({ labId: LAB_ID, studentId: 'otro', classroomId: 'otra', state: validState(lab()) });
    expect(res.status).toBe(200);
    expect(h.inserted).toHaveLength(1);
    const p = h.inserted[0].payload;
    expect(h.inserted[0].table).toBe('lab_attempts');
    expect(p.student_id).toBe('stu-1');
    expect(p.classroom_id).toBe(CLS_ID);
    expect(p.lab_id).toBe(LAB_ID);
    expect((p.trials as unknown[]).length).toBe(lab().minTrials);
  });
  it('los dos documentos jsonb del informe pasan por la guardia (ensayos y respuestas) antes de abrir el cliente de servicio', async () => {
    reset();
    expect((await post({ labId: LAB_ID, state: validState(lab()) })).status).toBe(200);
    expect(h.guardCalls.sort()).toEqual(['labAnswers', 'labTrials']);
  });
  it('lo que se escribe en la base es la copia que devuelve la guardia, no el original del informe', async () => {
    reset();
    h.guardMark = true;
    expect((await post({ labId: LAB_ID, state: validState(lab()) })).status).toBe(200);
    expect(h.inserted[0].payload.trials).toEqual([{ marca: 'labTrials' }]);
    expect(h.inserted[0].payload.answers).toEqual([{ marca: 'labAnswers' }]);
  });
  it.each(['labTrials', 'labAnswers'])('si la guardia rechaza %s: 422 con mensaje claro, sin abrir el cliente de servicio ni guardar nada', async (budget) => {
    reset();
    h.guardFail = budget;
    const res = await post({ labId: LAB_ID, state: validState(lab()) });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/demasiado grande/);
    expect(h.inserted).toHaveLength(0);
    expect(h.adminCalls).toBe(0);
  });
  it('un informe invalido se rechaza con 422 y los errores, y NO se guarda nada', async () => {
    reset();
    const s = validState(lab());
    s.trials[1].outputs.P = s.trials[1].outputs.P * 2;
    const res = await post({ labId: LAB_ID, state: s });
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.errors.join(' ')).toContain('Ensayo 2');
    expect(h.inserted).toHaveLength(0);
    expect(h.adminCalls).toBe(0);
  });
  it('sin sesion: 401; sin llave de servicio: 503; cuerpo roto o id invalido: 400; enorme: 413', async () => {
    reset();
    h.user = null;
    expect((await post({ labId: LAB_ID, state: validState(lab()) })).status).toBe(401);
    reset();
    h.hasKey = false;
    expect((await post({ labId: LAB_ID, state: validState(lab()) })).status).toBe(503);
    reset();
    expect((await post('{no es json')).status).toBe(400);
    expect((await post({ labId: 'no-es-uuid', state: validState(lab()) })).status).toBe(400);
    expect((await post({ labId: LAB_ID, state: 'x'.repeat(200_000) })).status).toBe(413);
    expect((await post({ labId: LAB_ID, state: { trials: 'no' } })).status).toBe(400);
    expect(h.inserted).toHaveLength(0);
  });
  it('un estudiante NO inscrito, un laboratorio sin publicar o inexistente: 404 sin guardar', async () => {
    reset();
    h.enrolled = false;
    expect((await post({ labId: LAB_ID, state: validState(lab()) })).status).toBe(404);
    reset();
    h.row = labRow({ status: 'draft' });
    expect((await post({ labId: LAB_ID, state: validState(lab()) })).status).toBe(404);
    reset();
    h.row = null;
    expect((await post({ labId: LAB_ID, state: validState(lab()) })).status).toBe(404);
    expect(h.inserted).toHaveLength(0);
  });
  it('la segunda entrega del mismo estudiante: 409; otro error de la base: 500 sin filtrar el detalle', async () => {
    reset();
    h.insertError = { code: '23505', message: 'duplicate key' };
    expect((await post({ labId: LAB_ID, state: validState(lab()) })).status).toBe(409);
    reset();
    h.insertError = { code: 'XX000', message: 'detalle interno secreto' };
    const res = await post({ labId: LAB_ID, state: validState(lab()) });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secreto');
  });
});

describe('POST /api/lab/attempt/review (comportamiento)', () => {
  const review = async (body: unknown) => {
    const { POST } = await import('@/app/api/lab/attempt/review/route');
    return POST(new Request('http://localhost/api/lab/attempt/review', { method: 'POST', body: JSON.stringify(body) }) as any);
  };
  it('califica con la sesion del profesor, solo nota/comentario/estado, y no usa la llave de servicio', async () => {
    reset();
    const res = await review({ attemptId: ATT_ID, score: 90, feedback: 'Bien', hypothesis: 'reescrita', status: 'submitted' });
    expect(res.status).toBe(200);
    expect(h.reviewPayload).toEqual({ score: 90, teacher_feedback: 'Bien', status: 'reviewed' });
    expect(h.adminCalls).toBe(0);
  });
  it('sin sesion 401; nota invalida o id invalido 400; entrega ajena o inexistente 404', async () => {
    reset();
    h.user = null;
    expect((await review({ attemptId: ATT_ID, score: 90 })).status).toBe(401);
    reset();
    expect((await review({ attemptId: ATT_ID, score: 101 })).status).toBe(400);
    expect((await review({ attemptId: 'x', score: 50 })).status).toBe(400);
    reset();
    h.reviewRows = [];
    expect((await review({ attemptId: ATT_ID, score: 50 })).status).toBe(404);
  });
});
