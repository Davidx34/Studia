import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DESIGN_LIMITS, buildDesignPrompt, buildRequirementsPrompt, designLab, memoryCatalog, parseDesign, parseRequirements, relevantConcepts, resolveEvidence } from './design';
import { REPAIR_ROUNDS, repairModel, trimRanges } from './repair';
import { validateModel } from './model';
import { MODEL_EXAMPLES } from './modelExamples';
import { assessCoverage } from '@/lib/memory/sufficiency';
import { readGraph } from '@/lib/memory/graphRead';
import { normalizeKey } from '@/lib/memory/text';
import type { Concept, Edge, Graph } from '@/lib/memory/types';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

const c = (name: string, over: Partial<Concept> = {}): Concept => ({
  key: normalizeKey(name), name, kind: 'concepto', definition: `Definición de ${name}.`, formula: '', unit: '', importance: 3, mentions: 1, sources: [{ materialId: 'm1', chunks: [0] }], ...over,
});
const e = (from: string, to: string, relation: Edge['relation'] = 'requiere'): Edge => ({ from: normalizeKey(from), to: normalizeKey(to), relation, weight: 1 });

// La memoria de una clase de microeconomia.
const graph: Graph = {
  concepts: [
    c('Restricción presupuestal', { kind: 'concepto', formula: 'p_x * x + p_y * y = M', importance: 5 }),
    c('Función de utilidad Cobb-Douglas', { kind: 'formula', formula: 'U(x,y) = x^a * y^(1-a)', importance: 5 }),
    c('Utilidad marginal', { importance: 4 }),
    c('Ingreso (M)', { kind: 'variable', importance: 3 }),
    c('Precios', { kind: 'variable', importance: 3 }),
    c('Equilibrio del consumidor', { importance: 4, sources: [{ materialId: 'm2', chunks: [3, 4] }] }),
    c('Curva de indiferencia', { definition: '', formula: '' }),
  ],
  edges: [e('Equilibrio del consumidor', 'Restricción presupuestal'), e('Restricción presupuestal', 'Ingreso (M)'), e('Restricción presupuestal', 'Precios'), e('Equilibrio del consumidor', 'Curva de indiferencia')],
};

const GOOD_REQ = JSON.stringify({ requisitos: [{ termino: 'restricción presupuestal', esencial: true, formula: true }, { termino: 'función de utilidad Cobb-Douglas', esencial: true, formula: true }, { termino: 'equilibrio del consumidor', esencial: false }] });
const example = (id: string) => MODEL_EXAMPLES.find((x) => x.id === id)!;
const design = (over: Record<string, unknown> = {}) => ({
  title: 'El consumidor y su presupuesto', objective: '¿Qué cantidad de X maximiza la utilidad con este presupuesto?', context: '', hypothesisPrompt: 'Antes de empezar: ¿cuánto de cada bien crees que conviene comprar y por qué?',
  independent: 'x', mode: 'controlado', minTrials: 5, questions: ['¿Con qué cantidad de X obtuviste la mayor utilidad? Apóyate en tu tabla.', '¿Qué pasó con Y al aumentar X?'], model: example('consumidor').raw, ...over,
});
const good = (over: Record<string, unknown> = {}) => JSON.stringify(design(over));
const rawModel = (over: Record<string, unknown> = {}) => ({ ...(example('consumidor').raw as Record<string, unknown>), ...over });

