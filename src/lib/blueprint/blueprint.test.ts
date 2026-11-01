import { describe, expect, it } from 'vitest';
import { parseBlueprint, normalizeText } from './parse';
import { checkBlueprint, isPublishable } from './validate';
import { planRegeneration, type NodeAction } from './regenerate';
import { FINAL_EXAM_FACTOR, PERIOD_EXAM_POINTS, PERIOD_MODULES_POINTS, canRetakeExam, courseGrade, courseProgress, examMastered, examScore, finalExamResult, finalExamWeight, flattenModules, hasMastered, moduleScore, periodResult, periodResultOf } from './progress';
import { BLUEPRINT_LIMITS, type Blueprint, type IssueCode } from './types';

// Plan base valido: 2 comprensiones, 2 cortes (40 / 60), 3 objetivos, 4 modulos.
const base = (): Blueprint => ({
  version: 1,
  outcomes: [
    { id: 'o1', statement: 'Explica la elasticidad de la demanda' },
    { id: 'o2', statement: 'Calcula el equilibrio de mercado' },
  ],
  periods: [
    {
      id: 'p1',
      name: 'Primer corte',
      order: 1,
      weight: 40,
      assessesOutcomeIds: ['o1'],
      objectives: [{ id: 'ob1', title: 'Entender la elasticidad', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'Concepto', order: 1 }, { id: 'm2', title: 'Calculo', order: 2 }] }],
    },
    {
      id: 'p2',
      name: 'Segundo corte',
      order: 2,
      weight: 60,
      assessesOutcomeIds: ['o1', 'o2'],
      objectives: [
        { id: 'ob2', title: 'Hallar el equilibrio', outcomeIds: ['o2'], modules: [{ id: 'm3', title: 'Oferta y demanda', order: 1 }] },
        { id: 'ob3', title: 'Aplicar la elasticidad', outcomeIds: ['o1'], modules: [{ id: 'm4', title: 'Casos', order: 1 }] },
      ],
    },
  ],
});

const codes = (bp: Blueprint) => checkBlueprint(bp).map((i) => i.code);
const withCode = (bp: Blueprint, code: IssueCode) => checkBlueprint(bp).filter((i) => i.code === code);

// ───────────────────────────────────────────── parseBlueprint
describe('parseBlueprint', () => {
  it('acepta un plan valido tal cual', () => {
    const r = parseBlueprint(base());
    expect(r.ok).toBe(true);
    expect(r.ok && r.blueprint).toEqual(base());
  });
  it('la version falta -> 1; el orden falta -> posicion; ordena por orden', () => {
    const raw: any = base();
    delete raw.version;
    delete raw.periods[0].order;
    delete raw.periods[1].order;
    raw.periods.reverse();
    raw.periods[1].objectives[0].modules.reverse();
    delete raw.periods[1].objectives[0].modules[0].order;
    delete raw.periods[1].objectives[0].modules[1].order;
    const r = parseBlueprint(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.blueprint.version).toBe(1);
    // reverse() dejo [p2, p1] con orden = posicion (1, 2): p2 va primero
    expect(r.blueprint.periods.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(r.blueprint.periods.map((p) => p.order)).toEqual([1, 2]);
  });
  it('ordena los modulos por su orden', () => {
    const raw = base();
    raw.periods[0].objectives[0].modules.reverse();
    const r = parseBlueprint(raw);
    expect(r.ok && r.blueprint.periods[0].objectives[0].modules.map((m) => m.id)).toEqual(['m1', 'm2']);
  });
  it('ordena los cortes por su orden EXPLICITO, no por su posicion en la lista', () => {
    const raw: any = base();
    raw.periods[0].order = 2;
    raw.periods[1].order = 1;
    const r = parseBlueprint(raw);
    expect(r.ok && r.blueprint.periods.map((p) => p.id)).toEqual(['p2', 'p1']);
  });
  it('limpia el texto: espacios, saltos y caracteres de control', () => {
    const raw: any = base();
    raw.outcomes[0].statement = '  Explica \n  la\telasticidad\u0000 \u0007 ';
    const r = parseBlueprint(raw);
    expect(r.ok && r.blueprint.outcomes[0].statement).toBe('Explica la elasticidad');
    expect(normalizeText('a\u0000b\u007Fc')).toBe('abc');
  });
  it('quita ids repetidos de las listas de comprensiones y descarta campos que no conoce', () => {
    const raw: any = base();
    raw.periods[0].assessesOutcomeIds = ['o1', 'o1'];
    raw.periods[0].objectives[0].outcomeIds = ['o1', 'o1'];
    raw.extra = 'x';
    raw.periods[0].secreto = 'y';
    const r = parseBlueprint(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.blueprint.periods[0].assessesOutcomeIds).toEqual(['o1']);
    expect(r.blueprint.periods[0].objectives[0].outcomeIds).toEqual(['o1']);
    expect(JSON.stringify(r.blueprint)).not.toMatch(/secreto|extra/);
  });
  it.each([[null], [undefined], ['texto'], [5], [[]], [true]])('un plan que no es objeto (%s) se rechaza', (raw) => {
    const r = parseBlueprint(raw);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toEqual(['El plan debe ser un objeto.']);
  });
  it('faltan las listas -> errores con su ruta', () => {
    const r = parseBlueprint({});
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join('|')).toMatch(/outcomes: debe ser una lista/);
    expect(!r.ok && r.errors.join('|')).toMatch(/periods: debe ser una lista/);
  });
  it('los errores dicen DONDE esta el problema', () => {
    const raw: any = base();
    raw.periods[1].objectives[0].title = '';
    const r = parseBlueprint(raw);
    expect(!r.ok && r.errors).toEqual(['periods[1].objectives[0].title: no puede estar vacio.']);
  });
  it('el largo de los textos: justo en el limite pasa, uno mas se rechaza', () => {
    const ok: any = base();
    ok.outcomes[0].statement = 'a'.repeat(BLUEPRINT_LIMITS.statement);
    ok.periods[0].name = 'b'.repeat(BLUEPRINT_LIMITS.title);
    expect(parseBlueprint(ok).ok).toBe(true);
    const bad: any = base();
    bad.outcomes[0].statement = 'a'.repeat(BLUEPRINT_LIMITS.statement + 1);
    expect(!parseBlueprint(bad).ok && (parseBlueprint(bad) as any).errors[0]).toMatch(/outcomes\[0\]\.statement: no puede pasar de 300/);
    const bad2: any = base();
    bad2.periods[0].objectives[0].modules[0].title = 'b'.repeat(BLUEPRINT_LIMITS.title + 1);
    expect(parseBlueprint(bad2).ok).toBe(false);
  });
  it('los limites de cantidad', () => {
    const many = (n: number, f: (i: number) => any) => Array.from({ length: n }, (_, i) => f(i));
    const o = (n: number) => many(n, (i) => ({ id: `o${i}`, statement: `c${i}` }));
    expect(parseBlueprint({ outcomes: o(BLUEPRINT_LIMITS.outcomes), periods: [] }).ok).toBe(true);
    expect(parseBlueprint({ outcomes: o(BLUEPRINT_LIMITS.outcomes + 1), periods: [] }).ok).toBe(false);
    const pr = (n: number) => many(n, (i) => ({ id: `p${i}`, name: 'c', weight: 1, assessesOutcomeIds: [], objectives: [] }));
    expect(parseBlueprint({ outcomes: [], periods: pr(BLUEPRINT_LIMITS.periods) }).ok).toBe(true);
    expect(parseBlueprint({ outcomes: [], periods: pr(BLUEPRINT_LIMITS.periods + 1) }).ok).toBe(false);
    const ob = (n: number) => many(n, (i) => ({ id: `ob${i}`, title: 't', outcomeIds: [], modules: [] }));
    const period = (objectives: any[]) => ({ id: 'p', name: 'c', weight: 1, assessesOutcomeIds: [], objectives });
    expect(parseBlueprint({ outcomes: [], periods: [period(ob(BLUEPRINT_LIMITS.objectivesPerPeriod))] }).ok).toBe(true);
    expect(parseBlueprint({ outcomes: [], periods: [period(ob(BLUEPRINT_LIMITS.objectivesPerPeriod + 1))] }).ok).toBe(false);
    const mods = (n: number) => many(n, (i) => ({ id: `m${i}`, title: 't' }));
    const objWith = (n: number) => ({ id: 'ob', title: 't', outcomeIds: [], modules: mods(n) });
    expect(parseBlueprint({ outcomes: [], periods: [period([objWith(BLUEPRINT_LIMITS.modulesPerObjective)])] }).ok).toBe(true);
    expect(parseBlueprint({ outcomes: [], periods: [period([objWith(BLUEPRINT_LIMITS.modulesPerObjective + 1)])] }).ok).toBe(false);
  });
  it.each([[''], ['con espacio'], ['a/b'], ['x'.repeat(41)], [5], [null], ['á']])('un id invalido (%s) se rechaza', (bad) => {
    const raw: any = base();
    raw.outcomes[0].id = bad;
    expect(parseBlueprint(raw).ok).toBe(false);
  });
  it('un id de 40 caracteres pasa', () => {
    const raw: any = base();
    raw.outcomes[0].id = 'x'.repeat(40);
    raw.periods[0].assessesOutcomeIds = [];
    expect(parseBlueprint(raw).ok).toBe(true);
  });
  it('ids repetidos: comprensiones, cortes, y objetivos/modulos (comparten espacio)', () => {
    const a: any = base();
    a.outcomes[1].id = 'o1';
    expect(!parseBlueprint(a).ok && (parseBlueprint(a) as any).errors.join()).toMatch(/outcomes\[1\]\.id.*repetido/);
    const b: any = base();
    b.periods[1].id = 'p1';
    expect(parseBlueprint(b).ok).toBe(false);
    const c: any = base();
    c.periods[0].objectives[0].modules[0].id = 'ob1'; // un modulo con el id de un objetivo
    expect(parseBlueprint(c).ok).toBe(false);
    const d: any = base();
    d.periods[1].objectives[0].id = 'ob1'; // objetivo repetido en otro corte
    expect(parseBlueprint(d).ok).toBe(false);
  });
  it('el mismo id puede estar en una comprension y en un corte (espacios separados)', () => {
    const raw: any = base();
    raw.periods[0].id = 'o1';
    expect(parseBlueprint(raw).ok).toBe(true);
  });
  it.each([['70'], [NaN], [Infinity], [null], [undefined]])('una ponderacion que no es un numero finito (%s) se rechaza', (w) => {
    const raw: any = base();
    raw.periods[0].weight = w;
    expect(parseBlueprint(raw).ok).toBe(false);
  });
  it.each([[-1], [1.5], ['2'], [NaN]])('un orden invalido (%s) se rechaza', (o) => {
    const raw: any = base();
    raw.periods[0].order = o;
    expect(parseBlueprint(raw).ok).toBe(false);
  });
  it.each([[0], [1.5], ['1'], [-3]])('una version invalida (%s) se rechaza', (v) => {
    const raw: any = base();
    raw.version = v;
    expect(parseBlueprint(raw).ok).toBe(false);
  });
  it('los errores se acotan a 30', () => {
    const raw = { outcomes: Array.from({ length: 20 }, () => ({ id: '', statement: '' })), periods: Array.from({ length: 12 }, () => ({})) };
    const r = parseBlueprint(raw);
    expect(!r.ok && r.errors.length).toBe(30);
  });
  it('nunca lanza con basura', () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const junk = (d: number): unknown => {
      const r = rnd();
      if (d === 0 || r < 0.25) return [null, 1, 'x', true, undefined, NaN, '', {}, []][Math.floor(rnd() * 9)];
      if (r < 0.6) return Array.from({ length: Math.floor(rnd() * 4) }, () => junk(d - 1));
      const o: Record<string, unknown> = {};
      for (const k of ['id', 'title', 'name', 'statement', 'weight', 'order', 'outcomes', 'periods', 'objectives', 'modules', 'outcomeIds', 'assessesOutcomeIds', 'version']) if (rnd() < 0.5) o[k] = junk(d - 1);
      return o;
    };
    for (let i = 0; i < 400; i++) expect(() => parseBlueprint(junk(5))).not.toThrow();
  });
  it('un id "__proto__" es valido y no contamina nada', () => {
    const raw: any = base();
    raw.periods[0].objectives[0].modules[0].id = '__proto__';
    const r = parseBlueprint(raw);
    expect(r.ok).toBe(true);
    expect(({} as any).title).toBeUndefined();
  });
});

