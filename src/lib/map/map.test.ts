import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DEFAULT_MAP_TEMPLATE, MAP_CATEGORY_LABEL, MAP_TEMPLATES, isMapTemplateId, normalizeMapTemplate, type MapCategory } from './mapTemplates';
import { columnsFor, groupByCategory, orderNodes, serpentine } from './mapLayouts';
import { GENERAL_SECTION_ID, buildMapSections, buildNodes, defaultSectionId, type ModuleRow, type ProgressRow } from './mapSections';
import { getMapTheme } from './mapThemes';
import { FICHA_THEME_IDS } from '@/lib/study/fichaThemes';
import type { MapNode } from './types';

const node = (id: string, over: Partial<MapNode> = {}): MapNode => ({
  id, title: `Modulo ${id}`, category: 'math', difficulty: 1, order: 0, x: 500, y: 200, prerequisites: [], status: 'available', score: null, completionPct: 0, isCurrent: false, ...over,
});

const mod = (id: string, over: Partial<ModuleRow> = {}): ModuleRow => ({
  id, title: `Modulo ${id}`, category: 'math', difficulty_level: 1, order_index: 0, map_position_x: 500, map_position_y: 200, prerequisites: [], classroom_id: null, ...over,
});

describe('catalogo de plantillas del mapa', () => {
  it('son 14 en 4 categorias: la de siempre primero, y el resto con estructura y tema validos', () => {
    expect(MAP_TEMPLATES).toHaveLength(14);
    expect(MAP_TEMPLATES[0].id).toBe('islas');
    expect(DEFAULT_MAP_TEMPLATE).toBe('islas');
    const por = (c: MapCategory) => MAP_TEMPLATES.filter((t) => t.category === c).length;
    expect([por('funcional'), por('infantil'), por('area'), por('estetica')]).toEqual([2, 2, 6, 4]);
    for (const t of MAP_TEMPLATES) {
      expect(['islas', 'camino', 'metro', 'tablero']).toContain(t.layout);
      if (t.layout === 'islas') expect(t.theme).toBeNull();
      else expect(getMapTheme(t.theme), t.id).not.toBeNull();
    }
  });

  it('ids unicos y con la forma que acepta el CHECK de la migracion 076', () => {
    const ids = MAP_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/076_classroom_map_template.sql'), 'utf8');
    expect(sql).toContain(String.raw`'^[a-z][a-z0-9-]{0,31}$'`);
    expect(sql).toContain(`DEFAULT '${DEFAULT_MAP_TEMPLATE}'`);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS map_template/);
  });

  it('cada plantilla tiene nombre, descripcion y para que sirve; hay nombre para cada categoria', () => {
    for (const t of MAP_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(2);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.bestFor.length).toBeGreaterThan(8);
    }
    for (const c of ['funcional', 'infantil', 'area', 'estetica'] as const) expect(MAP_CATEGORY_LABEL[c]).toBeTruthy();
  });

  it('usa varios temas de las fichas y hay variedad de estructuras', () => {
    const temas = new Set<string | null>(MAP_TEMPLATES.map((t) => t.theme));
    expect(temas.size).toBeGreaterThanOrEqual(10);
    Array.from(temas).forEach((t) => {
      if (t && t !== 'app') expect(FICHA_THEME_IDS).toContain(t);
    });
    expect(new Set(MAP_TEMPLATES.map((t) => t.layout)).size).toBe(4);
  });

  it('normalizeMapTemplate: lo desconocido o ausente cae en el mapa de siempre', () => {
    expect(normalizeMapTemplate('neon')).toBe('neon');
    for (const v of [null, undefined, '', 'inexistente', 'NEON', 3, {}]) expect(normalizeMapTemplate(v), String(v)).toBe('islas');
    expect(isMapTemplateId('bosque')).toBe(true);
    expect(isMapTemplateId('clasica')).toBe(false); // una plantilla de FICHAS no es de mapa
  });
});