// ─────────────────────────── paso 1: requisitos ───────────────────────────
describe('requisitos', () => {
  it('el prompt trae los conceptos de la memoria (con sus nombres), lo pedido y las reglas', () => {
    const p = buildRequirementsPrompt('utilidad máxima del consumidor', graph);
    expect(p).toContain('utilidad máxima del consumidor');
    expect(p).toContain('- Restricción presupuestal [Concepto] (tiene fórmula)');
    expect(p).toContain('NOMBRE EXACTO');
    expect(p).toContain('NO lo des por sabido');
    expect(p).toContain('{"requisitos": null');
  });

  it('con memoria vacia lo dice; el catalogo se acota y va de lo mas importante a lo menos', () => {
    expect(buildRequirementsPrompt('algo de física', { concepts: [], edges: [] })).toContain('todavía no hay conceptos');
    const many: Graph = { concepts: Array.from({ length: 300 }, (_, i) => c(`concepto ${i} xq${i}`, { importance: (i % 5) + 1 })), edges: [] };
    const cat = memoryCatalog(many);
    expect(cat).toHaveLength(DESIGN_LIMITS.catalog);
    expect(cat[0].importance).toBe(5);
  });

  it('lee requisitos: limpia, quita repetidos, topa en 8 y marca lo esencial', () => {
    const r = parseRequirements(JSON.stringify({ requisitos: [{ termino: '<b>Utilidad</b>', esencial: true }, { termino: 'utilidad' }, { termino: 'Precios', esencial: false, formula: true }, 'x', null, ...Array.from({ length: 12 }, (_, i) => ({ termino: `tema ${i}` }))] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.requirements[0]).toEqual({ term: 'Utilidad', essential: true, needsFormula: false });
    expect(r.requirements[1]).toEqual({ term: 'Precios', essential: false, needsFormula: true });
    expect(r.requirements).toHaveLength(DESIGN_LIMITS.requirements);
  });

  it('"no se puede simular" es una respuesta valida; lo ilegible no', () => {
    const nf = parseRequirements('{"requisitos": null, "motivo": "Es un tema de redacción, no numérico."}');
    expect(!nf.ok && nf.reason).toBe('noFit');
    expect(!nf.ok && nf.message).toContain('redacción');
    for (const t of ['', 'hola', '{"requisitos": 5}', '{"requisitos": []}', '{"requisitos": [{"termino": ""}]}']) {
      const r = parseRequirements(t);
      expect(r.ok, t).toBe(false);
    }
  });
});

// ─────────────────────────── el flujo completo ───────────────────────────
describe('designLab', () => {
  const idea = 'Quiero que exploren cómo elige un consumidor cuánto comprar con su presupuesto';

  it('camino feliz: requisitos -> suficiente -> diseño valido, con evidencia de la memoria (2 llamadas)', async () => {
    const call = vi.fn().mockResolvedValueOnce(GOOD_REQ).mockResolvedValueOnce(good());
    const r = await designLab({ idea, graph }, call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.coverage.verdict).toBe('sufficient');
    expect(r.spec.template).toBe('modelo');
    expect(r.spec.model?.outputs.map((o) => o.id)).toEqual(['Y', 'U', 'TMS']);
    expect(r.evidence.map((x) => x.name)).toEqual(expect.arrayContaining(['Restricción presupuestal', 'Función de utilidad Cobb-Douglas']));
    // las citas del modelo son los nombres de la MEMORIA, no los que escribio la IA
    expect(r.spec.model?.basis).toEqual(r.evidence.map((x) => x.name));
    expect(r.evidence.find((x) => x.name === 'Restricción presupuestal')?.formula).toBe('p_x * x + p_y * y = M');
  });

  it('el prompt de diseño lleva los conceptos y formulas de la memoria, los ejemplos, los limites y las reglas de coherencia', async () => {
    const call = vi.fn().mockResolvedValueOnce(GOOD_REQ).mockResolvedValueOnce(good());
    await designLab({ idea, graph }, call);
    const p = call.mock.calls[1][0] as string;
    expect(p).toContain('Fórmula del material: p_x * x + p_y * y = M');
    expect(p).toContain('U(x,y) = x^a * y^(1-a)');
    expect(p).toContain('sqrt, cbrt'.split(',')[0]);
    expect(p).toContain('IMPONERLA');
    expect(p).toContain('NO pueden incluir valores donde una fórmula se indefine');
    expect(p).toContain('"cantY"'); // el ejemplo del consumidor
    expect(p).toContain('exp(-r*tiempo)'); // y el de poblacion
    expect(p).toContain('{"model": null');
    expect(p).not.toContain('PROBLEMAS');
  });

  it('INSUFICIENTE: si lo esencial no esta en los materiales no crea nada y no gasta la llamada de diseño', async () => {
    const req = JSON.stringify({ requisitos: [{ termino: 'multiplicadores de Lagrange', esencial: true, formula: true }, { termino: 'hessiano orlado', esencial: true }, { termino: 'restricción presupuestal', esencial: false }] });
    const call = vi.fn().mockResolvedValueOnce(req);
    const r = await designLab({ idea: 'optimización con multiplicadores de Lagrange para tres bienes', graph }, call);
    expect(call).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('insufficient');
    expect(r.message).toMatch(/no alcanzan/);
    expect(r.coverage?.missing.join(' ')).toContain('multiplicadores de Lagrange');
  });

  it('PARCIAL: lo esencial aparece pero flojo -> pregunta; con "force" sigue y deja un aviso', async () => {
    const req = JSON.stringify({ requisitos: [{ termino: 'curva de indiferencia', esencial: true }, { termino: 'restricción presupuestal', esencial: true }] });
    const a = await designLab({ idea, graph }, vi.fn().mockResolvedValueOnce(req));
    expect(!a.ok && a.reason).toBe('partial');
    const call = vi.fn().mockResolvedValueOnce(req).mockResolvedValueOnce(good());
    const b = await designLab({ idea, graph, allowPartial: true }, call);
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.warnings.join(' ')).toMatch(/solo una parte/);
  });

  it('"force" NUNCA salta lo insuficiente', async () => {
    const req = JSON.stringify({ requisitos: [{ termino: 'teoría de juegos', esencial: true }] });
    const call = vi.fn().mockResolvedValueOnce(req);
    const r = await designLab({ idea, graph, allowPartial: true }, call);
    expect(!r.ok && r.reason).toBe('insufficient');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('sin idea, o con la memoria vacia, no llama al modelo', async () => {
    const call = vi.fn();
    expect((await designLab({ idea: 'corto', graph }, call)).ok).toBe(false);
    const empty = await designLab({ idea, graph: { concepts: [], edges: [] } }, call);
    expect(!empty.ok && empty.reason).toBe('insufficient');
    expect(call).not.toHaveBeenCalled();
  });

  it('REINTENTO GUIADO: un JSON ilegible se reintenta y la IA recibe el problema', async () => {
    const call = vi.fn().mockResolvedValueOnce(GOOD_REQ).mockResolvedValueOnce('no sé').mockResolvedValueOnce(good());
    const r = await designLab({ idea, graph }, call);
    expect(r.ok).toBe(true);
    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls[2][0]).toContain('TU RESPUESTA ANTERIOR TUVO ESTOS PROBLEMAS');
    expect(call.mock.calls[2][0]).toContain('SOLO con el JSON');
  });

  it('REINTENTO GUIADO: si el modelo no cumple la coherencia (constante sin usar), el error exacto vuelve a la IA y se corrige', async () => {
    const dead = rawModel({ constants: [...(example('consumidor').raw.constants as unknown[]), { id: 'zeta', label: 'Zeta', unit: '', value: 1, min: 0, max: 5 }] });
    const call = vi.fn().mockResolvedValueOnce(GOOD_REQ).mockResolvedValueOnce(good({ model: dead })).mockResolvedValueOnce(good());
    const r = await designLab({ idea, graph }, call);
    expect(r.ok).toBe(true);
    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls[2][0]).toContain('La constante "zeta" no influye en ninguna salida');
    expect(call.mock.calls[2][0]).toContain('IMPONERLA');
  });

  it('REPARACION MECANICA: si falla solo en el borde de un rango (dividir por 0), se acorta el rango y se avisa, sin gastar un reintento', async () => {
    const edge = rawModel({ variables: [{ id: 'x', label: 'Cantidad de X', unit: 'u', min: 0, max: 10, step: 0.5, default: 5 }], scene: null, constants: [{ id: 'M', value: 100, min: 50, max: 500 }, { id: 'px', value: 5, min: 1, max: 20 }, { id: 'py', value: 4, min: 1, max: 20 }, { id: 'a', value: 0.5, min: 0.1, max: 0.9 }], outputs: [{ id: 'Y', expr: 'cantY' }, { id: 'U', expr: 'x^a * cantY^(1-a)' }, { id: 'TMS', expr: 'a/(1-a) * cantY/x' }] });
    const call = vi.fn().mockResolvedValueOnce(GOOD_REQ).mockResolvedValueOnce(good({ model: edge }));
    const r = await designLab({ idea, graph }, call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.model?.variables[0].min).toBeGreaterThan(0);
    expect(r.warnings.join(' ')).toMatch(/Se acortó el mínimo de "x"/);
  });

  it('un fallo que NO esta en un borde se le devuelve a la IA con la formula y el punto', async () => {
    const mid = rawModel({ outputs: [{ id: 'Y', expr: 'cantY' }, { id: 'U', expr: 'x^a * cantY^(1-a) / (x - 20.25)' }, { id: 'TMS', expr: 'a/(1-a) * cantY/x' }], variables: [{ id: 'x', label: 'X', unit: 'u', min: 0.5, max: 40, step: 0.5, default: 6 }] });
    const call = vi.fn().mockResolvedValueOnce(GOOD_REQ).mockResolvedValueOnce(good({ model: mid })).mockResolvedValueOnce(good());
    const r = await designLab({ idea, graph }, call);
    expect(r.ok).toBe(true);
    expect(call.mock.calls[2][0]).toContain('fórmula: x^a * cantY^(1-a) / (x - 20.25)');
  });

  it('"con esto no se puede modelar" es una respuesta, no se reintenta', async () => {
    const call = vi.fn().mockResolvedValueOnce(GOOD_REQ).mockResolvedValueOnce('{"model": null, "motivo": "Los materiales no traen la fórmula de la demanda."}');
    const r = await designLab({ idea, graph }, call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(!r.ok && r.reason).toBe('noFit');
    expect(!r.ok && r.message).toContain('demanda');
  });

  it('tres diseños invalidos seguidos: error claro, nunca un laboratorio roto', async () => {
    const bad = good({ model: rawModel({ outputs: [{ id: 'U', expr: '2x' }] }) });
    const call = vi.fn().mockResolvedValueOnce(GOOD_REQ).mockResolvedValue(bad);
    const r = await designLab({ idea, graph }, call);
    expect(call).toHaveBeenCalledTimes(1 + DESIGN_LIMITS.attempts);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid');
      expect(r.message).toContain('Falta el signo *');
    }
  });

  it('la IA sin respuesta se reporta como tal, en el paso 1 y en el 2', async () => {
    const a = await designLab({ idea, graph }, vi.fn().mockResolvedValue(null));
    expect(!a.ok && a.reason).toBe('noResponse');
    const call = vi.fn().mockResolvedValueOnce(GOOD_REQ).mockResolvedValue(null);
    const b = await designLab({ idea, graph }, call);
    expect(!b.ok && b.reason).toBe('noResponse');
    expect(call).toHaveBeenCalledTimes(1 + DESIGN_LIMITS.attempts);
  });

  it('si ninguna cita del modelo existe en la memoria, avisa que no pudo citar (y usa lo que cubrio los requisitos)', async () => {
    const noBasis = rawModel({ basis: ['Algo inventado', 'Otra cosa'] });
    const call = vi.fn().mockResolvedValueOnce(GOOD_REQ).mockResolvedValueOnce(good({ model: noBasis }));
    const r = await designLab({ idea, graph }, call);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.model?.basis).not.toContain('Algo inventado');
    expect(r.evidence.length).toBeGreaterThan(0);
  });

  it('lo que devuelve la IA nunca es codigo ni HTML: se limpia', async () => {
    const dirty = good({ title: '<script>alert(1)</script>Mi laboratorio de prueba', context: '<img src=x onerror=alert(1)> escenario' });
    const r = await designLab({ idea, graph }, vi.fn().mockResolvedValueOnce(GOOD_REQ).mockResolvedValueOnce(dirty));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.title).not.toMatch(/[<>]/);
      expect(r.spec.context).not.toMatch(/[<>]/);
    }
  });
});

