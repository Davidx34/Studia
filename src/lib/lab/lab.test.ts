import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { LAB_TEMPLATES, getLabTemplate } from './labTemplates';
import { LIMITS, buildLab, defaultSpec, resolveLab, sanitizeText, validateLabSpec } from './labSpec';
import { HOST_SOURCE, LAB_SOURCE, MSG_LIMITS, buildInitMessage, parseAttemptState, parseLabMessage } from './protocol';
import { labThemeVars, toRgb } from './labTheme';
import { isPublicAsset } from '@/lib/auth/routes';
import type { LabTemplateInfo } from './types';

const require = createRequire(import.meta.url);
const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

interface LabModel {
  id: string;
  model: (v: Record<string, number>, c: Record<string, number>) => Record<string, number>;
  [k: string]: unknown;
}
const loadModel = (id: string): LabModel => require(path.join(root, 'public/labs/models', `${id}.js`));

const defaults = (t: LabTemplateInfo) => Object.fromEntries(t.variables.map((v) => [v.id, v.default]));
const consts = (t: LabTemplateInfo) => Object.fromEntries(t.constants.map((c) => [c.id, c.value]));

// ─────────────────────────── catalogo ───────────────────────────
describe('catalogo de plantillas de laboratorio', () => {
  it('ids unicos, con la forma de siempre, y cada plantilla es de un area', () => {
    const ids = LAB_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of LAB_TEMPLATES) {
      expect(t.id).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
      expect(['fisica', 'quimica', 'biologia', 'economia', 'matematicas', 'estadistica']).toContain(t.area);
      expect(t.name.length).toBeGreaterThan(5);
      expect(t.concept.length).toBeGreaterThan(30);
      expect(t.description.length).toBeGreaterThan(30);
      expect(t.bestFor.length).toBeGreaterThan(20);
    }
  });

  it.each(LAB_TEMPLATES.map((t) => t.id))('%s: variables, constantes y salidas coherentes', (id) => {
    const t = getLabTemplate(id)!;
    expect(t.variables.length).toBeGreaterThanOrEqual(2);
    const all = [...t.variables.map((v) => v.id), ...t.constants.map((c) => c.id), ...t.outputs.map((o) => o.id)];
    expect(new Set(all).size, 'los ids de variables, constantes y salidas no se repiten').toBe(all.length);
    for (const id2 of all) expect(id2).toMatch(/^[A-Za-z][A-Za-z0-9_]{0,23}$/); // la forma que acepta el protocolo
    for (const v of t.variables) {
      expect(v.min, v.id).toBeLessThan(v.max);
      expect(v.default, v.id).toBeGreaterThanOrEqual(v.min);
      expect(v.default, v.id).toBeLessThanOrEqual(v.max);
      expect(v.step, v.id).toBeGreaterThan(0);
      expect(v.step, v.id).toBeLessThan(v.max - v.min);
      expect(v.decimals).toBeGreaterThanOrEqual(0);
    }
    for (const c of t.constants) {
      expect(c.min).toBeLessThan(c.max);
      expect(c.value).toBeGreaterThanOrEqual(c.min);
      expect(c.value).toBeLessThanOrEqual(c.max);
    }
    expect(t.variables.map((v) => v.id)).toContain(t.defaultIndependent);
    expect(t.variables.map((v) => v.id)).toContain(t.defaultChart.x);
    expect(t.outputs.map((o) => o.id)).toContain(t.defaultChart.y);
    expect(t.defaultQuestions.length).toBeGreaterThanOrEqual(3);
    for (const q of t.defaultQuestions) expect(q.length).toBeGreaterThanOrEqual(LIMITS.minQuestionLength);
    expect(t.outputs.length + t.variables.length, 'cabe en un ensayo del protocolo').toBeLessThanOrEqual(MSG_LIMITS.keys * 2);
    expect(t.variables.length).toBeLessThanOrEqual(MSG_LIMITS.keys);
    expect(t.outputs.length).toBeLessThanOrEqual(MSG_LIMITS.keys);
  });
});

