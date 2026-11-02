import { describe, expect, it } from 'vitest';
import {
  addModule, addObjective, addOutcome, addPeriod, blankFields, emptyBlueprint, equalizeWeights, freshId, removeModule, removeObjective, removeOutcome, removePeriod,
  setModuleTitle, setObjectiveTitle, setOutcomeText, setPeriod, toggleAssessed, toggleObjectiveOutcome,
} from './edit';
import { checkBlueprint } from './validate';
import { parseBlueprint } from './parse';
import { BLUEPRINT_LIMITS as L, type Blueprint } from './types';

const base = (): Blueprint => ({
  version: 1,
  outcomes: [
    { id: 'o1', statement: 'Uno' },
    { id: 'o2', statement: 'Dos' },
  ],
  periods: [
    { id: 'p1', name: 'A', order: 1, weight: 40, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob1', title: 'T1', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'M1', order: 1 }, { id: 'm2', title: 'M2', order: 2 }] }] },
    { id: 'p2', name: 'B', order: 2, weight: 60, assessesOutcomeIds: ['o1', 'o2'], objectives: [{ id: 'ob2', title: 'T2', outcomeIds: ['o2'], modules: [{ id: 'm3', title: 'M3', order: 1 }] }] },
  ],
});
const frozen = (): Blueprint => JSON.parse(JSON.stringify(base()));

describe('edit: inmutabilidad', () => {
  it('ninguna operacion modifica el plan original', () => {
    const ops: ((b: Blueprint) => Blueprint)[] = [
      (b) => setOutcomeText(b, 'o1', 'X'), addOutcome, (b) => removeOutcome(b, 'o1'), (b) => setPeriod(b, 'p1', { name: 'N', weight: 5 }), addPeriod, (b) => removePeriod(b, 'p1'), equalizeWeights,
      (b) => toggleAssessed(b, 'p1', 'o1'), (b) => addObjective(b, 'p1'), (b) => setObjectiveTitle(b, 'ob1', 'Z'), (b) => removeObjective(b, 'ob1'), (b) => toggleObjectiveOutcome(b, 'ob2', 'o1'),
      (b) => addModule(b, 'ob1'), (b) => setModuleTitle(b, 'm1', 'Z'), (b) => removeModule(b, 'm1'),
    ];
    for (const op of ops) {
      const b = base();
      const before = JSON.stringify(b);
      op(b);
      expect(JSON.stringify(b)).toBe(before);
    }
  });
});

describe('edit: ids', () => {
  it('freshId toma el primer libre y no choca con ningun otro tipo de id', () => {
    const b = base();
    expect(freshId(b, 'o')).toBe('o3');
    expect(freshId(b, 'm')).toBe('m4');
    expect(freshId(b, 'ob')).toBe('ob3');
    expect(freshId(b, 'p')).toBe('p3');
    expect(freshId(removeOutcome(b, 'o1'), 'o')).toBe('o1'); // reutiliza el hueco
  });
  it('agregar y borrar y volver a agregar nunca repite un id', () => {
    let b = base();
    for (let i = 0; i < 5; i++) b = addModule(b, 'ob1');
    b = removeModule(b, 'm2');
    b = addModule(b, 'ob1');
    const ids = b.periods.flatMap((p) => p.objectives.flatMap((o) => o.modules.map((m) => m.id)));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('edit: comprensiones', () => {
  it('cambia el texto de UNA comprension', () => {
    const b = setOutcomeText(base(), 'o2', 'Nuevo');
    expect(b.outcomes.map((o) => o.statement)).toEqual(['Uno', 'Nuevo']);
  });
  it('agregar una comprension la deja vacia, con id nuevo, y respeta el tope', () => {
    const b = addOutcome(base());
    expect(b.outcomes[2]).toEqual({ id: 'o3', statement: '' });
    let many = base();
    for (let i = 0; i < 40; i++) many = addOutcome(many);
    expect(many.outcomes).toHaveLength(L.outcomes);
  });
  it('quitar una comprension la saca de los cortes Y de los objetivos', () => {
    const b = removeOutcome(base(), 'o1');
    expect(b.outcomes.map((o) => o.id)).toEqual(['o2']);
    expect(b.periods[0].assessesOutcomeIds).toEqual([]);
    expect(b.periods[0].objectives[0].outcomeIds).toEqual([]);
    expect(b.periods[1].assessesOutcomeIds).toEqual(['o2']);
    expect(JSON.stringify(b)).not.toContain('"o1"');
  });
});

describe('edit: cortes', () => {
  it('cambia nombre y peso sin tocar lo demas', () => {
    const b = setPeriod(base(), 'p1', { weight: 10 });
    expect(b.periods[0]).toMatchObject({ name: 'A', weight: 10 });
    expect(setPeriod(base(), 'p1', { name: 'Z' }).periods[0]).toMatchObject({ name: 'Z', weight: 40 });
    expect(b.periods[1].weight).toBe(60);
  });
  it('agregar un corte: vacio, ultimo, con id libre y respeta el tope de 12', () => {
    const b = addPeriod(base());
    expect(b.periods[2]).toMatchObject({ id: 'p3', name: 'Corte 3', order: 3, weight: 0, assessesOutcomeIds: [], objectives: [] });
    let many = base();
    for (let i = 0; i < 20; i++) many = addPeriod(many);
    expect(many.periods).toHaveLength(L.periods);
  });
  it('quitar un corte renumera el orden (sin huecos ni repetidos)', () => {
    const b = removePeriod(addPeriod(base()), 'p1');
    expect(b.periods.map((p) => [p.id, p.order])).toEqual([['p2', 1], ['p3', 2]]);
  });
  it('equalizeWeights suma exactamente 100 para cualquier cantidad de cortes', () => {
    let b = base();
    for (let n = 2; n <= L.periods; n++) {
      b = equalizeWeights(b);
      expect(Math.round(b.periods.reduce((s, p) => s + p.weight, 0) * 100)).toBe(10000);
      b = addPeriod(b);
    }
    expect(equalizeWeights({ ...base(), periods: [] }).periods).toEqual([]);
  });
  it('dejar de evaluar una comprension la saca de los objetivos de ESE corte (no deja un objetivo fuera del examen)', () => {
    const b = toggleAssessed(base(), 'p2', 'o2');
    expect(b.periods[1].assessesOutcomeIds).toEqual(['o1']);
    expect(b.periods[1].objectives[0].outcomeIds).toEqual([]);
    expect(checkBlueprint(b).some((i) => i.code === 'objectiveOutsideExam')).toBe(false);
  });
  it('empezar a evaluar una comprension no cambia los objetivos; y se puede deshacer', () => {
    const b = toggleAssessed(base(), 'p1', 'o2');
    expect(b.periods[0].assessesOutcomeIds).toEqual(['o1', 'o2']);
    expect(b.periods[0].objectives[0].outcomeIds).toEqual(['o1']);
    expect(toggleAssessed(b, 'p1', 'o2').periods[0].assessesOutcomeIds).toEqual(['o1']);
  });
  it('un corte inexistente no rompe nada', () => {
    expect(toggleAssessed(base(), 'nope', 'o1')).toEqual(base());
    expect(setPeriod(base(), 'nope', { name: 'x' })).toEqual(base());
  });
});

describe('edit: objetivos', () => {
  it('agregar un objetivo: vacio, en el corte pedido, id libre y con tope', () => {
    const b = addObjective(base(), 'p1');
    expect(b.periods[0].objectives[1]).toEqual({ id: 'ob3', title: '', outcomeIds: [], modules: [] });
    expect(b.periods[1].objectives).toHaveLength(1);
    let many = base();
    for (let i = 0; i < 30; i++) many = addObjective(many, 'p1');
    expect(many.periods[0].objectives).toHaveLength(L.objectivesPerPeriod);
    expect(addObjective(base(), 'nope')).toEqual(base());
  });
  it('cambiar el titulo y quitar un objetivo', () => {
    expect(setObjectiveTitle(base(), 'ob2', 'Otro').periods[1].objectives[0].title).toBe('Otro');
    expect(removeObjective(base(), 'ob1').periods[0].objectives).toEqual([]);
  });
  it('un objetivo solo puede apuntar a comprensiones que SU corte evalua', () => {
    expect(toggleObjectiveOutcome(base(), 'ob1', 'o2')).toEqual(base()); // el corte 1 no evalua o2
    const ok = toggleObjectiveOutcome(base(), 'ob2', 'o1'); // el corte 2 si evalua o1
    expect(ok.periods[1].objectives[0].outcomeIds).toEqual(['o2', 'o1']);
    expect(toggleObjectiveOutcome(ok, 'ob2', 'o1').periods[1].objectives[0].outcomeIds).toEqual(['o2']);
    expect(toggleObjectiveOutcome(base(), 'nope', 'o1')).toEqual(base());
  });
});

describe('edit: modulos', () => {
  it('agregar un modulo: vacio, ultimo, con orden y id libres, y con tope de 12', () => {
    const b = addModule(base(), 'ob1');
    expect(b.periods[0].objectives[0].modules[2]).toEqual({ id: 'm4', title: '', order: 3 });
    let many = base();
    for (let i = 0; i < 30; i++) many = addModule(many, 'ob1');
    expect(many.periods[0].objectives[0].modules).toHaveLength(L.modulesPerObjective);
    expect(addModule(base(), 'nope')).toEqual(base());
  });
  it('cambiar el titulo de UN modulo', () => {
    const b = setModuleTitle(base(), 'm2', 'Nuevo');
    expect(b.periods[0].objectives[0].modules.map((m) => m.title)).toEqual(['M1', 'Nuevo']);
    expect(b.periods[1].objectives[0].modules[0].title).toBe('M3');
  });
  it('quitar un modulo renumera el orden del objetivo', () => {
    const b = removeModule(base(), 'm1');
    expect(b.periods[0].objectives[0].modules).toEqual([{ id: 'm2', title: 'M2', order: 1 }]);
  });
});

describe('edit: el plan resultante sigue siendo un plan legible', () => {
  it('una secuencia de ediciones produce un documento que parseBlueprint acepta', () => {
    let b = base();
    b = addOutcome(b);
    b = setOutcomeText(b, 'o3', 'Tres');
    b = toggleAssessed(b, 'p1', 'o3');
    b = addObjective(b, 'p1');
    b = setObjectiveTitle(b, 'ob3', 'Nuevo objetivo');
    b = toggleObjectiveOutcome(b, 'ob3', 'o3');
    b = addModule(b, 'ob3');
    b = setModuleTitle(b, 'm4', 'Modulo nuevo');
    b = toggleObjectiveOutcome(b, 'ob2', 'o1'); // el corte 2 tambien evalua o1: que alguien la ensene
    b = equalizeWeights(b);
    const parsed = parseBlueprint(b);
    expect(parsed.ok).toBe(true);
    expect(checkBlueprint(b).filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('emptyBlueprint es legible pero NO publicable (le falta contenido)', () => {
    const b = emptyBlueprint();
    expect(b.periods[0].weight).toBe(100);
    expect(parseBlueprint({ ...b, outcomes: [{ id: 'o1', statement: 'x' }], periods: [{ ...b.periods[0], name: 'C' }] }).ok).toBe(true);
    expect(checkBlueprint(b).some((i) => i.severity === 'error')).toBe(true);
  });
});

describe('blankFields: textos que faltan, con el MISMO criterio que el servidor', () => {
  it('un plan completo no tiene textos vacios', () => {
    expect(blankFields(base())).toEqual([]);
  });
  it('senala cada texto vacio con un mensaje que dice cual es', () => {
    let b = base();
    b = setOutcomeText(b, 'o2', '   ');
    b = setPeriod(b, 'p2', { name: '' });
    b = setObjectiveTitle(b, 'ob1', '');
    b = setModuleTitle(b, 'm3', '  ');
    expect(blankFields(b)).toEqual([
      'La comprensión final 2 está vacía.',
      'El objetivo 1 del corte 1 está vacío.',
      'El corte 2 no tiene nombre.',
      'El módulo 1 del objetivo 1 (corte 2) está vacío.',
    ]);
  });
  it('lo que blankFields acepta, parseBlueprint tambien (y lo que rechaza, tambien)', () => {
    const ok = base();
    expect(blankFields(ok)).toEqual([]);
    expect(parseBlueprint(ok).ok).toBe(true);
    const bad = setModuleTitle(base(), 'm1', '​'.length ? '' : '');
    expect(blankFields(bad).length).toBe(1);
    expect(parseBlueprint(bad).ok).toBe(false);
  });
  it('un modulo recien agregado cuenta como vacio hasta que se escribe', () => {
    const b = addModule(base(), 'ob1');
    expect(blankFields(b)).toEqual(['El módulo 3 del objetivo 1 (corte 1) está vacío.']);
    expect(blankFields(setModuleTitle(b, 'm4', 'Listo'))).toEqual([]);
  });
});