describe('piezas del diseño', () => {
  it('relevantConcepts: lo que cubre los requisitos mas sus prerrequisitos, sin pasarse del tope', () => {
    const cov = assessCoverage([{ term: 'equilibrio del consumidor', essential: true }], graph);
    const names = relevantConcepts(graph, cov).map((x) => x.name);
    expect(names[0]).toBe('Equilibrio del consumidor');
    expect(names).toEqual(expect.arrayContaining(['Restricción presupuestal', 'Ingreso (M)', 'Precios', 'Curva de indiferencia']));
    expect(names.length).toBeLessThanOrEqual(DESIGN_LIMITS.relevant);
  });

  it('relevantConcepts completa con lo mas importante si cubre muy poco', () => {
    const cov = assessCoverage([{ term: 'precios', essential: true }], graph);
    expect(relevantConcepts(graph, cov).length).toBeGreaterThanOrEqual(6);
  });

  it('resolveEvidence: solo conceptos que existen, por importancia, sin repetir', () => {
    const cov = assessCoverage([{ term: 'restricción presupuestal', essential: true }], graph);
    const ev = resolveEvidence(graph, cov, ['la restricción presupuestal', 'Utilidad marginal', 'cosa que no existe', 'Utilidad marginal']);
    expect(ev.map((x) => x.key)).toEqual([normalizeKey('Restricción presupuestal'), normalizeKey('Utilidad marginal')]);
    expect(ev[0].sources[0].materialId).toBe('m1');
  });

  it('parseDesign: distingue ilegible, "no se puede" e invalido (con los errores para la IA)', () => {
    expect(parseDesign('basura')).toMatchObject({ ok: false, reason: 'unparseable' });
    expect(parseDesign('{"model": null, "motivo": "no"}')).toMatchObject({ ok: false, reason: 'noFit' });
    const bad = parseDesign(good({ model: rawModel({ outputs: [] }) }));
    expect(bad).toMatchObject({ ok: false, reason: 'invalid' });
    if (!bad.ok) expect(bad.errors[0]).toMatch(/al menos una salida/);
  });

  it('el prompt de reintento solo aparece con errores', () => {
    const cov = assessCoverage([{ term: 'precios', essential: true }], graph);
    expect(buildDesignPrompt('x'.repeat(20), [], cov, [])).not.toContain('PROBLEMAS');
    expect(buildDesignPrompt('x'.repeat(20), [], cov, ['Falla A'])).toContain('- Falla A');
  });
});