// ─────────────────────────── archivos HTML y modelos ───────────────────────────
describe.each(LAB_TEMPLATES.map((t) => t.id))('plantilla HTML %s', (id) => {
  const html = read(`public/labs/${id}.html`);

  it('es un documento completo que carga el runtime, sus estilos y su modelo (y nada de internet)', () => {
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<html lang="es"');
    expect(html).toContain(`data-lab-template="${id}"`);
    expect(html).toContain('name="viewport"');
    expect(html).toContain('<script src="runtime.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="runtime.css">');
    expect(html).toContain(`<script src="models/${id}.js"></script>`);
    expect(html).toContain('id="lab"');
    // Funciona sin red y sin enviar nada a terceros.
    expect(html).not.toMatch(/https?:\/\//i);
  });

  it('el modelo existe, se registra con el mismo id y calcula exactamente las salidas del catalogo', () => {
    const t = getLabTemplate(id)!;
    const m = loadModel(id);
    expect(m.id).toBe(id);
    expect(typeof m.draw).toBe('function');
    expect(typeof m.describe).toBe('function');
    const out = m.model(defaults(t), consts(t));
    expect(Object.keys(out).sort()).toEqual(t.outputs.map((o) => o.id).sort());
    for (const v of Object.values(out)) expect(Number.isFinite(v)).toBe(true);
    expect(String(m.describe && (m.describe as Function)(defaults(t), consts(t), out)).length).toBeGreaterThan(40);
  });

  it('el modelo da numeros finitos en TODA la esquina de limites de la plantilla (nunca NaN ni infinito)', () => {
    const t = getLabTemplate(id)!;
    const m = loadModel(id);
    const corners = (vars: typeof t.variables): Record<string, number>[] =>
      vars.reduce<Record<string, number>[]>((acc, v) => acc.flatMap((a) => [v.min, (v.min + v.max) / 2, v.max].map((x) => ({ ...a, [v.id]: x }))), [{}]);
    const cCorners = t.constants.reduce<Record<string, number>[]>((acc, c) => acc.flatMap((a) => [c.min, c.value, c.max].map((x) => ({ ...a, [c.id]: x }))), [{}]);
    let n = 0;
    for (const v of corners(t.variables)) {
      for (const c of cCorners) {
        for (const [k, val] of Object.entries(m.model(v, c))) {
          expect(Number.isFinite(val), `${id} ${JSON.stringify(v)} ${JSON.stringify(c)} -> ${k}`).toBe(true);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(50);
  });
});

// ─────────────────────────── fisica: lanzamiento de proyectiles ───────────────────────────
describe('modelo: lanzamiento de proyectiles', () => {
  const m = loadModel('trayectoria');
  const g = 9.81;
  const run = (v0: number, angulo: number, h0 = 0, gg = g) => m.model({ v0, angulo, h0 }, { g: gg });
  const close = (a: number, b: number, d = 6) => expect(a).toBeCloseTo(b, d);

  it('a 45° y desde el suelo el alcance es v²/g (la formula de libro)', () => {
    const r = run(20, 45);
    close(r.alcance, (20 * 20) / g, 8);
  });

  it('altura maxima = (v·sinθ)²/2g y tiempo de vuelo = 2·v·sinθ/g desde el suelo', () => {
    const r = run(30, 30);
    close(r.alturaMax, Math.pow(30 * Math.sin(Math.PI / 6), 2) / (2 * g), 8);
    close(r.tiempoVuelo, (2 * 30 * Math.sin(Math.PI / 6)) / g, 8);
  });

  it('angulos complementarios (30° y 60°) dan el mismo alcance', () => {
    close(run(25, 30).alcance, run(25, 60).alcance, 8);
    close(run(40, 20).alcance, run(40, 70).alcance, 8);
  });

  it('el mayor alcance es a 45° (la respuesta que el estudiante debe descubrir)', () => {
    const best = Array.from({ length: 81 }, (_, i) => 5 + i).reduce((b, a) => (run(20, a).alcance > run(20, b).alcance ? a : b));
    expect(best).toBe(45);
  });

  it('desde el suelo la velocidad al caer es la inicial; desde una altura sube segun la energia: √(v0² + 2·g·h0)', () => {
    close(run(20, 40).velImpacto, 20, 8);
    close(run(20, 40, 30).velImpacto, Math.sqrt(400 + 2 * g * 30), 8);
  });

  it('una altura inicial aumenta el alcance y el tiempo de vuelo; con 0 m coincide con la formula del suelo', () => {
    expect(run(20, 45, 10).alcance).toBeGreaterThan(run(20, 45, 0).alcance);
    expect(run(20, 45, 10).tiempoVuelo).toBeGreaterThan(run(20, 45, 0).tiempoVuelo);
  });

  it('lanzar horizontalmente desde una altura (limite) cae en t = √(2h/g)', () => {
    const r = m.model({ v0: 10, angulo: 0, h0: 20 }, { g });
    close(r.tiempoVuelo, Math.sqrt((2 * 20) / g), 8);
  });

  it('en la Luna (g = 1,62) el mismo lanzamiento llega ~6 veces mas lejos', () => {
    const ratio = run(20, 45, 0, 1.62).alcance / run(20, 45, 0, 9.81).alcance;
    close(ratio, 9.81 / 1.62, 8);
  });

  it('el alcance crece con el cuadrado de la velocidad (duplicar v lo cuadruplica)', () => {
    close(run(40, 35).alcance / run(20, 35).alcance, 4, 8);
  });

  it('la trayectoria que dibuja el modelo termina exactamente en el alcance calculado', () => {
    const v = { v0: 33, angulo: 52, h0: 7 };
    const out = m.model(v, { g });
    const p = (m.pos as Function)(v, { g }, out.tiempoVuelo);
    close(p.x, out.alcance, 8);
    expect(Math.abs(p.y)).toBeLessThan(1e-9);
  });
});

// ─────────────────────────── economia: multiplicador keynesiano ───────────────────────────
describe('modelo: multiplicador keynesiano', () => {
  const m = loadModel('multiplicador');
  const run = (G: number, I: number, c: number, t: number, C0 = 100, T0 = 0) => m.model({ G, I, c, t }, { C0, T0 });
  const close = (a: number, b: number, d = 6) => expect(a).toBeCloseTo(b, d);

  it('el ingreso de equilibrio cumple la identidad Y = C + I + G en todo el rango', () => {
    for (const G of [0, 200, 600]) for (const I of [0, 150, 400]) for (const c of [0.3, 0.8, 0.95]) for (const t of [0, 0.2, 0.5]) for (const T0 of [0, 100]) {
      const r = run(G, I, c, t, 100, T0);
      close(r.Y, r.consumo + I + G, 6);
    }
  });

  it('el multiplicador es 1/(1 − c(1 − t)): sin impuestos y c = 0,8 vale 5', () => {
    close(run(200, 150, 0.8, 0).k, 5, 10);
    close(run(200, 150, 0.8, 0.25).k, 1 / (1 - 0.8 * 0.75), 10);
  });

  it('subir el gasto en ΔG sube el ingreso en k·ΔG (lo que el estudiante debe medir)', () => {
    const a = run(200, 150, 0.8, 0.2);
    const b = run(250, 150, 0.8, 0.2);
    close(b.Y - a.Y, a.k * 50, 8);
  });

  it('mas impuestos bajan el multiplicador y el ingreso; mas propension a consumir los suben', () => {
    expect(run(200, 150, 0.8, 0.4).k).toBeLessThan(run(200, 150, 0.8, 0.1).k);
    expect(run(200, 150, 0.8, 0.4).Y).toBeLessThan(run(200, 150, 0.8, 0.1).Y);
    expect(run(200, 150, 0.9, 0.2).k).toBeGreaterThan(run(200, 150, 0.6, 0.2).k);
  });

  it('el recaudo es T0 + t·Y y el consumo C0 + c·(Y − T)', () => {
    const r = run(200, 150, 0.8, 0.2, 100, 30);
    close(r.recaudo, 30 + 0.2 * r.Y, 8);
    close(r.consumo, 100 + 0.8 * (r.Y - r.recaudo), 8);
  });

  it('el multiplicador nunca explota dentro de los limites (maximo ~20 con c = 0,95 y t = 0)', () => {
    close(run(0, 0, 0.95, 0).k, 20, 8);
    for (const c of [0.3, 0.95]) for (const t of [0, 0.5]) expect(run(1, 1, c, t).k).toBeLessThanOrEqual(20.0000001);
  });

  it('la recta de gasto agregado de la cruz corta la de 45° exactamente en el equilibrio', () => {
    const v = { G: 230, I: 90, c: 0.75, t: 0.3 };
    const c = { C0: 120, T0: 20 };
    const p = (m.parts as Function)(v, c);
    const out = m.model(v, c);
    close(p.a0 + p.slope * out.Y, out.Y, 8);
  });
});

// ─────────────────────────── la ficha del experimento ───────────────────────────
describe('sanitizeText', () => {
  it('deja solo texto: quita etiquetas, caracteres de control y espacios de mas, y recorta', () => {
    expect(sanitizeText('  Hola   <b>mundo</b>\n\tadiós  ', 100)).toBe('Hola mundo adiós');
    expect(sanitizeText('<script>alert(1)</script>Texto', 100)).not.toMatch(/[<>]/);
    expect(sanitizeText('a'.repeat(500), 50)).toHaveLength(50);
    expect(sanitizeText('x\u0000y\u0007z', 10)).toBe('x y z');
    for (const v of [null, undefined, 5, {}, []]) expect(sanitizeText(v, 10)).toBe('');
  });
});

describe('validateLabSpec', () => {
  it('rechaza lo que no es una ficha o apunta a una plantilla que no existe', () => {
    for (const raw of [null, undefined, 'x', 5, [], { template: 'inventada' }, {}, { template: 42 }]) {
      const r = validateLabSpec(raw);
      expect(r.ok, JSON.stringify(raw)).toBe(false);
    }
  });

  it('con solo la plantilla arma el experimento "de libro", sin avisos', () => {
    for (const t of LAB_TEMPLATES) {
      const r = validateLabSpec({ template: t.id });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.spec).toEqual(defaultSpec(t));
        expect(r.warnings).toEqual([]);
        expect(r.spec.mode).toBe('controlado');
        expect(r.spec.questions).toEqual(t.defaultQuestions);
      }
    }
  });

  it('limpia los textos: nada de HTML llega al laboratorio', () => {
    const r = validateLabSpec({ template: 'trayectoria', title: '<img src=x onerror=alert(1)>Mi laboratorio', objective: '<script>x</script>Descubre el ángulo ideal', context: '<b>Un campo</b> de fútbol' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      for (const s of [r.spec.title, r.spec.objective, r.spec.context]) expect(s).not.toMatch(/[<>]/);
      expect(r.spec.title).toContain('Mi laboratorio');
      expect(r.spec.context).toBe('Un campo de fútbol');
    }
  });

  it('un titulo u objetivo demasiado cortos se reemplazan por los de la plantilla', () => {
    const r = validateLabSpec({ template: 'trayectoria', title: 'ab', objective: 'corto', hypothesisPrompt: 'x' });
    expect(r.ok && r.spec.title).toBe('Lanzamiento de proyectiles');
    expect(r.ok && r.spec.objective).toBe(getLabTemplate('trayectoria')!.concept);
    expect(r.ok && r.spec.hypothesisPrompt.length).toBeGreaterThan(10);
  });

  it('recorta los largos a su limite', () => {
    const r = validateLabSpec({ template: 'trayectoria', title: 'T'.repeat(500), objective: 'O'.repeat(900), context: 'C'.repeat(900) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.title).toHaveLength(LIMITS.title);
      expect(r.spec.objective).toHaveLength(LIMITS.objective);
      expect(r.spec.context).toHaveLength(LIMITS.context);
    }
  });

  it('la variable independiente debe existir; si no, se usa la de siempre y se avisa', () => {
    const ok = validateLabSpec({ template: 'trayectoria', independent: 'v0' });
    expect(ok.ok && ok.spec.independent).toBe('v0');
    const bad = validateLabSpec({ template: 'trayectoria', independent: 'alcance' }); // una SALIDA no se puede mover
    expect(bad.ok && bad.spec.independent).toBe('angulo');
    expect(bad.ok && bad.warnings.length).toBe(1);
  });

  it('el modo solo puede ser controlado (por defecto) o libre', () => {
    expect((validateLabSpec({ template: 'trayectoria', mode: 'libre' }) as any).spec.mode).toBe('libre');
    for (const m of ['otro', 5, null, undefined, 'LIBRE']) expect((validateLabSpec({ template: 'trayectoria', mode: m }) as any).spec.mode).toBe('controlado');
  });

  it('los rangos de las variables se recortan a los limites de la plantilla (la IA no puede sacar un valor imposible)', () => {
    const r = validateLabSpec({ template: 'trayectoria', variables: { v0: { min: -100, max: 9999, default: 5000 }, angulo: { min: 20, max: 70, default: 10 } } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.variables.v0).toEqual({ min: 1, max: 60, default: 60 });
      expect(r.spec.variables.angulo).toEqual({ min: 20, max: 70, default: 20 });
    }
  });

  it('un rango invertido o de largo cero se descarta con aviso', () => {
    const r = validateLabSpec({ template: 'trayectoria', variables: { v0: { min: 40, max: 10 } } });
    expect(r.ok && r.spec.variables.v0).toBeUndefined();
    expect(r.ok && r.warnings.join(' ')).toContain('rango');
  });

  it('variables que no existen, valores no numericos y NaN/Infinity se ignoran', () => {
    const r = validateLabSpec({ template: 'trayectoria', variables: { fantasma: { min: 1 }, v0: { min: 'diez', max: NaN, default: Infinity }, h0: 5 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec.variables).toEqual({});
  });

  it('las constantes (por ejemplo la gravedad) se recortan a su rango y avisan', () => {
    const luna = validateLabSpec({ template: 'trayectoria', constants: { g: 1.62 } });
    expect(luna.ok && luna.spec.constants.g).toBe(1.62);
    const absurda = validateLabSpec({ template: 'trayectoria', constants: { g: 500, nada: 3 } });
    expect(absurda.ok && absurda.spec.constants.g).toBe(25);
    expect(absurda.ok && absurda.warnings.length).toBe(2);
  });

  it('el numero minimo de ensayos se redondea y se acota a 2-12 (5 por defecto)', () => {
    const f = (v: unknown) => (validateLabSpec({ template: 'trayectoria', minTrials: v }) as any).spec.minTrials;
    expect([f(0), f(1), f(7.6), f(99), f('3'), f(undefined), f(NaN)]).toEqual([2, 2, 8, 12, 5, 5, 5]);
  });

  it('las preguntas se limpian, se quitan las repetidas y las muy cortas, y se usan como maximo 6', () => {
    const r = validateLabSpec({ template: 'trayectoria', questions: ['¿Qué ángulo da más alcance y por qué?', '¿Qué ángulo da más alcance y por qué?', 'corta', '<b>¿Cómo cambia con la velocidad?</b>', ...Array.from({ length: 10 }, (_, i) => `Pregunta numero ${i + 10} del experimento`)] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.questions).toHaveLength(LIMITS.maxQuestions);
      expect(r.spec.questions[0]).toBe('¿Qué ángulo da más alcance y por qué?');
      expect(r.spec.questions[1]).toBe('¿Cómo cambia con la velocidad?');
      expect(new Set(r.spec.questions.map((q) => q.toLowerCase())).size).toBe(r.spec.questions.length);
      expect(r.warnings.join(' ')).toContain('primeras 6');
    }
  });

  it('sin preguntas utiles, usa las de la plantilla (el informe nunca queda vacio)', () => {
    for (const questions of [[], ['x'], 'no es lista', null, [5, {}, null]]) {
      const r = validateLabSpec({ template: 'multiplicador', questions });
      expect(r.ok && r.spec.questions).toEqual(getLabTemplate('multiplicador')!.defaultQuestions);
    }
  });

  it('la curva del modelo solo se muestra si se pide de forma explicita (true)', () => {
    expect((validateLabSpec({ template: 'trayectoria' }) as any).spec.showModelCurve).toBe(false);
    expect((validateLabSpec({ template: 'trayectoria', showModelCurve: 'true' }) as any).spec.showModelCurve).toBe(false);
    expect((validateLabSpec({ template: 'trayectoria', showModelCurve: true }) as any).spec.showModelCurve).toBe(true);
  });

  it('ignora campos que no conoce (no se cuelan al laboratorio)', () => {
    const r = validateLabSpec({ template: 'trayectoria', script: 'alert(1)', html: '<b>x</b>', __proto__: { admin: true } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.spec).sort()).toEqual(Object.keys(defaultSpec(getLabTemplate('trayectoria')!)).sort());
  });
});

describe('resolveLab', () => {
  const lab = (raw: Record<string, unknown>) => {
    const r = buildLab({ template: 'trayectoria', ...raw });
    if (!r.ok) throw new Error(r.errors.join());
    return r.lab;
  };

  it('en modo controlado solo la variable independiente se puede mover; las demas quedan bloqueadas', () => {
    const l = lab({ independent: 'angulo' });
    expect(l.variables.map((v) => [v.id, v.role, v.locked])).toEqual([['v0', 'controlada', true], ['angulo', 'independiente', false], ['h0', 'controlada', true]]);
  });

  it('en modo libre ninguna esta bloqueada, pero se sigue marcando la independiente', () => {
    const l = lab({ mode: 'libre', independent: 'v0' });
    expect(l.variables.every((v) => !v.locked)).toBe(true);
    expect(l.variables.filter((v) => v.role === 'independiente').map((v) => v.id)).toEqual(['v0']);
  });

  it('la ficha fija el valor de cada variable controlada y el rango de la independiente', () => {
    const l = lab({ independent: 'angulo', variables: { v0: { default: 35 }, h0: { default: 12 }, angulo: { min: 15, max: 75 } } });
    const by = Object.fromEntries(l.variables.map((v) => [v.id, v]));
    expect([by.v0.default, by.h0.default]).toEqual([35, 12]);
    expect([by.angulo.min, by.angulo.max]).toEqual([15, 75]);
    expect(by.angulo.default).toBeGreaterThanOrEqual(15);
    expect(by.angulo.default).toBeLessThanOrEqual(75);
  });

  it('el valor por defecto siempre cae dentro del rango, aunque el rango se haya reducido', () => {
    const l = lab({ variables: { angulo: { min: 60, max: 80 } } });
    const a = l.variables.find((v) => v.id === 'angulo')!;
    expect(a.default).toBe(60); // el 45 de la plantilla ya no cabe
  });

  it('las constantes toman el valor de la ficha (la Luna) y la grafica arranca con la independiente en el eje X', () => {
    const l = lab({ independent: 'v0', constants: { g: 1.62 } });
    expect(l.constants[0]).toMatchObject({ id: 'g', value: 1.62 });
    expect(l.chart).toEqual({ x: 'v0', y: 'alcance' });
  });

  it('las preguntas reciben un id estable y el resultado es serializable (viaja por postMessage)', () => {
    const l = lab({});
    expect(l.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
    expect(JSON.parse(JSON.stringify(l))).toEqual(l);
  });

  it('una plantilla desconocida no se puede resolver', () => {
    expect(resolveLab({ ...defaultSpec(LAB_TEMPLATES[0]), template: 'nada' })).toBeNull();
  });

  it('buildLab devuelve los errores de una ficha invalida y los avisos de una ajustada', () => {
    expect(buildLab({ template: 'nada' }).ok).toBe(false);
    const r = buildLab({ template: 'trayectoria', constants: { g: 999 } });
    expect(r.ok && r.warnings.length).toBe(1);
  });
});

// ─────────────────────────── protocolo de mensajes ───────────────────────────
describe('protocolo: lo que llega del laboratorio no es confiable', () => {
  const trial = (over: Record<string, unknown> = {}) => ({ n: 1, control: true, inputs: { v0: 20, angulo: 45 }, outputs: { alcance: 40.77 }, ...over });
  const state = (over: Record<string, unknown> = {}) => ({ hypothesis: 'creo que 45', trials: [trial()], answers: ['a', 'b'], conclusion: 'fin', ...over });
  const msg = (type: string, extra: Record<string, unknown> = {}) => ({ source: LAB_SOURCE, type, ...extra });

  it('acepta los cuatro mensajes validos', () => {
    expect(parseLabMessage(msg('ready', { template: 'trayectoria' }))).toEqual({ source: LAB_SOURCE, type: 'ready', template: 'trayectoria' });
    expect(parseLabMessage(msg('state', { state: state() }))?.type).toBe('state');
    expect(parseLabMessage(msg('submit', { state: state() }))?.type).toBe('submit');
    expect(parseLabMessage(msg('resize', { height: 900 }))).toEqual({ source: LAB_SOURCE, type: 'resize', height: 900 });
  });

  it('descarta lo que no es un mensaje del laboratorio', () => {
    for (const m of [null, undefined, 'x', 3, [], {}, { type: 'ready' }, { source: 'otro', type: 'ready', template: 'trayectoria' }, msg('desconocido'), msg('ready')]) {
      expect(parseLabMessage(m), JSON.stringify(m)).toBeNull();
    }
  });

  it('el nombre de plantilla del mensaje ready debe tener la forma esperada (nada de rutas ni codigo)', () => {
    for (const t of ['../x', 'A B', '<img>', '', 'x'.repeat(40), 5]) expect(parseLabMessage(msg('ready', { template: t }))).toBeNull();
  });

  it('el alto se acota entre 200 y 6000 px y se redondea; lo que no es numero se descarta', () => {
    expect((parseLabMessage(msg('resize', { height: 1 })) as any).height).toBe(MSG_LIMITS.height.min);
    expect((parseLabMessage(msg('resize', { height: 1e9 })) as any).height).toBe(MSG_LIMITS.height.max);
    expect((parseLabMessage(msg('resize', { height: 640.6 })) as any).height).toBe(641);
    for (const h of [NaN, Infinity, '600', null]) expect(parseLabMessage(msg('resize', { height: h }))).toBeNull();
  });

  it('un estado con mas ensayos de los permitidos se descarta entero', () => {
    const many = Array.from({ length: MSG_LIMITS.trials + 1 }, () => trial());
    expect(parseLabMessage(msg('state', { state: state({ trials: many }) }))).toBeNull();
    expect(parseLabMessage(msg('state', { state: state({ trials: many.slice(0, MSG_LIMITS.trials) }) }))).not.toBeNull();
  });

  it('numeros no finitos, enormes o con llaves raras en un ensayo descartan el estado', () => {
    for (const bad of [{ inputs: { v0: NaN } }, { inputs: { v0: Infinity } }, { outputs: { alcance: 1e13 } }, { inputs: { 'a b': 1 } }, { inputs: { '__proto__x': 1, '1x': 2 } }, { inputs: 'x' }, { outputs: null }]) {
      expect(parseLabMessage(msg('state', { state: state({ trials: [trial(bad)] }) })), JSON.stringify(bad)).toBeNull();
    }
    expect(parseLabMessage(msg('state', { state: state({ trials: [trial({ inputs: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, i])) })] }) }))).toBeNull();
  });

  it('los textos se recortan a 2000 caracteres, sin caracteres de control, y las respuestas a 6', () => {
    const r = parseAttemptState(state({ hypothesis: 'h'.repeat(5000), conclusion: 'a\u0000b\u0007c', answers: Array.from({ length: 20 }, (_, i) => `r${i}`) }))!;
    expect(r.hypothesis).toHaveLength(MSG_LIMITS.text);
    expect(r.conclusion).toBe('abc');
    expect(r.answers).toHaveLength(MSG_LIMITS.answers);
  });

  it('numera los ensayos por su posicion (el laboratorio no puede falsear la numeracion) y normaliza el control', () => {
    const r = parseAttemptState(state({ trials: [trial({ n: 99, control: 'si' }), trial({ n: -4, control: true })] }))!;
    expect(r.trials.map((t) => t.n)).toEqual([1, 2]);
    expect(r.trials.map((t) => t.control)).toEqual([false, true]);
  });

  it('respuestas que no son texto se vuelven vacias; un estado sin forma se descarta', () => {
    expect(parseAttemptState(state({ answers: [5, null, {}, 'ok'] }))!.answers).toEqual(['', '', '', 'ok']);
    for (const s of [null, 'x', [], { trials: 'no' }, { hypothesis: 'x' }]) expect(parseAttemptState(s)).toBeNull();
  });

  it('el mensaje de inicio lleva el laboratorio, el estado, el modo de solo lectura y el tema', () => {
    const built = buildLab({ template: 'trayectoria' });
    if (!built.ok) throw new Error('x');
    const m = buildInitMessage(built.lab, null, true, { '--lab-bg': 'rgb(1 2 3)' });
    expect(m).toMatchObject({ source: HOST_SOURCE, type: 'init', state: null, readOnly: true, theme: { '--lab-bg': 'rgb(1 2 3)' } });
    expect(m.lab.template).toBe('trayectoria');
  });
});

// ─────────────────────────── tema ───────────────────────────
describe('tema del laboratorio', () => {
  it('toRgb convierte el triple de la app y descarta cualquier otra cosa (nada de CSS arbitrario)', () => {
    expect(toRgb('79 70 229')).toBe('rgb(79 70 229)');
    expect(toRgb('  0 0 0 ')).toBe('rgb(0 0 0)');
    for (const v of ['', '256 0 0', '1 2', 'red', 'url(x)', '1 2 3; background: red', 'rgb(1 2 3)', '1,2,3']) expect(toRgb(v), v).toBeNull();
  });

  it('labThemeVars lee las variables de la app y solo entrega las validas', () => {
    const vars = labThemeVars((v) => (v === '--c-primary' ? '79 70 229' : v === '--c-bg' ? 'basura' : '15 23 42'));
    expect(vars['--lab-primary']).toBe('rgb(79 70 229)');
    expect(vars['--lab-bg']).toBeUndefined();
    expect(vars['--lab-fg']).toBe('rgb(15 23 42)');
    for (const k of Object.keys(vars)) expect(k).toMatch(/^--lab-[a-z0-9-]+$/);
  });
});

// ─────────────────────────── aislamiento y seguridad ───────────────────────────
// Solo el codigo: los comentarios explican justamente lo que NO se usa, y no deben contar.
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

describe('seguridad del laboratorio', () => {
  const runtime = codeOnly(read('public/labs/runtime.js'));
  const frame = codeOnly(read('src/components/lab/LabFrame.tsx'));

  it('el runtime nunca evalua texto ni usa innerHTML, red ni almacenamiento del navegador', () => {
    for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'eval(', 'new Function', 'document.write', 'localStorage', 'sessionStorage', 'fetch(', 'XMLHttpRequest', 'importScripts', 'WebSocket', 'document.cookie']) {
      expect(runtime, bad).not.toContain(bad);
    }
  });

  it('los modelos tampoco', () => {
    for (const t of LAB_TEMPLATES) {
      const src = codeOnly(read(`public/labs/models/${t.id}.js`));
      for (const bad of ['innerHTML', 'eval(', 'new Function', 'fetch(', 'localStorage', 'document.']) expect(src, `${t.id}: ${bad}`).not.toContain(bad);
    }
  });

  it('el runtime solo escucha al padre y solo mensajes de la app, y solo le habla al padre', () => {
    expect(runtime).toContain('e.source !== window.parent');
    expect(runtime).toContain("d.source !== HOST");
    expect(runtime).toContain('window.parent.postMessage(msg');
    expect(runtime.match(/postMessage\(/g)).toHaveLength(1);
  });

  it('el runtime solo aplica variables --lab-* con valores de color simples', () => {
    expect(runtime).toContain('^--lab-[a-z0-9-]+$');
    expect(runtime).toContain('SAFE_VALUE');
  });

  it('el iframe va aislado: scripts y descargas SI; mismo origen, formularios, ventanas y navegacion NO', () => {
    expect(frame).toContain('sandbox="allow-scripts allow-downloads"');
    for (const bad of ['allow-same-origin', 'allow-forms', 'allow-popups', 'allow-top-navigation', 'allow-modals', 'allow-pointer-lock']) expect(frame, bad).not.toContain(bad);
    expect(frame).toContain('referrerPolicy="no-referrer"');
  });

  it('el componente solo atiende al iframe propio y valida todo con parseLabMessage', () => {
    expect(frame).toContain('e.source !== ref.current?.contentWindow');
    expect(frame).toContain('parseLabMessage(e.data)');
  });

  it('los archivos de public/labs se pueden leer sin sesion (el iframe aislado no manda cookies) pero no abren nada mas', () => {
    expect(isPublicAsset('/labs/trayectoria.html')).toBe(true);
    expect(isPublicAsset('/labs/runtime.js')).toBe(true);
    expect(isPublicAsset('/labs/models/multiplicador.js')).toBe(true);
    expect(isPublicAsset('/labs/')).toBe(false);
    expect(isPublicAsset('/labs/../api/study')).toBe(false);
    expect(isPublicAsset('/api/labs/x')).toBe(false);
  });
});

describe('runtime.css', () => {
  const css = read('public/labs/runtime.css');
  it('los colores salen de variables --lab-* (el tema de la app) y respeta el movimiento reducido y el foco', () => {
    expect(css).toContain('--lab-primary');
    expect(css).toContain('prefers-reduced-motion: no-preference');
    expect(css).toContain(':focus-visible');
    const sinVariables = css.replace(/:root\s*\{[\s\S]*?\}/, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sinVariables, 'fuera de :root no hay colores escritos').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it('los controles tienen alto tactil (>= 2,75 rem = 44 px)', () => {
    expect(css).toMatch(/\.lab-btn \{[^}]*min-height: 2\.75rem/);
    expect(css).toMatch(/input\[type='range'\][^}]*height: 2\.75rem/);
  });
});