describe('getMapTheme', () => {
  it('"app" es adaptable: todo apunta a los colores de la app, ni un hex', () => {
    const t = getMapTheme('app')!;
    for (const [k, v] of Object.entries(t.vars)) {
      if (/^--f-(bg|card|fg|muted|line|accent|on-accent|accent-text|t\d-(bg|fg))$/.test(k)) expect(v, k).toMatch(/^rgb\(var\(--c-/);
    }
    expect(JSON.stringify(t.vars)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('los temas de las fichas se reutilizan y lo desconocido da null', () => {
    expect(getMapTheme('neon')?.vars['--f-bg']).toBe('#0A0A1A');
    expect(getMapTheme('inventado')).toBeNull();
    expect(getMapTheme(null)).toBeNull();
  });
});

describe('orderNodes', () => {
  it('un modulo va despues de sus prerrequisitos, sea cual sea su orden', () => {
    const a = node('a', { order: 3 });
    const b = node('b', { order: 1, prerequisites: ['a'] });
    const c = node('c', { order: 2, prerequisites: ['b'] });
    expect(orderNodes([c, b, a]).map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('a igual condicion, por su orden y luego por titulo', () => {
    const x = node('x', { order: 2, title: 'Zeta' });
    const y = node('y', { order: 1, title: 'Beta' });
    const z = node('z', { order: 1, title: 'Alfa' });
    expect(orderNodes([x, y, z]).map((n) => n.id)).toEqual(['z', 'y', 'x']);
  });

  it('no pierde ningun modulo con ciclos, prerrequisitos que no existen o ids repetidos en los prerrequisitos', () => {
    const a = node('a', { prerequisites: ['b'], order: 1 });
    const b = node('b', { prerequisites: ['a'], order: 2 });
    const c = node('c', { prerequisites: ['fantasma', 'c'], order: 3 });
    const out = orderNodes([a, b, c]);
    expect(out.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
    expect(out).toHaveLength(3);
  });

  it('lista vacia -> vacia', () => expect(orderNodes([])).toEqual([]));
});

describe('groupByCategory', () => {
  it('agrupa por tema, cada grupo en orden de recorrido, con sus conteos', () => {
    const ns = [
      node('a', { category: 'math', order: 1, status: 'completed' }),
      node('b', { category: 'science', order: 2 }),
      node('c', { category: 'math', order: 3, status: 'completed', prerequisites: ['a'] }),
      node('d', { category: 'math', order: 4 }),
    ];
    const g = groupByCategory(ns);
    expect(g.map((x) => x.category)).toEqual(['math', 'science']);
    expect(g[0].nodes.map((n) => n.id)).toEqual(['a', 'c', 'd']);
    expect([g[0].completed, g[0].total, g[1].completed, g[1].total]).toEqual([2, 3, 0, 1]);
  });
});

describe('serpentine (camino que serpentea)', () => {
  const ordered = Array.from({ length: 7 }, (_, i) => node(`n${i}`, { order: i }));

  it('la primera fila va de izquierda a derecha, la segunda de derecha a izquierda', () => {
    const { placed } = serpentine(ordered, 3);
    expect(placed.slice(0, 3).map((p) => p.col)).toEqual([0, 1, 2]);
    expect(placed.slice(3, 6).map((p) => p.col)).toEqual([2, 1, 0]);
    expect(placed[6].col).toBe(0);
    expect(placed.map((p) => p.row)).toEqual([0, 0, 0, 1, 1, 1, 2]);
  });

  it('todos los nodos quedan dentro del lienzo y no se pisan', () => {
    for (const cols of [1, 2, 3, 4, 5]) {
      const { placed, height } = serpentine(ordered, cols);
      const seen = new Set<string>();
      for (const p of placed) {
        expect(p.x).toBeGreaterThanOrEqual(10);
        expect(p.x).toBeLessThanOrEqual(90);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(height);
        const k = `${p.x.toFixed(2)}-${p.y}`;
        expect(seen.has(k), `${cols} columnas: ${k}`).toBe(false);
        seen.add(k);
      }
    }
  });

  it('un tramo une cada nodo con el siguiente; el giro baja por el borde correcto', () => {
    const { segments } = serpentine(ordered, 3);
    expect(segments).toHaveLength(6);
    expect(segments.filter((s) => s.kind === 'turn').map((s) => s.side)).toEqual(['right', 'left']);
    for (const s of segments) expect(s.to.node.id).toBe(`n${Number(s.from.node.id.slice(1)) + 1}`);
  });

  it('con una sola columna es una fila de nodos centrados; sin nodos, no hay nada', () => {
    const one = serpentine(ordered, 1);
    expect(one.placed.every((p) => p.x === 50)).toBe(true);
    const none = serpentine([], 3);
    expect(none.placed).toEqual([]);
    expect(none.segments).toEqual([]);
    expect(none.rows).toBe(0);
  });

  it('la altura crece con las filas', () => {
    expect(serpentine(ordered, 3).rows).toBe(3);
    expect(serpentine(ordered, 3).height).toBeGreaterThan(serpentine(ordered, 5).height);
  });

  it('columnsFor: 3 en celular, 4 y 5 en pantallas mas anchas', () => {
    expect([columnsFor(320), columnsFor(699), columnsFor(700), columnsFor(999), columnsFor(1000)]).toEqual([3, 3, 4, 4, 5]);
  });
});

describe('buildNodes (estado de cada modulo)', () => {
  const progress: ProgressRow[] = [
    { module_id: 'm1', status: 'completed', best_score: 90, completion_percentage: 100 },
    { module_id: 'm2', status: 'in_progress', best_score: null, completion_percentage: 40 },
  ];

  it('completado, en curso, disponible (sin prerrequisitos o con los cumplidos) y bloqueado', () => {
    const out = buildNodes([mod('m1'), mod('m2'), mod('m3', { prerequisites: ['m1'] }), mod('m4', { prerequisites: ['m2'] }), mod('m5')], progress);
    const st = Object.fromEntries(out.map((o) => [o.node.id, o.node.status]));
    expect(st).toEqual({ m1: 'completed', m2: 'in_progress', m3: 'available', m4: 'locked', m5: 'available' });
  });

  it('marca el modulo en curso, el puntaje y el avance; y tolera datos faltantes', () => {
    const out = buildNodes([mod('m1'), mod('m2', { difficulty_level: null, order_index: null, map_position_x: null, map_position_y: null, prerequisites: null })], progress);
    expect(out[0].node.score).toBe(90);
    expect(out[1].node.isCurrent).toBe(true);
    expect(out[1].node.completionPct).toBe(40);
    expect(out[1].node).toMatchObject({ difficulty: 1, order: 0, x: 500, y: 200, prerequisites: [] });
  });

  it('conserva la clase de cada modulo', () => {
    expect(buildNodes([mod('m1', { classroom_id: 'c1' })], [])[0].classroomId).toBe('c1');
  });
});

describe('buildMapSections (una seccion por clase)', () => {
  const classrooms = [
    { id: 'c2', name: 'Quimica 10', map_template: 'laboratorio' },
    { id: 'c1', name: 'Biologia 9', map_template: 'bosque' },
    { id: 'c3', name: 'Sin modulos', map_template: 'neon' },
  ];
  const items = buildNodes(
    [mod('a', { classroom_id: 'c1' }), mod('b', { classroom_id: 'c1' }), mod('c', { classroom_id: 'c2' }), mod('g1'), mod('x', { classroom_id: 'c9' })],
    [{ module_id: 'a', status: 'completed', best_score: 80, completion_percentage: 100 }],
  );

  it('una seccion por clase en orden alfabetico, cada una con la plantilla de su profesor', () => {
    const s = buildMapSections(items, classrooms);
    expect(s.map((x) => x.title)).toEqual(['Biologia 9', 'Quimica 10', 'Módulos generales']);
    expect(s.map((x) => x.template)).toEqual(['bosque', 'laboratorio', 'islas']);
    expect([s[0].total, s[0].completed]).toEqual([2, 1]);
  });

  it('una clase sin modulos no genera seccion', () => {
    expect(buildMapSections(items, classrooms).some((s) => s.id === 'c3')).toBe(false);
  });

  it('los modulos sin clase, o de una clase que no esta en la lista, van a "Modulos generales" y ninguno se pierde', () => {
    const s = buildMapSections(items, classrooms);
    const general = s.find((x) => x.id === GENERAL_SECTION_ID)!;
    expect(general.general).toBe(true);
    expect(general.nodes.map((n) => n.id).sort()).toEqual(['g1', 'x']);
    expect(s.reduce((n, x) => n + x.total, 0)).toBe(5);
  });

  it('una plantilla desconocida o ausente en la clase usa el mapa de siempre', () => {
    const s = buildMapSections(items, [{ id: 'c1', name: 'A', map_template: 'retirada' }, { id: 'c2', name: 'B' }]);
    expect(s.filter((x) => !x.general).map((x) => x.template)).toEqual(['islas', 'islas']);
  });

  it('sin modulos no hay secciones', () => expect(buildMapSections([], classrooms)).toEqual([]));
});

describe('defaultSectionId', () => {
  const sec = (id: string, st: MapNode['status'][]) => ({ id, title: id, template: 'islas' as const, nodes: st.map((s, i) => node(`${id}${i}`, { status: s })), total: st.length, completed: 0, general: false });

  it('abre la seccion con un modulo en curso; si no, la primera con algo disponible; si no, la primera', () => {
    expect(defaultSectionId([sec('a', ['available']), sec('b', ['in_progress'])])).toBe('b');
    expect(defaultSectionId([sec('a', ['locked']), sec('b', ['available'])])).toBe('b');
    expect(defaultSectionId([sec('a', ['completed']), sec('b', ['locked'])])).toBe('a');
    expect(defaultSectionId([])).toBeNull();
  });
});