// ─────────────────────────── reparacion de rangos ───────────────────────────
describe('trimRanges / repairModel', () => {
  const m = (over: Record<string, unknown> = {}) => ({ variables: [{ id: 'x', min: 0, max: 10, step: 1, default: 5 }], constants: [], derived: [], outputs: [{ id: 'y', expr: '1/x' }], ...over });

  it('acorta un paso el extremo donde fallo y deja el valor inicial dentro', () => {
    const t = trimRanges(m({ variables: [{ id: 'x', min: 0, max: 10, step: 1, default: 0 }] }), [{ output: 'y', values: { x: 0 }, constants: {} }])!;
    expect((t.model.variables as { min: number; default: number }[])[0]).toMatchObject({ min: 1, default: 1 });
    expect(t.notes[0]).toContain('mínimo de "x" a 1');
  });

  it('no toca lo que no fallo en un borde, ni deja un rango demasiado corto', () => {
    expect(trimRanges(m(), [{ output: 'y', values: { x: 5 }, constants: {} }])).toBeNull();
    expect(trimRanges(m({ variables: [{ id: 'x', min: 0, max: 1.5, step: 1, default: 1 }] }), [{ output: 'y', values: { x: 0 }, constants: {} }])).toBeNull();
    expect(trimRanges({ variables: 'x' }, [])).toBeNull();
  });

  it('repairModel arregla 1/x desde 0 y un modelo ya bueno queda intacto', () => {
    const r = repairModel(m());
    expect(validateModel(r.model).ok).toBe(true);
    expect(r.notes.length).toBeGreaterThan(0);
    const same = repairModel(m({ variables: [{ id: 'x', min: 1, max: 10 }] }));
    expect(same.notes).toEqual([]);
  });

  it('si el ajuste no alcanza (el fallo es de la formula), devuelve el modelo original sin avisos falsos', () => {
    const r = repairModel(m({ outputs: [{ id: 'y', expr: '1/(x-x)' }] }));
    expect(r.notes).toEqual([]);
    expect(validateModel(r.model).ok).toBe(false);
    expect(REPAIR_ROUNDS).toBeGreaterThan(1);
  });

  it('no inventa: no es objeto, no hay nada que reparar', () => {
    expect(repairModel(null)).toEqual({ model: null, notes: [] });
    expect(repairModel('x')).toEqual({ model: 'x', notes: [] });
  });
});