// ───────────────────────────────────────────── checkBlueprint
describe('checkBlueprint: el plan coherente', () => {
  it('el plan base no tiene ningun problema y se puede publicar', () => {
    expect(checkBlueprint(base())).toEqual([]);
    expect(isPublishable(checkBlueprint(base()))).toBe(true);
  });
});

describe('checkBlueprint: ponderaciones', () => {
  it('no suman 100', () => {
    const bp = base();
    bp.periods[0].weight = 30;
    const w = withCode(bp, 'weightSum');
    expect(w).toHaveLength(1);
    expect(w[0].message).toMatch(/suman 90 y deben sumar 100/);
    expect(w[0].severity).toBe('error');
  });
  it('tolerancia de redondeo: 33.33 + 33.33 + 33.34 = 100 pasa; 99.99 pasa; 99.98 no', () => {
    const three = (a: number, b: number, c: number) => {
      const bp = base();
      bp.periods[0].weight = a;
      bp.periods[1].weight = b;
      bp.periods.push({ id: 'p3', name: 'Tercer corte', order: 3, weight: c, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob9', title: 'X', outcomeIds: ['o1'], modules: [{ id: 'm9', title: 'Y', order: 1 }] }] });
      return withCode(bp, 'weightSum').length;
    };
    expect(three(33.33, 33.33, 33.34)).toBe(0);
    expect(three(33.33, 33.33, 33.33)).toBe(0);
    expect(three(33.33, 33.33, 33.32)).toBe(1);
    expect(three(40, 40, 30)).toBe(1);
  });
  it.each([[0], [-5], [100.5], [101]])('un corte con ponderacion %s esta fuera de rango', (w) => {
    const bp = base();
    bp.periods[0].weight = w;
    const r = withCode(bp, 'weightRange');
    expect(r).toHaveLength(1);
    expect(r[0].ref).toBe('p1');
  });
  it('un solo corte de 100 es valido; 100 exacto no esta fuera de rango', () => {
    const bp = base();
    bp.periods = [{ ...bp.periods[0], weight: 100, assessesOutcomeIds: ['o1', 'o2'], objectives: [...bp.periods[0].objectives, bp.periods[1].objectives[0]] }];
    expect(codes(bp)).toEqual([]);
  });
});

describe('checkBlueprint: la cadena hacia atras', () => {
  it('sin comprensiones / sin cortes', () => {
    expect(codes({ version: 1, outcomes: [], periods: base().periods })).toContain('noOutcomes');
    expect(codes({ version: 1, outcomes: base().outcomes, periods: [] })).toEqual(expect.arrayContaining(['noPeriods', 'outcomeNotAssessed']));
    const none = checkBlueprint({ version: 1, outcomes: [], periods: [] });
    expect(none.map((i) => i.code)).toEqual(['noOutcomes', 'noPeriods']);
    expect(none.map((i) => i.code)).not.toContain('weightSum'); // sin cortes no se exige "sumar 100" ademas
  });
  it('una comprension que ningun corte evalua', () => {
    const bp = base();
    bp.periods[1].assessesOutcomeIds = ['o1'];
    bp.periods[1].objectives = [bp.periods[1].objectives[1]];
    const r = withCode(bp, 'outcomeNotAssessed');
    expect(r).toHaveLength(1);
    expect(r[0].ref).toBe('o2');
  });
  it('un corte que no evalua nada', () => {
    const bp = base();
    bp.periods[0].assessesOutcomeIds = [];
    bp.periods[0].objectives[0].outcomeIds = [];
    expect(withCode(bp, 'periodAssessesNothing').map((i) => i.ref)).toEqual(['p1']);
  });
  it('un id de comprension que no existe, en el corte y en el objetivo', () => {
    const bp = base();
    bp.periods[0].assessesOutcomeIds = ['o1', 'fantasma'];
    bp.periods[1].objectives[0].outcomeIds = ['o2', 'otro'];
    const r = withCode(bp, 'unknownOutcome');
    expect(r.map((i) => i.ref).sort()).toEqual(['ob2', 'p1']);
  });
  it('un objetivo que apunta a algo que su corte no evalua', () => {
    const bp = base();
    bp.periods[0].objectives[0].outcomeIds = ['o1', 'o2']; // p1 solo evalua o1
    const r = withCode(bp, 'objectiveOutsideExam');
    expect(r).toHaveLength(1);
    expect(r[0].ref).toBe('ob1');
    expect(r[0].message).toMatch(/Calcula el equilibrio.*Primer corte/);
  });
  it('un objetivo sin comprension', () => {
    const bp = base();
    bp.periods[0].objectives[0].outcomeIds = [];
    expect(withCode(bp, 'objectiveWithoutOutcome').map((i) => i.ref)).toEqual(['ob1']);
  });
  it('se evalua algo que ningun objetivo del corte ensena', () => {
    const bp = base();
    bp.periods[1].objectives = [bp.periods[1].objectives[1]]; // queda solo ob3 (o1): nadie ensena o2
    const r = withCode(bp, 'assessedWithoutObjective');
    expect(r).toHaveLength(1);
    expect(r[0].ref).toBe('p2');
    expect(r[0].message).toMatch(/Calcula el equilibrio/);
  });
  it('un objetivo sin modulos y un corte sin objetivos', () => {
    const bp = base();
    bp.periods[0].objectives[0].modules = [];
    expect(withCode(bp, 'objectiveWithoutModules').map((i) => i.ref)).toEqual(['ob1']);
    const bp2 = base();
    bp2.periods[0].objectives = [];
    expect(withCode(bp2, 'periodWithoutObjectives').map((i) => i.ref)).toEqual(['p1']);
  });
  it('orden repetido entre cortes y entre modulos de un objetivo; el mismo orden en OBJETIVOS distintos es normal', () => {
    const bp = base();
    bp.periods[1].order = 1;
    expect(withCode(bp, 'duplicateOrder').map((i) => i.ref)).toEqual(['p2']);
    const bp2 = base();
    bp2.periods[0].objectives[0].modules[1].order = 1;
    expect(withCode(bp2, 'duplicateOrder').map((i) => i.ref)).toEqual(['m2']);
    expect(withCode(base(), 'duplicateOrder')).toEqual([]); // m3 y m4 tienen orden 1 en objetivos distintos
  });
  it('una comprension repetida es solo un AVISO (no impide publicar), sin importar mayusculas ni espacios', () => {
    const bp = base();
    bp.outcomes[1].statement = '  EXPLICA   la elasticidad de la DEMANDA ';
    const r = withCode(bp, 'duplicateOutcome');
    expect(r).toHaveLength(1);
    expect(r[0].severity).toBe('warning');
    expect(r[0].ref).toBe('o2');
    expect(isPublishable(checkBlueprint(bp))).toBe(true);
  });
  it('devuelve TODOS los problemas, no solo el primero', () => {
    const bp = base();
    bp.periods[0].weight = 10;
    bp.periods[0].objectives[0].modules = [];
    bp.periods[1].objectives[0].outcomeIds = [];
    const c = codes(bp);
    expect(c).toEqual(expect.arrayContaining(['weightSum', 'objectiveWithoutModules', 'objectiveWithoutOutcome']));
    expect(isPublishable(checkBlueprint(bp))).toBe(false);
  });
  it('isPublishable: solo los errores bloquean', () => {
    expect(isPublishable([])).toBe(true);
    expect(isPublishable([{ severity: 'warning', code: 'duplicateOutcome', message: 'x' }])).toBe(true);
    expect(isPublishable([{ severity: 'warning', code: 'duplicateOutcome', message: 'x' }, { severity: 'error', code: 'weightSum', message: 'y' }])).toBe(false);
  });
});

// ───────────────────────────────────────────── planRegeneration
const actions = (list: { id: string; action: NodeAction }[]) => Object.fromEntries(list.map((n) => [n.id, n.action]));

describe('planRegeneration', () => {
  it('sin cambios: todo se conserva', () => {
    const p = planRegeneration(base(), base());
    expect(p.outcomes).toEqual([]);
    expect(Object.values(actions(p.periodExams))).toEqual(['keep', 'keep']);
    expect(Object.values(actions(p.objectives))).toEqual(['keep', 'keep', 'keep']);
    expect(Object.values(actions(p.modules))).toEqual(['keep', 'keep', 'keep', 'keep']);
    expect(p.summary).toEqual({ keep: 9, regenerate: 0, version: 0, create: 0, delete: 0, archive: 0 });
  });
  it('cambiar solo el titulo de un objetivo, un modulo, un corte, o las mayusculas/espacios de una comprension NO regenera nada', () => {
    const bp = base();
    bp.outcomes[0].statement = '  EXPLICA la   elasticidad de la demanda ';
    bp.periods[0].name = 'Otro nombre';
    bp.periods[0].weight = 50; // la ponderacion tampoco
    bp.periods[0].objectives[0].title = 'Otro titulo';
    bp.periods[0].objectives[0].modules[0].title = 'Otro modulo';
    const p = planRegeneration(base(), bp);
    expect(p.outcomes).toEqual([]);
    expect(p.summary.keep).toBe(9);
  });
  it('editar una comprension regenera su evaluacion de corte, los objetivos que apuntan a ella y sus modulos; el resto se conserva', () => {
    const bp = base();
    bp.outcomes[1].statement = 'Calcula el equilibrio con impuestos';
    const p = planRegeneration(base(), bp);
    expect(p.outcomes).toEqual([{ id: 'o2', change: 'edited' }]);
    expect(actions(p.periodExams)).toEqual({ p1: 'keep', p2: 'regenerate' });
    expect(actions(p.objectives)).toEqual({ ob1: 'keep', ob2: 'regenerate', ob3: 'keep' });
    expect(actions(p.modules)).toEqual({ m1: 'keep', m2: 'keep', m3: 'regenerate', m4: 'keep' });
  });
  it('una comprension compartida regenera en cascada todo lo que la toca', () => {
    const bp = base();
    bp.outcomes[0].statement = 'Explica la elasticidad cruzada';
    const p = planRegeneration(base(), bp);
    expect(actions(p.periodExams)).toEqual({ p1: 'regenerate', p2: 'regenerate' });
    expect(actions(p.objectives)).toEqual({ ob1: 'regenerate', ob2: 'keep', ob3: 'regenerate' });
    expect(actions(p.modules)).toEqual({ m1: 'regenerate', m2: 'regenerate', m3: 'keep', m4: 'regenerate' });
  });
  it('lo que un estudiante YA intento se VERSIONA, no se regenera en su lugar', () => {
    const bp = base();
    bp.outcomes[1].statement = 'Calcula el equilibrio con impuestos';
    const p = planRegeneration(base(), bp, { moduleIds: ['m3'], periodExamIds: ['p2'] });
    expect(actions(p.periodExams)).toEqual({ p1: 'keep', p2: 'version' });
    expect(actions(p.objectives)).toEqual({ ob1: 'keep', ob2: 'version', ob3: 'keep' });
    expect(actions(p.modules)).toEqual({ m1: 'keep', m2: 'keep', m3: 'version', m4: 'keep' });
  });
  it('un intento en OTRO modulo del objetivo tambien versiona el objetivo, pero los modulos sin intentos se regeneran', () => {
    const raw = base();
    raw.periods[1].objectives[0].modules.push({ id: 'm5', title: 'Mas', order: 2 });
    const bp = JSON.parse(JSON.stringify(raw)) as Blueprint;
    bp.outcomes[1].statement = 'Calcula el equilibrio con impuestos';
    const p = planRegeneration(raw, bp, { moduleIds: ['m3'] });
    expect(actions(p.objectives).ob2).toBe('version');
    expect(actions(p.modules)).toMatchObject({ m3: 'version', m5: 'regenerate' });
  });
  it('quitar una comprension: se borra lo que nadie intento y se ARCHIVA lo que si', () => {
    const bp = base();
    bp.outcomes = [bp.outcomes[0]];
    bp.periods[1].assessesOutcomeIds = ['o1'];
    bp.periods[1].objectives = [bp.periods[1].objectives[1]]; // ob2 desaparece
    const sinIntentos = planRegeneration(base(), bp);
    expect(sinIntentos.outcomes).toEqual([{ id: 'o2', change: 'removed' }]);
    expect(actions(sinIntentos.objectives).ob2).toBe('delete');
    expect(actions(sinIntentos.modules).m3).toBe('delete');
    const conIntentos = planRegeneration(base(), bp, { moduleIds: ['m3'] });
    expect(actions(conIntentos.objectives).ob2).toBe('archive');
    expect(actions(conIntentos.modules).m3).toBe('archive');
  });
  it('agregar una comprension, un corte, un objetivo y un modulo: todo "create"', () => {
    const bp = base();
    bp.outcomes.push({ id: 'o3', statement: 'Nueva comprension' });
    bp.periods.push({ id: 'p3', name: 'Tercer', order: 3, weight: 10, assessesOutcomeIds: ['o3'], objectives: [{ id: 'ob4', title: 'N', outcomeIds: ['o3'], modules: [{ id: 'm6', title: 'M', order: 1 }] }] });
    bp.periods[0].objectives[0].modules.push({ id: 'm7', title: 'Extra', order: 3 });
    const p = planRegeneration(base(), bp);
    expect(p.outcomes).toEqual([{ id: 'o3', change: 'added' }]);
    expect(actions(p.periodExams).p3).toBe('create');
    expect(actions(p.objectives).ob4).toBe('create');
    expect(actions(p.modules)).toMatchObject({ m6: 'create', m7: 'create', m1: 'keep' });
  });
  it('quitar un corte: se borra, o se archiva si alguien tomo su evaluacion; sus objetivos y modulos igual', () => {
    const bp = base();
    bp.periods = [bp.periods[0]];
    bp.periods[0].weight = 100;
    bp.outcomes = [bp.outcomes[0]];
    const a = planRegeneration(base(), bp);
    expect(actions(a.periodExams)).toMatchObject({ p2: 'delete' });
    expect(actions(a.objectives)).toMatchObject({ ob2: 'delete', ob3: 'delete' });
    const b = planRegeneration(base(), bp, { periodExamIds: ['p2'], moduleIds: ['m4'] });
    expect(actions(b.periodExams).p2).toBe('archive');
    expect(actions(b.objectives)).toMatchObject({ ob2: 'delete', ob3: 'archive' });
    expect(actions(b.modules)).toMatchObject({ m3: 'delete', m4: 'archive' });
  });
  it('cambiar el CONJUNTO de comprensiones que evalua un corte regenera su evaluacion aunque los textos no cambien', () => {
    const bp = base();
    bp.periods[0].assessesOutcomeIds = ['o1', 'o2'];
    bp.periods[0].objectives[0].outcomeIds = ['o1'];
    const p = planRegeneration(base(), bp);
    expect(p.outcomes).toEqual([]);
    expect(actions(p.periodExams)).toEqual({ p1: 'regenerate', p2: 'keep' });
    expect(actions(p.objectives).ob1).toBe('keep');
  });
  it('una referencia colgante (un corte ya listaba una comprension que no existia) tambien reacciona al agregarla o quitarla', () => {
    const old = base();
    old.outcomes = [old.outcomes[0]]; // o2 no existe aun, pero p2 y ob2 ya la mencionan (borrador)
    const added = base(); // ahora o2 existe: lo que la menciona se rehace
    const a = planRegeneration(old, added);
    expect(a.outcomes).toEqual([{ id: 'o2', change: 'added' }]);
    expect(actions(a.periodExams)).toEqual({ p1: 'keep', p2: 'regenerate' });
    expect(actions(a.objectives)).toEqual({ ob1: 'keep', ob2: 'regenerate', ob3: 'keep' });
    const removed = planRegeneration(base(), old); // al reves: se quita o2 y p2 y ob2 siguen mencionandola
    expect(removed.outcomes).toEqual([{ id: 'o2', change: 'removed' }]);
    expect(actions(removed.periodExams)).toEqual({ p1: 'keep', p2: 'regenerate' });
    expect(actions(removed.objectives)).toEqual({ ob1: 'keep', ob2: 'regenerate', ob3: 'keep' });
  });
  it('el orden de las listas de ids no cuenta como cambio', () => {
    const bp = base();
    bp.periods[1].assessesOutcomeIds = ['o2', 'o1'];
    expect(planRegeneration(base(), bp).summary.keep).toBe(9);
  });
  it('cambiar a que comprensiones apunta un objetivo lo regenera (y a sus modulos)', () => {
    const bp = base();
    bp.periods[1].objectives[1].outcomeIds = ['o2'];
    const p = planRegeneration(base(), bp);
    expect(actions(p.objectives)).toEqual({ ob1: 'keep', ob2: 'keep', ob3: 'regenerate' });
    expect(actions(p.modules).m4).toBe('regenerate');
  });
  it('un modulo que cambia de objetivo se rehace (o se versiona si tiene intentos)', () => {
    const bp = base();
    const m = bp.periods[0].objectives[0].modules.pop()!; // m2 pasa de ob1 a ob3
    bp.periods[1].objectives[1].modules.push({ ...m, order: 2 });
    expect(actions(planRegeneration(base(), bp).modules).m2).toBe('regenerate');
    expect(actions(planRegeneration(base(), bp, { moduleIds: ['m2'] }).modules).m2).toBe('version');
  });
  it('mueve el resumen: cuenta cada accion', () => {
    const bp = base();
    bp.outcomes[1].statement = 'Otra cosa';
    const p = planRegeneration(base(), bp, { moduleIds: ['m3'] });
    expect(p.summary).toEqual({ keep: 6, regenerate: 1, version: 2, create: 0, delete: 0, archive: 0 });
  });
  it('PROPIEDAD: con cambios y intentos aleatorios, jamas se borra ni se regenera en su lugar algo que alguien ya intento, y el plan cubre todos los ids', () => {
    let seed = 2026;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000); // [0, 1): nunca da un indice fuera de rango
    const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
    for (let i = 0; i < 400; i++) {
      const next: Blueprint = JSON.parse(JSON.stringify(base()));
      const ops = Math.floor(rnd() * 5);
      for (let k = 0; k < ops; k++) {
        const op = Math.floor(rnd() * 6);
        if (op === 0) pick(next.outcomes).statement += ' editada' + k;
        else if (op === 1 && next.periods[1] && next.periods[1].objectives.length > 0) next.periods[1].objectives.splice(Math.floor(rnd() * next.periods[1].objectives.length), 1);
        else if (op === 2) pick(next.periods).objectives[0]?.modules.pop();
        else if (op === 3) pick(next.periods).objectives[0]?.modules.push({ id: 'n' + i + k, title: 'N', order: 9 + k });
        else if (op === 4) {
          const objs = pick(next.periods).objectives;
          if (objs.length > 0) pick(objs).outcomeIds = [pick(next.outcomes).id];
        }
        else if (op === 5 && next.periods.length > 1) next.periods.pop();
      }
      const allModules = ['m1', 'm2', 'm3', 'm4'];
      const moduleIds = allModules.filter(() => rnd() < 0.5);
      const periodExamIds = ['p1', 'p2'].filter(() => rnd() < 0.5);
      const plan = planRegeneration(base(), next, { moduleIds, periodExamIds });
      const attemptedM = new Set(moduleIds);
      const attemptedP = new Set(periodExamIds);
      for (const m of plan.modules) if (attemptedM.has(m.id)) expect(['keep', 'version', 'archive'], `modulo ${m.id}`).toContain(m.action);
      for (const e of plan.periodExams) if (attemptedP.has(e.id)) expect(['keep', 'version', 'archive'], `corte ${e.id}`).toContain(e.action);
      for (const o of plan.objectives) {
        const mods = [...base().periods, ...next.periods].flatMap((p) => p.objectives).filter((x) => x.id === o.id).flatMap((x) => x.modules);
        if (mods.some((m) => attemptedM.has(m.id))) expect(['keep', 'version', 'archive'], `objetivo ${o.id}`).toContain(o.action);
      }
      // cada id aparece una sola vez, y el plan cubre todo lo del plan nuevo y lo del viejo
      const ids = (l: { id: string }[]) => l.map((n) => n.id);
      for (const l of [plan.periodExams, plan.objectives, plan.modules]) expect(new Set(ids(l)).size).toBe(l.length);
      const newMods = next.periods.flatMap((p) => p.objectives).flatMap((o) => o.modules.map((m) => m.id));
      const oldMods = base().periods.flatMap((p) => p.objectives).flatMap((o) => o.modules.map((m) => m.id));
      expect(new Set(ids(plan.modules))).toEqual(new Set([...newMods, ...oldMods]));
      expect(plan.summary.keep + plan.summary.regenerate + plan.summary.version + plan.summary.create + plan.summary.delete + plan.summary.archive).toBe(plan.periodExams.length + plan.objectives.length + plan.modules.length);
    }
  });
});

// ───────────────────────────────────────────── progreso y notas
const att = (o: Record<string, number[]>) => new Map(Object.entries(o));

describe('moduleScore: la nota de un modulo es el PROMEDIO de todos sus intentos', () => {
  it('el ejemplo del dueño: 80, 90, 100 -> 90', () => {
    expect(moduleScore([80, 90, 100])).toBe(90);
  });
  it('un intento, ninguno y redondeo a 2 decimales', () => {
    expect(moduleScore([73])).toBe(73);
    expect(moduleScore([])).toBeNull();
    expect(moduleScore(undefined)).toBeNull();
    expect(moduleScore([100, 100, 0])).toBe(66.67);
    expect(moduleScore([0, 0])).toBe(0);
  });
  it('un dato invalido (NaN, negativo, mayor que 100, texto) se ignora y no mueve la nota', () => {
    expect(moduleScore([80, NaN, -5, 101, '90' as any, null as any, 100])).toBe(90);
    expect(moduleScore([NaN, -1])).toBeNull();
  });
  it('0 y 100 son validos', () => {
    expect(moduleScore([0, 100])).toBe(50);
  });
});

describe('hasMastered: 100 % en UN intento', () => {
  it('con un 100 sale; 99.99 no; el promedio no cuenta', () => {
    expect(hasMastered([80, 90, 100])).toBe(true);
    expect(hasMastered([100])).toBe(true);
    expect(hasMastered([99.99, 90])).toBe(false);
    expect(hasMastered([90, 95])).toBe(false);
    expect(hasMastered([])).toBe(false);
    expect(hasMastered(undefined)).toBe(false);
    expect(hasMastered([NaN, 101 as number])).toBe(false); // 101 es invalido: no cuenta como dominio
  });
});

describe('flattenModules', () => {
  it('recorre cortes por orden, objetivos como estan y modulos por orden, sin importar el orden del arreglo', () => {
    const bp = base();
    bp.periods.reverse();
    bp.periods[1].objectives[0].modules.reverse();
    expect(flattenModules(bp).map((m) => m.moduleId)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(flattenModules(bp)[2]).toEqual({ moduleId: 'm3', objectiveId: 'ob2', periodId: 'p2' });
  });
});

describe('courseProgress: modulos -> evaluacion del corte -> siguiente corte -> evaluacion final', () => {
  const run = (modules: Record<string, number[]> = {}, exams: Record<string, number[]> = {}, final?: number[], bp: Blueprint = base()) =>
    courseProgress(bp, { modules: att(modules), exams: att(exams), final });
  const list = (s: Set<string>) => [...s];

  it('al empezar solo esta disponible el primer modulo; la evaluacion final esta bloqueada', () => {
    const p = run();
    expect(list(p.availableModules)).toEqual(['m1']);
    expect(p.next).toEqual({ type: 'module', moduleId: 'm1', periodId: 'p1' });
    expect(p.masteredModules.size).toBe(0);
    expect(p.availableExams.size).toBe(0);
    expect(p.finalExam).toBe('locked');
  });
  it('no se pasa de modulo sin 100 %: 80 y 90 no desbloquean; el 100 si', () => {
    expect(list(run({ m1: [80, 90] }).availableModules)).toEqual(['m1']);
    expect(run({ m1: [80, 90] }).next).toMatchObject({ type: 'module', moduleId: 'm1' });
    const p = run({ m1: [80, 90, 100] });
    expect(list(p.availableModules)).toEqual(['m1', 'm2']);
    expect(p.next).toMatchObject({ moduleId: 'm2' });
    expect(list(p.masteredModules)).toEqual(['m1']);
  });
  it('dominar uno de mas adelante no salta los que faltan', () => {
    const p = run({ m2: [100], m3: [100] });
    expect(list(p.availableModules)).toEqual(['m1']);
    expect(p.next).toMatchObject({ moduleId: 'm1' });
  });
  it('al dominar todos los modulos del corte se desbloquea SU evaluacion (y todavia no el siguiente corte)', () => {
    const p = run({ m1: [100], m2: [100] });
    expect(list(p.availableModules)).toEqual(['m1', 'm2']); // m3 (del corte 2) sigue bloqueado
    expect(list(p.availableExams)).toEqual(['p1']);
    expect(p.next).toEqual({ type: 'periodExam', periodId: 'p1' });
    expect(p.finalExam).toBe('locked');
  });
  it('la evaluacion del corte sin dominar (60, 80) sigue bloqueando el siguiente corte; es repetible', () => {
    const p = run({ m1: [100], m2: [100] }, { p1: [60, 80] });
    expect(list(p.availableModules)).toEqual(['m1', 'm2']);
    expect(p.next).toEqual({ type: 'periodExam', periodId: 'p1' });
    expect(canRetakeExam([60, 80])).toBe(true);
  });
  it('con la evaluacion del corte al 100 % se abre el siguiente corte', () => {
    const p = run({ m1: [100], m2: [100] }, { p1: [60, 100] });
    expect(list(p.masteredExams)).toEqual(['p1']);
    expect(list(p.availableExams)).toEqual([]);
    expect(list(p.availableModules)).toEqual(['m1', 'm2', 'm3']);
    expect(p.next).toEqual({ type: 'module', moduleId: 'm3', periodId: 'p2' });
  });
  it('dominar una evaluacion SIN los modulos de su corte no desbloquea nada', () => {
    const p = run({ m1: [100] }, { p1: [100] });
    expect(list(p.availableModules)).toEqual(['m1', 'm2']);
    expect(p.masteredExams.size).toBe(0);
    expect(p.next).toMatchObject({ moduleId: 'm2' });
  });
  it('la evaluacion final se desbloquea al terminar TODOS los cortes (modulos y evaluacion de cada uno)', () => {
    const casi = run({ m1: [100], m2: [100], m3: [100], m4: [100] }, { p1: [100] });
    expect(casi.finalExam).toBe('locked'); // falta la evaluacion del corte 2
    expect(casi.next).toEqual({ type: 'periodExam', periodId: 'p2' });
    const todo = run({ m1: [100], m2: [100], m3: [100], m4: [100] }, { p1: [100], p2: [70, 100] });
    expect(todo.finalExam).toBe('available');
    expect(todo.next).toEqual({ type: 'finalExam' });
    expect(list(todo.masteredExams)).toEqual(['p1', 'p2']);
  });
  it('la evaluacion final dominada cierra el curso; sin dominar (intentos ilimitados) sigue disponible', () => {
    const modules = { m1: [100], m2: [100], m3: [100], m4: [100] };
    const exams = { p1: [100], p2: [100] };
    expect(run(modules, exams, [60, 80]).finalExam).toBe('available');
    expect(run(modules, exams, [60, 80]).next).toEqual({ type: 'finalExam' });
    const fin = run(modules, exams, [60, 80, 100]);
    expect(fin.finalExam).toBe('mastered');
    expect(fin.next).toEqual({ type: 'done' });
  });
  it('una final con intentos pero con cortes sin terminar sigue bloqueada', () => {
    expect(run({ m1: [100] }, {}, [100]).finalExam).toBe('locked');
  });
  it('no hay tope de intentos: 50 intentos fallidos no bloquean para siempre', () => {
    const muchos = Array.from({ length: 50 }, () => 10);
    const p = run({ m1: muchos });
    expect(p.next).toMatchObject({ moduleId: 'm1' });
    expect(canRetakeExam(muchos)).toBe(true);
    expect(run({ m1: [...muchos, 100] }).next).toMatchObject({ moduleId: 'm2' });
  });
  it('los cortes se recorren por su orden, no por su posicion en la lista', () => {
    const bp = base();
    bp.periods.reverse();
    const p = run({ m1: [100], m2: [100] }, { p1: [100] }, undefined, bp);
    expect(p.next).toMatchObject({ type: 'module', moduleId: 'm3' });
    // sin ningun intento, lo primero es el modulo del PRIMER corte aunque este al final de la lista
    expect(run({}, {}, undefined, bp).next).toMatchObject({ type: 'module', moduleId: 'm1', periodId: 'p1' });
  });
  it('un corte sin modulos pasa directo a su evaluacion', () => {
    const bp = base();
    bp.periods[0].objectives = [];
    const p = run({}, {}, undefined, bp);
    expect(p.next).toEqual({ type: 'periodExam', periodId: 'p1' });
  });
  it('un plan sin cortes deja la evaluacion final disponible', () => {
    const p = run({}, {}, undefined, { version: 1, outcomes: [], periods: [] });
    expect(p.finalExam).toBe('available');
  });
  it('un id "__proto__" funciona con Map', () => {
    const bp = base();
    bp.periods[0].objectives[0].modules[0].id = '__proto__';
    const p = courseProgress(bp, { modules: new Map([['__proto__', [100]]]) });
    expect(p.next).toMatchObject({ moduleId: 'm2' });
  });
  it('PROPIEDAD: lo disponible es siempre un prefijo del recorrido y "next" apunta a lo primero sin dominar', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
    const att10 = () => (rnd() < 0.5 ? [] : rnd() < 0.5 ? [100] : [Math.round(rnd() * 99)]);
    for (let i = 0; i < 400; i++) {
      const modules = Object.fromEntries(['m1', 'm2', 'm3', 'm4'].map((id) => [id, att10()]));
      const exams = Object.fromEntries(['p1', 'p2'].map((id) => [id, att10()]));
      const final = att10();
      const p = run(modules, exams, final);
      // lo dominado es lo dominado, y un modulo disponible lo es solo si todos los anteriores estan dominados
      const order = ['m1', 'm2', 'm3', 'm4'];
      for (const [k, id] of order.entries()) {
        if (p.availableModules.has(id)) for (const prev of order.slice(0, k)) expect(p.masteredModules.has(prev), `${id} disponible sin ${prev}`).toBe(true);
      }
      // la evaluacion de un corte solo esta disponible o dominada con todos los modulos de ese corte dominados
      if (p.availableExams.has('p1') || p.masteredExams.has('p1')) expect(['m1', 'm2'].every((m) => p.masteredModules.has(m))).toBe(true);
      if (p.availableExams.has('p2') || p.masteredExams.has('p2')) {
        expect(['m3', 'm4'].every((m) => p.masteredModules.has(m))).toBe(true);
        expect(p.masteredExams.has('p1')).toBe(true);
      }
      // la final solo se abre con todo dominado
      if (p.finalExam !== 'locked') expect(p.masteredExams.size).toBe(2);
      // exactamente una cosa pendiente a la vez
      expect(p.availableExams.size).toBeLessThanOrEqual(1);
      if (p.next.type === 'module') expect(p.availableExams.size).toBe(0);
    }
  });
});

describe('evaluaciones: se repiten y su nota es el promedio de los intentos hasta llegar al 100 %', () => {
  it('el ejemplo del dueño: 60, 80, 100 -> 80', () => {
    expect(examScore([60, 80, 100])).toBe(80);
    expect(examScore([])).toBeNull();
    expect(examScore(undefined)).toBeNull();
  });
  it('se puede repetir hasta llegar al 100 %; con un 100 ya no', () => {
    expect(canRetakeExam(undefined)).toBe(true);
    expect(canRetakeExam([])).toBe(true);
    expect(canRetakeExam([60, 99.99])).toBe(true);
    expect(canRetakeExam([100])).toBe(false);
    expect(canRetakeExam([60, 100])).toBe(false);
    expect(examMastered([60, 100])).toBe(true);
    expect(examMastered([99])).toBe(false);
  });
});

describe('periodResult: 70 % modulos + 30 % evaluacion, computada a medida que se califica', () => {
  it('las constantes son las del dueño y suman 100', () => {
    expect(PERIOD_MODULES_POINTS).toBe(70);
    expect(PERIOD_EXAM_POINTS).toBe(30);
    expect(PERIOD_MODULES_POINTS + PERIOD_EXAM_POINTS).toBe(100);
  });
  it('todo al 100 -> 100 puntos, con nota y sin nada por hacer', () => {
    const r = periodResult({ modules: [[100], [100], [100], [100]], exam: [100] });
    expect(r).toMatchObject({ points: 100, gradedShare: 100, score: 100, graded: true, closed: true, modulesAverage: 100, modulesDone: 4, modulesMastered: 4, modulesTotal: 4, exam: 100, examAttempts: 1 });
  });
  it('ejemplo: modulos 80, 90, 100 (promedio 90) y evaluacion 50 -> 63 + 15 = 78; tiene nota pero no esta cerrado', () => {
    const r = periodResult({ modules: [[80], [90], [100]], exam: [50] });
    expect(r.points).toBe(78);
    expect(r.score).toBe(78);
    expect(r.modulesAverage).toBe(90);
    expect(r.exam).toBe(50);
    expect(r.graded).toBe(true);
    expect(r.closed).toBe(false);
    expect(r.modulesMastered).toBe(1);
  });
  it('la nota de un modulo es el promedio de sus intentos (80, 90, 100 -> 90)', () => {
    const r = periodResult({ modules: [[80, 90, 100]] });
    expect(r.modulesAverage).toBe(90);
    expect(r.modulesMastered).toBe(1);
    expect(r.points).toBe(63);
  });
  it('la nota de la evaluacion es el promedio de sus intentos (50 y 100 -> 75)', () => {
    const r = periodResult({ modules: [[100]], exam: [50, 100] });
    expect(r.exam).toBe(75);
    expect(r.examAttempts).toBe(2);
    expect(r.points).toBe(92.5); // 70 + 30 * 75 / 100
    expect(r.closed).toBe(true); // un intento llego a 100
  });
  it('el reparto es 70/30: modulos perfectos y evaluacion en 0 -> 70; al reves -> 30', () => {
    expect(periodResult({ modules: [[100], [100]], exam: [0] }).points).toBe(70);
    expect(periodResult({ modules: [[0], [0]], exam: [100] }).points).toBe(30);
  });
  it('la nota de los modulos y la de la evaluacion son APARTE: una no mueve a la otra', () => {
    const a = periodResult({ modules: [[80], [100]], exam: [10] });
    const b = periodResult({ modules: [[80], [100]], exam: [90] });
    expect(a.modulesAverage).toBe(90);
    expect(b.modulesAverage).toBe(90);
    expect(a.exam).toBe(10);
    expect(b.exam).toBe(90);
    expect(b.points - a.points).toBe(24); // 30 * (90 - 10) / 100
  });
  it('progresivo: 2 de 4 modulos al 100 y sin evaluacion -> 35 puntos de 35 calificados (nota 100), sin nota completa', () => {
    const r = periodResult({ modules: [[100], [100], [], []] });
    expect(r).toMatchObject({ points: 35, gradedShare: 35, score: 100, graded: false, closed: false, modulesDone: 2 });
    expect(r.exam).toBeNull();
  });
  it('lo que falta no hunde la nota', () => {
    expect(periodResult({ modules: [[100], [], [], []] }).score).toBe(100);
    expect(periodResult({ modules: [[50], []] })).toMatchObject({ points: 17.5, gradedShare: 35, score: 50 });
  });
  it('solo la evaluacion: 80 -> 24 puntos de 30 (nota 80), modulos sin promedio', () => {
    const r = periodResult({ modules: [[], [], []], exam: [80] });
    expect(r).toMatchObject({ points: 24, gradedShare: 30, score: 80, modulesAverage: null, graded: false, closed: false });
  });
  it('sin nada calificado: 0 puntos y sin nota', () => {
    const r = periodResult({ modules: [[], [], []] });
    expect(r).toMatchObject({ points: 0, gradedShare: 0, score: null, modulesAverage: null, graded: false, closed: false, exam: null, examAttempts: 0 });
  });
  it('un 0 real SI cuenta (distinto de "sin calificar")', () => {
    const r = periodResult({ modules: [[0]], exam: [0] });
    expect(r).toMatchObject({ points: 0, gradedShare: 100, score: 0, graded: true, closed: false, exam: 0 });
  });
  it('puntajes invalidos se ignoran: modulos y evaluacion', () => {
    expect(periodResult({ modules: [[100, NaN, -1, 101]] })).toMatchObject({ modulesAverage: 100, modulesDone: 1 });
    expect(periodResult({ modules: [[NaN, 101]] })).toMatchObject({ modulesDone: 0, points: 0 });
    const r = periodResult({ modules: [[100]], exam: [NaN, 101, -5, '90' as any, Infinity] });
    expect(r.exam).toBeNull();
    expect(r.examAttempts).toBe(0);
    expect(r.graded).toBe(false);
    expect(r.points).toBe(70);
  });
  it('un modulo sin entrada (undefined) cuenta como modulo sin intentos', () => {
    const r = periodResult({ modules: [undefined, [100]] });
    expect(r).toMatchObject({ modulesTotal: 2, modulesDone: 1, points: 35 });
  });
  it('un corte sin modulos: sin parte de modulos y nunca con nota completa ni cerrado', () => {
    const r = periodResult({ modules: [], exam: [100] });
    expect(r).toMatchObject({ modulesTotal: 0, modulesDone: 0, points: 30, gradedShare: 30, graded: false, closed: false });
  });
  it('"cerrado" exige TODOS los modulos y la evaluacion con un intento al 100 %', () => {
    expect(periodResult({ modules: [[100], [100]], exam: [90] })).toMatchObject({ graded: true, closed: false });
    expect(periodResult({ modules: [[100], [100]], exam: [90, 100] }).closed).toBe(true);
    const parcial = periodResult({ modules: [[100], [80]], exam: [100] });
    expect(parcial.closed).toBe(false);
    expect(parcial.modulesMastered).toBe(1);
    expect(periodResult({ modules: [[100], [100]] }).closed).toBe(false); // sin evaluacion
  });
  it('redondea a 2 decimales', () => {
    // 70 * 100 / 100 / 3 = 23.3333 + 30 * 77 / 100 = 23.1 -> 46.43
    expect(periodResult({ modules: [[33], [33], [34]], exam: [77] }).points).toBe(46.43);
  });
  it('PROPIEDAD: los puntos nunca pasan de lo calificado ni de 100, y cerrado implica con nota', () => {
    let seed = 5;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
    const attemptsOf = () => Array.from({ length: Math.floor(rnd() * 4) }, () => (rnd() < 0.3 ? 100 : Math.round(rnd() * 100)));
    for (let i = 0; i < 500; i++) {
      const total = 1 + Math.floor(rnd() * 6);
      const modules = Array.from({ length: total }, () => attemptsOf());
      const exam = rnd() < 0.6 ? attemptsOf() : undefined;
      const r = periodResult({ modules, exam });
      expect(r.points).toBeLessThanOrEqual(r.gradedShare + 1e-9);
      expect(r.gradedShare).toBeLessThanOrEqual(100);
      expect(r.points).toBeGreaterThanOrEqual(0);
      if (r.score !== null) expect(r.score).toBeLessThanOrEqual(100);
      if (r.closed) expect(r.graded).toBe(true);
      expect(r.modulesMastered).toBeLessThanOrEqual(r.modulesDone);
      expect(r.graded).toBe(r.modulesDone === total && r.exam !== null);
    }
  });
});

describe('periodResultOf: desde el plan y los intentos', () => {
  it('promedia los intentos de cada modulo y de la evaluacion; un modulo sin intentos cuenta como "falta"', () => {
    const bp = base();
    const abierto = periodResultOf(bp.periods[0], att({ m1: [80, 100], m2: [100] }), [60]);
    // modulos: (90 + 100) / 2 = 95 -> 66.5; evaluacion 60 -> 18
    expect(abierto.modulesAverage).toBe(95);
    expect(abierto.points).toBe(84.5);
    expect(abierto).toMatchObject({ graded: true, closed: false });
    const cerrado = periodResultOf(bp.periods[0], att({ m1: [80, 100], m2: [100] }), [60, 100]); // evaluacion = 80
    expect(cerrado.exam).toBe(80);
    expect(cerrado.points).toBe(90.5);
    expect(cerrado.closed).toBe(true);
    const parcial = periodResultOf(bp.periods[0], att({ m1: [100] }));
    expect(parcial).toMatchObject({ modulesDone: 1, modulesTotal: 2, points: 35, gradedShare: 35, score: 100, graded: false });
  });
  it('cuenta los modulos de TODOS los objetivos del corte', () => {
    const bp = base();
    const r = periodResultOf(bp.periods[1], att({ m3: [100], m4: [50] }), [100]);
    expect(r.modulesTotal).toBe(2);
    expect(r.modulesAverage).toBe(75);
    expect(r.points).toBe(52.5 + 30);
  });
  it('un corte sin modulos no tiene parte de modulos', () => {
    const bp = base();
    bp.periods[0].objectives = [];
    expect(periodResultOf(bp.periods[0], att({}), [100])).toMatchObject({ modulesTotal: 0, points: 30, graded: false });
  });
});

describe('evaluacion final: nota propia, vale medio corte', () => {
  it('sin intentos: sin nota, sin puntos, se puede tomar', () => {
    expect(finalExamResult(undefined)).toEqual({ score: null, attempts: 0, points: 0, gradedShare: 0, closed: false, canRetake: true });
    expect(finalExamResult([NaN, 101])).toMatchObject({ score: null, attempts: 0 });
  });
  it('su nota es el promedio de sus intentos hasta llegar al 100 %', () => {
    expect(finalExamResult([60, 80])).toEqual({ score: 70, attempts: 2, points: 70, gradedShare: 100, closed: false, canRetake: true });
    expect(finalExamResult([80, 90, 100])).toEqual({ score: 90, attempts: 3, points: 90, gradedShare: 100, closed: true, canRetake: false });
  });
  it('un 0 real es una nota (tiene nota 0, no "sin calificar")', () => {
    expect(finalExamResult([0])).toMatchObject({ score: 0, gradedShare: 100 });
  });
  it('la constante es 1/2', () => {
    expect(FINAL_EXAM_FACTOR).toBe(0.5);
  });
  it('su peso es la MITAD del peso promedio de un corte', () => {
    expect(finalExamWeight([{ weight: 40 }, { weight: 60 }])).toBe(25);
    expect(finalExamWeight([{ weight: 100 }])).toBe(50);
    expect(finalExamWeight([{ weight: 33.33 }, { weight: 33.33 }, { weight: 33.33 }])).toBeCloseTo(16.665, 6);
  });
  it('ignora pesos que no cuentan y sin cortes pesa 0', () => {
    expect(finalExamWeight([{ weight: 100 }, { weight: 0 }, { weight: -5 }, { weight: NaN }])).toBe(50);
    expect(finalExamWeight([])).toBe(0);
    expect(finalExamWeight([{ weight: 0 }])).toBe(0);
  });
});

describe('courseGrade: cortes + evaluacion final (medio corte), computada a medida que se califica', () => {
  const periods = [{ id: 'p1', weight: 40 }, { id: 'p2', weight: 60 }]; // la final pesa 25 -> peso total 125
  const res = (o: Record<string, { points: number; gradedShare: number }>) => new Map(Object.entries(o));
  const full = (points: number) => ({ points, gradedShare: 100 });

  it('cortes con 100 y 50 puntos y final con 100 -> (40 + 30 + 25) / 125 = 76', () => {
    const g = courseGrade(periods, res({ p1: full(100), p2: full(50) }), full(100));
    expect(g).toEqual({ earned: 76, completedWeight: 100, average: 76, graded: true });
  });
  it('con 3 cortes iguales la final es 1/3,5 del curso: cortes en 100 y final en 0 -> 85,71; cortes en 0 y final en 100 -> 14,29', () => {
    const tres = [{ id: 'a', weight: 34 }, { id: 'b', weight: 33 }, { id: 'c', weight: 33 }];
    const todos = (pts: number) => res({ a: full(pts), b: full(pts), c: full(pts) });
    expect(courseGrade(tres, todos(100), full(0)).earned).toBe(85.71);
    expect(courseGrade(tres, todos(0), full(100)).earned).toBe(14.29);
    expect(courseGrade(tres, todos(100), full(100)).earned).toBe(100);
    expect(courseGrade(tres, todos(0), full(0)).earned).toBe(0);
  });
  it('la evaluacion final todavia no tomada: cuenta en el peso total pero no en lo calificado', () => {
    const g = courseGrade(periods, res({ p1: full(100), p2: full(50) }));
    // ganados 70 de un total de 125; calificado 100 de 125
    expect(g).toEqual({ earned: 56, completedWeight: 80, average: 70, graded: false });
    const conFinalEnCero = courseGrade(periods, res({ p1: full(100), p2: full(50) }), full(0));
    expect(conFinalEnCero).toEqual({ earned: 56, completedWeight: 100, average: 56, graded: true });
    expect(courseGrade(periods, res({ p1: full(100), p2: full(50) }), null).graded).toBe(false);
  });
  it('progresivo: un corte completo (90) y otro a medias (17.5 de 35 calificados), sin final', () => {
    const g = courseGrade(periods, res({ p1: full(90), p2: { points: 17.5, gradedShare: 35 } }));
    // ganados 36 + 10.5 = 46.5; calificado 40 + 21 = 61; total 125
    expect(g).toEqual({ earned: 37.2, completedWeight: 48.8, average: 76.23, graded: false });
  });
  it('sin ninguna nota', () => {
    expect(courseGrade(periods, new Map())).toEqual({ earned: 0, completedWeight: 0, average: null, graded: false });
  });
  it('solo "tiene toda su nota" si TODOS los cortes y la final estan calificados al 100 %', () => {
    expect(courseGrade(periods, res({ p1: full(100), p2: { points: 60, gradedShare: 99.99 } }), full(100)).graded).toBe(false);
    expect(courseGrade(periods, res({ p1: full(100) }), full(100)).graded).toBe(false);
    expect(courseGrade(periods, res({ p1: full(100), p2: full(100) }), { points: 40, gradedShare: 99 }).graded).toBe(false);
  });
  it('un resultado imposible o un peso 0 se ignora', () => {
    const solo = (r: { points: number; gradedShare: number }) => courseGrade(periods, res({ p1: r }), null).completedWeight;
    expect(solo({ points: 50, gradedShare: 30 })).toBe(0); // mas puntos que lo calificado
    expect(solo({ points: 101, gradedShare: 100 })).toBe(0);
    expect(solo({ points: NaN, gradedShare: 100 })).toBe(0);
    expect(solo({ points: -1, gradedShare: 10 })).toBe(0);
    expect(solo({ points: 50, gradedShare: 150 })).toBe(0); // calificado por encima de 100
    // una final imposible tampoco cuenta
    expect(courseGrade(periods, res({}), { points: 90, gradedShare: 50 }).completedWeight).toBe(0);
    // peso 0: ese corte no suma ni cuenta en el promedio de la final
    const g = courseGrade([{ id: 'a', weight: 0 }, { id: 'b', weight: 100 }], res({ a: full(100), b: full(80) }), full(100));
    expect(g).toMatchObject({ earned: 86.67, completedWeight: 100, graded: false }); // (0 + 80 + 50) / 150
  });
  it('sin cortes no hay nota, aunque haya final', () => {
    expect(courseGrade([], new Map(), full(100))).toEqual({ earned: 0, completedWeight: 0, average: null, graded: false });
  });
  it('redondea a 2 decimales', () => {
    const g = courseGrade([{ id: 'a', weight: 33.33 }, { id: 'b', weight: 66.67 }], res({ a: full(77), b: full(91) }), full(50));
    // 33.33*77/100 + 66.67*91/100 + 25*50/100 = 98.8338 sobre 125 -> 79.07
    expect(g.earned).toBe(79.07);
    expect(g.average).toBe(79.07);
  });
  it('de punta a punta con el plan, los intentos y la evaluacion final', () => {
    const bp = base();
    const attempts = att({ m1: [100], m2: [80, 100], m3: [100], m4: [100] });
    const r1 = periodResultOf(bp.periods[0], attempts, [80]); // modulos 95 -> 66.5 + 24 = 90.5
    const r2 = periodResultOf(bp.periods[1], attempts, [100]); // 70 + 30 = 100
    const final = finalExamResult([60, 80, 100]); // promedio 80
    expect(r1.points).toBe(90.5);
    expect(r2.points).toBe(100);
    expect(final.score).toBe(80);
    const g = courseGrade(bp.periods, new Map([['p1', r1], ['p2', r2]]), final);
    // (40*90.5/100 + 60*100/100 + 25*80/100) / 125 = 116.2 / 125
    expect(g.earned).toBe(92.96);
    expect(g.graded).toBe(true);
  });
  it('el curso va subiendo a medida que se califica (monotono), de 0 a 100', () => {
    const bp = base();
    const ids = ['m1', 'm2', 'm3', 'm4'];
    const steps: { done: number; exam1: boolean; exam2: boolean; final: boolean }[] = [
      { done: 0, exam1: false, exam2: false, final: false },
      { done: 1, exam1: false, exam2: false, final: false },
      { done: 2, exam1: false, exam2: false, final: false },
      { done: 3, exam1: false, exam2: false, final: false },
      { done: 4, exam1: false, exam2: false, final: false },
      { done: 4, exam1: true, exam2: false, final: false },
      { done: 4, exam1: true, exam2: true, final: false },
      { done: 4, exam1: true, exam2: true, final: true },
    ];
    let last = -1;
    const seen: number[] = [];
    for (const st of steps) {
      const a = att(Object.fromEntries(ids.slice(0, st.done).map((id) => [id, [100]])));
      const results = new Map([
        ['p1', periodResultOf(bp.periods[0], a, st.exam1 ? [100] : undefined)],
        ['p2', periodResultOf(bp.periods[1], a, st.exam2 ? [100] : undefined)],
      ]);
      const g = courseGrade(bp.periods, results, st.final ? finalExamResult([100]) : null);
      expect(g.earned).toBeGreaterThanOrEqual(last);
      last = g.earned;
      seen.push(g.earned);
    }
    expect(seen[4]).toBe(56); // todos los modulos perfectos, sin evaluaciones: 70 de 125
    expect(seen[6]).toBe(80); // + las dos evaluaciones de corte: 100 de 125
    expect(last).toBe(100);
  });
});
