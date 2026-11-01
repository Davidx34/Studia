import { describe, expect, it } from 'vitest';
import { parseBlueprint, normalizeText } from './parse';
import { checkBlueprint, isPublishable } from './validate';
import { planRegeneration, type NodeAction } from './regenerate';
import { courseGrade, flattenModules, hasMastered, moduleScore, periodModuleAverage, unlockedModules } from './progress';
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

describe('flattenModules y unlockedModules: avance por dominio', () => {
  it('recorre cortes por orden, objetivos como estan y modulos por orden, sin importar el orden del arreglo', () => {
    const bp = base();
    bp.periods.reverse();
    bp.periods[1].objectives[0].modules.reverse();
    expect(flattenModules(bp).map((m) => m.moduleId)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(flattenModules(bp)[2]).toEqual({ moduleId: 'm3', objectiveId: 'ob2', periodId: 'p2' });
  });
  it('al empezar solo esta disponible el primero', () => {
    const u = unlockedModules(base(), att({}));
    expect([...u.available]).toEqual(['m1']);
    expect(u.next).toBe('m1');
    expect(u.mastered.size).toBe(0);
  });
  it('no se pasa de modulo sin 100 %: 80 y 90 no desbloquean; el 100 si', () => {
    expect(unlockedModules(base(), att({ m1: [80, 90] })).next).toBe('m1');
    expect([...unlockedModules(base(), att({ m1: [80, 90] })).available]).toEqual(['m1']);
    const u = unlockedModules(base(), att({ m1: [80, 90, 100] }));
    expect([...u.available]).toEqual(['m1', 'm2']);
    expect(u.next).toBe('m2');
    expect([...u.mastered]).toEqual(['m1']);
  });
  it('dominar uno de mas adelante no salta los que faltan', () => {
    const u = unlockedModules(base(), att({ m2: [100], m3: [100] }));
    expect([...u.available]).toEqual(['m1']);
    expect(u.next).toBe('m1');
  });
  it('cruza de un corte al siguiente', () => {
    const u = unlockedModules(base(), att({ m1: [100], m2: [100] }));
    expect(u.next).toBe('m3');
    expect([...u.available]).toEqual(['m1', 'm2', 'm3']);
  });
  it('al dominarlos todos, no queda ninguno por hacer y todos estan disponibles', () => {
    const u = unlockedModules(base(), att({ m1: [100], m2: [100], m3: [100], m4: [100] }));
    expect(u.next).toBeNull();
    expect([...u.available]).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(u.mastered.size).toBe(4);
  });
  it('un plan sin modulos no bloquea nada', () => {
    const u = unlockedModules({ version: 1, outcomes: [], periods: [] }, att({}));
    expect(u.next).toBeNull();
    expect(u.available.size).toBe(0);
  });
  it('un id "__proto__" funciona con Map', () => {
    const bp = base();
    bp.periods[0].objectives[0].modules[0].id = '__proto__';
    const u = unlockedModules(bp, new Map([['__proto__', [100]]]));
    expect(u.next).toBe('m2');
  });
});

describe('periodModuleAverage', () => {
  it('promedio de las notas de sus modulos; null si a alguno le falta algun intento', () => {
    const bp = base();
    expect(periodModuleAverage(bp.periods[0], att({ m1: [100], m2: [80, 100] }))).toBe(95);
    expect(periodModuleAverage(bp.periods[0], att({ m1: [100] }))).toBeNull();
    expect(periodModuleAverage(bp.periods[1], att({ m3: [60, 100], m4: [100] }))).toBe(90);
  });
  it('un corte sin modulos no tiene nota', () => {
    const bp = base();
    bp.periods[0].objectives = [];
    expect(periodModuleAverage(bp.periods[0], att({}))).toBeNull();
  });
});

describe('courseGrade: la suma ponderada de los cortes', () => {
  const periods = [{ id: 'p1', weight: 40 }, { id: 'p2', weight: 60 }];
  it('completo: 100 y 50 con pesos 40/60 -> 70', () => {
    const g = courseGrade(periods, new Map([['p1', 100], ['p2', 50]]));
    expect(g).toEqual({ earned: 70, completedWeight: 100, average: 70, complete: true });
  });
  it('parcial: solo el primero -> 40 puntos ganados de 40 posibles, promedio 100, no completo', () => {
    const g = courseGrade(periods, new Map([['p1', 100]]));
    expect(g).toEqual({ earned: 40, completedWeight: 40, average: 100, complete: false });
  });
  it('sin ninguna nota', () => {
    expect(courseGrade(periods, new Map())).toEqual({ earned: 0, completedWeight: 0, average: null, complete: false });
    expect(courseGrade(periods, new Map([['p1', null], ['p2', null]])).average).toBeNull();
  });
  it('una nota invalida cuenta como "sin nota", y un peso 0 no cuenta', () => {
    expect(courseGrade(periods, new Map([['p1', NaN], ['p2', 80]]))).toMatchObject({ earned: 48, completedWeight: 60, complete: false });
    expect(courseGrade(periods, new Map([['p1', 101], ['p2', -1]])).completedWeight).toBe(0);
    expect(courseGrade([{ id: 'p1', weight: 0 }, { id: 'p2', weight: 100 }], new Map([['p1', 100], ['p2', 80]]))).toMatchObject({ earned: 80, completedWeight: 100, complete: false });
  });
  it('sin cortes no esta completo', () => {
    expect(courseGrade([], new Map()).complete).toBe(false);
  });
  it('redondea a 2 decimales', () => {
    const g = courseGrade([{ id: 'a', weight: 33.33 }, { id: 'b', weight: 66.67 }], new Map([['a', 77], ['b', 91]]));
    expect(g.earned).toBe(86.33); // 33.33*77/100 + 66.67*91/100 = 86.3338
    expect(g.average).toBe(86.33);
  });
});