// ─────────────────────────── coherencia del modelo ───────────────────────────
describe('coherencia (lint) del modelo', () => {
  const base = (over: Record<string, unknown> = {}) => ({
    variables: [{ id: 'x', min: 1, max: 10, default: 5 }],
    constants: [{ id: 'k', value: 2, min: 1, max: 5 }],
    derived: [],
    outputs: [{ id: 'y', expr: 'x*k' }],
    ...over,
  });
  const errs = (raw: unknown) => {
    const r = validateModel(raw);
    return r.ok ? [] : r.errors;
  };

  it('un modelo en el que todo influye pasa', () => expect(validateModel(base()).ok).toBe(true));

  it('una constante que no influye en ninguna salida se rechaza, con la pista de IMPONER la restriccion (el caso del presupuesto decorativo)', () => {
    const e = errs(base({ constants: [{ id: 'k', value: 2, min: 1, max: 5 }, { id: 'M', value: 100, min: 10, max: 500 }] }));
    expect(e[0]).toContain('La constante "M" no influye en ninguna salida');
    expect(e[0]).toContain('IMPONERLA');
  });

  it('un paso usado solo por la escena (no por una salida) no cuenta', () => {
    const e = errs(base({ derived: [{ id: 'sobra', expr: 'x+1' }] }));
    expect(e[0]).toContain('El paso "sobra" no se usa en ninguna salida');
  });

  it('una variable que no influye se rechaza; lo usado a traves de pasos si cuenta', () => {
    expect(errs(base({ variables: [{ id: 'x', min: 1, max: 10 }, { id: 'z', min: 1, max: 10 }] }))[0]).toContain('La variable "z" no influye');
    expect(validateModel(base({ derived: [{ id: 'd', expr: 'x*k' }], outputs: [{ id: 'y', expr: 'd+1' }] })).ok).toBe(true);
  });

  it('la salida de la grafica debe cambiar al mover la variable independiente', () => {
    const flat = errs(base({ variables: [{ id: 'x', min: 1, max: 10 }, { id: 'z', min: 1, max: 10 }], outputs: [{ id: 'y', expr: 'z*k' }, { id: 'w', expr: 'x' }], chart: { x: 'x', y: 'y' }, independent: 'x' }));
    expect(flat[0]).toContain('La salida "y" no cambia cuando mueves "x"');
  });

  it('los modelos de ejemplo siguen validos con el control', () => {
    for (const ex of MODEL_EXAMPLES) expect(validateModel(ex.raw).ok, ex.id).toBe(true);
  });
});

// ─────────────────────────── leer la memoria guardada ───────────────────────────
describe('readGraph: el grafo guardado no es de fiar', () => {
  it('limpia lo corrupto y conserva lo bueno', () => {
    const g = readGraph({
      concepts: [
        { key: 'a', name: 'A', kind: 'raro', definition: 5, formula: 'x = 1', importance: 99, mentions: -3, sources: [{ materialId: 'm', chunks: [1, 'x', 2] }, 'mal'] },
        { key: 'a', name: 'repetido' },
        { key: '', name: 'sin clave' },
        null,
        { key: 'b', name: 'B' },
      ],
      edges: [{ from: 'a', to: 'b', relation: 'rara', weight: 'x' }, { from: 'a', to: 'zz' }, { from: 'a', to: 'a' }, 7],
    });
    expect(g.concepts.map((x) => x.key)).toEqual(['a', 'b']);
    expect(g.concepts[0]).toMatchObject({ kind: 'concepto', definition: '', formula: 'x = 1', importance: 5, mentions: 1 });
    expect(g.concepts[0].sources).toEqual([{ materialId: 'm', chunks: [1, 2] }]);
    expect(g.edges).toEqual([{ from: 'a', to: 'b', relation: 'relacionado', weight: 1 }]);
  });

  it('cualquier cosa que no sea un grafo da uno vacio', () => {
    for (const bad of [null, undefined, 'x', 5, [], { concepts: 'x' }]) expect(readGraph(bad)).toEqual({ concepts: [], edges: [] });
  });
});

// ─────────────────────────── la ruta ───────────────────────────
describe('ruta /api/lab/design', () => {
  const route = codeOnly(read('src/app/api/lab/design/route.ts'));

  it('exige sesion y que la clase sea del profesor (si no, 404); valida los datos antes de gastar IA', () => {
    expect(route).toContain('auth.getUser()');
    expect(route).toContain('status: 401');
    expect(route).toMatch(/from\('classrooms'\)[\s\S]*?\.eq\('teacher_id', user\.id\)/);
    expect(route).toContain('status: 404');
    expect(route).toContain('UUID_RE.test(classroomId)');
    expect(route.indexOf('auth.getUser()')).toBeLessThan(route.indexOf('designLab('));
    expect(route.indexOf('class_memory')).toBeLessThan(route.indexOf('designLab('));
  });

  it('lee la memoria con la sesion del profesor (RLS) y no confia en lo guardado; la llave de servicio SOLO sirve para el contador de uso (rpc), nunca para leer ni escribir datos', () => {
    expect(route).not.toContain('SERVICE_ROLE');
    expect(route).toMatch(/db\.from\('class_memory'\)/); // db = el cliente del profesor
    expect(route).toContain('readGraph(memory.graph)');
    // El cliente administrador existe solo para el cupo: ninguna consulta de datos pasa por el.
    expect(route).toContain('admin.rpc(fn, args)');
    expect(route).not.toMatch(/admin\.from\(/);
    expect(route).not.toMatch(/admin\.storage/);
    // ... y se crea DESPUES de comprobar que quien pide es el dueño de la clase.
    expect(route.indexOf('createAdminSupabase()')).toBeGreaterThan(route.indexOf(".eq('teacher_id', user.id)"));
  });

  it('sin memoria o construyendose responde 409 con el motivo; sin IA, 503', () => {
    expect(route).toContain("reason: 'noMemory'");
    expect(route).toContain("reason: 'building'");
    expect(route).toContain('status: 409');
    expect(route).toContain('hasStudyProvider()');
    expect(route).toContain('status: 503');
  });

  it('"no alcanza" es 422 con el detalle de lo que falta; otros fallos del modelo, 502', () => {
    expect(route).toContain("result.reason === 'insufficient'");
    expect(route).toContain('status: 422');
    expect(route).toContain('missing: result.coverage.missing');
    expect(route).toContain('status: 502');
  });

  it('"force" solo salta lo parcial (lo decide designLab); el material vinculado debe ser del profesor y de la clase', () => {
    expect(route).toContain('allowPartial: force');
    expect(route).toMatch(/from\('teaching_materials'\)[\s\S]*?\.eq\('classroom_id', classroomId\)[\s\S]*?\.eq\('teacher_id', user\.id\)/);
  });

  it('devuelve solo datos validados (la ficha, avisos y evidencia), nunca texto crudo de la IA', () => {
    expect(route).toContain('spec: result.spec');
    expect(route).not.toMatch(/\braw\b/);
  });
});

describe('panel del profesor', () => {
  const ui = read('src/app/(teacher)/teacher/classrooms/[id]/lab/LabManagerClient.tsx');
  it('usa la ruta de diseño desde la memoria, bloquea sin memoria y muestra lo que falta', () => {
    expect(ui).toContain("fetch('/api/lab/design'");
    expect(ui).not.toContain("fetch('/api/lab/propose'");
    expect(ui).toContain('!memoryReady');
    expect(ui).toContain('Falta en tus materiales');
    expect(ui).toContain('Crear de todos modos');
    expect(ui).toContain("gap.reason === 'partial'");
  });
  it('el editor muestra de que conceptos se apoya y las formulas del modelo', () => {
    const ed = read('src/app/(teacher)/teacher/classrooms/[id]/lab/LabEditor.tsx');
    expect(ed).toContain('Se apoya en lo que enseñaste');
    expect(ed).toContain('Fórmulas del modelo');
  });
});
