import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// next/font/google solo existe dentro del compilador de Next: aqui se sustituye por clases de mentira.
vi.mock('next/font/google', () => ({
  Baloo_2: () => ({ variable: 'mock-baloo' }),
  Playfair_Display: () => ({ variable: 'mock-playfair' }),
}));

import { ThemedMap } from './ThemedMap';
import { MapSections } from '@/app/(student)/map/MapSections';
import { MAP_TEMPLATES } from '@/lib/map/mapTemplates';
import { buildMapSections, type NodeWithClass } from '@/lib/map/mapSections';
import type { CategoryMeta, MapNode } from '@/lib/map/types';

const META: Record<string, CategoryMeta> = {
  math: { label: 'Matemáticas', color: '#6C5CE7', emoji: '🔢', gradient: ['#6C5CE7', '#a29bfe'] },
  science: { label: 'Ciencias', color: '#00D2D3', emoji: '🔬', gradient: ['#00D2D3', '#55E6C1'] },
};

const n = (id: string, over: Partial<MapNode>): MapNode => ({
  id, title: `Titulo ${id}`, category: 'math', difficulty: 2, order: 0, x: 500, y: 200, prerequisites: [], status: 'available', score: null, completionPct: 0, isCurrent: false, ...over,
});

const NODES: MapNode[] = [
  n('a', { order: 1, status: 'completed', score: 90, completionPct: 100 }),
  n('b', { order: 2, status: 'in_progress', prerequisites: ['a'], completionPct: 40, isCurrent: true }),
  n('c', { order: 3, status: 'available' }),
  n('d', { order: 4, status: 'locked', prerequisites: ['b', 'c'] }),
  n('e', { order: 1, category: 'science', status: 'available' }),
  n('f', { order: 2, category: 'science', status: 'locked', prerequisites: ['e'] }),
  n('g', { order: 1, category: 'categoria-nueva', status: 'available' }),
];

const render = (templateId: string) => {
  const t = MAP_TEMPLATES.find((x) => x.id === templateId)!;
  return renderToStaticMarkup(h(ThemedMap, { nodes: NODES, categoryMeta: META, layout: t.layout, themeId: t.theme!, stats: { total: 7, completed: 1 }, interactive: false }));
};

const THEMED = MAP_TEMPLATES.filter((t) => t.layout !== 'islas');

describe.each(THEMED.map((t) => t.id))('plantilla de mapa %s', (id) => {
  const out = render(id);

  it('muestra TODOS los modulos, tambien los de una categoria sin metadatos', () => {
    for (const x of NODES) expect(out, x.id).toContain(`Titulo ${x.id}`);
  });

  it('cada modulo es un boton que dice su estado con texto; los bloqueados siguen siendo enfocables (aria-disabled)', () => {
    for (const x of NODES) {
      const estado = { completed: 'completado', in_progress: 'en curso', available: 'disponible', locked: 'bloqueado', current: 'en curso' }[x.status];
      const m = out.match(new RegExp(`<button[^>]*aria-label="Titulo ${x.id}, ${estado}"[^>]*>`));
      expect(m, `${x.id} ${estado}`).not.toBeNull();
      expect(m![0].includes('aria-disabled="true"'), x.id).toBe(x.status === 'locked');
      expect(m![0]).not.toMatch(/\sdisabled(=|\s|>)/);
    }
  });

  it('el estado tambien se ve en texto (no solo color)', () => {
    for (const t of ['completado', 'en curso', 'disponible', 'bloqueado']) expect(out.toLowerCase()).toContain(t);
  });

  it('el contenedor lleva solo variables --f-* y marca su estructura y su tema', () => {
    const t = MAP_TEMPLATES.find((x) => x.id === id)!;
    const style = out.match(/^<div class="fk fm[^"]*" style="([^"]*)"/)?.[1];
    expect(style).toBeTruthy();
    const css = style!.replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
    for (const d of css.split(';').filter(Boolean)) expect(d.split(':')[0].trim(), d.slice(0, 40)).toMatch(/^--f-/);
    expect(out).toContain(`data-map-layout="${t.layout}"`);
    expect(out).toContain(`data-map-theme="${t.theme}"`);
  });

  it('los colores no estan escritos en las clases (o son los del sistema o variables del tema)', () => {
    const sin = out.replace(/ style="[^"]*"/g, '');
    expect(sin).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(sin).not.toMatch(/(?:bg|text|border|ring|from|to|via)-\[/);
    expect(sin).not.toMatch(/(?:bg|text|border)-(?:white|black|gray|slate|zinc|neutral|red|green|blue|yellow|purple|pink|orange)-?\d*/);
  });

  it('los iconos son decorativos y no hay emojis como iconos', () => {
    for (const svg of out.match(/<svg[^>]*>/g) ?? []) expect(svg).toContain('aria-hidden="true"');
    expect(out).not.toMatch(/[☀-➿]|[\uD83C-\uD83E][\uDC00-\uDFFF]/);
  });

  it('tiene encabezado, barra de progreso con valores y leyenda', () => {
    expect(out).toMatch(/<h2 class="fm-title">Mapa de Aprendizaje<\/h2>/);
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuenow="14"'); // 1 de 7
    expect(out).toContain('aria-label="Leyenda del mapa"');
    expect(out).toContain('1 de 7 módulos completados');
  });

  it('sin scripts ni manejadores de eventos en el HTML', () => {
    expect(out).not.toMatch(/<script|onclick|onerror/i);
  });
});

describe('estructuras', () => {
  it('camino: un tramo de camino entre cada par de modulos y las paradas numeradas', () => {
    const out = render('camino-aventura');
    // Los iconos tambien usan <path>: se cuentan los tramos del camino por su clase.
    expect((out.match(/class="fm-road-(?:done|todo)"/g) ?? []).length).toBe(NODES.length - 1);
    expect(out).toContain('fm-road-done');
    expect(out).toContain('fm-road-todo');
    expect(out).toMatch(/viewBox="0 0 100 \d+"/);
  });

  it('camino: los tramos ya recorridos (desde un modulo completado) van en color de avance', () => {
    const out = render('camino-aventura');
    expect((out.match(/fm-road-done/g) ?? []).length).toBe(1); // solo 'a' esta completado
  });

  it('metro: una linea por tema, con sus estaciones y lo que cada modulo requiere', () => {
    const out = render('neon');
    expect((out.match(/<section class="fk-card fm-line"/g) ?? []).length).toBe(3); // math, science, categoria-nueva
    expect(out).toContain('Matemáticas');
    expect(out).toContain('categoria-nueva');
    expect(out).toContain('Requiere: Titulo b, Titulo c');
    expect(out).toContain('<ol class="fm-stations">');
  });

  it('tablero: una tarjeta por modulo con dificultad y puntaje', () => {
    const out = render('brutalista');
    expect((out.match(/fm-card-btn/g) ?? []).length).toBe(NODES.length);
    expect(out).toContain('Mejor puntaje: 90');
    expect(out).toContain('Sin puntaje');
    expect(out).toContain('aria-label="Dificultad 2 de 3"');
    expect(out).toContain('1/4 completados');
  });

  it('el tablero funcional usa los colores de la app (se adapta a claro y oscuro)', () => {
    const out = render('tablero');
    expect(out).toContain('rgb(var(--c-surface))');
    expect(out).not.toContain('#');
  });

  it('un tema con fuente web carga su variable; uno de sistema, no', () => {
    expect(render('camino-aventura')).toContain('mock-baloo');
    expect(render('biblioteca')).toContain('mock-playfair');
    expect(render('neon')).not.toMatch(/mock-baloo|mock-playfair/);
  });

  it('un mapa sin modulos no rompe', () => {
    const out = renderToStaticMarkup(h(ThemedMap, { nodes: [], categoryMeta: META, layout: 'camino', themeId: 'aventura', stats: { total: 0, completed: 0 }, interactive: false }));
    expect(out).toContain('0 de 0 módulos completados');
    expect(out).toContain('aria-valuenow="0"');
  });

  it('un tema o estructura desconocidos no pintan nada (no rompen la pagina)', () => {
    expect(renderToStaticMarkup(h(ThemedMap, { nodes: NODES, categoryMeta: META, layout: 'camino', themeId: 'inventado', stats: { total: 7, completed: 1 } }))).toBe('');
  });
});

describe('MapSections (una seccion por clase)', () => {
  const items = (clase: string | null, ids: string[]): NodeWithClass[] => ids.map((id) => ({ classroomId: clase, node: n(id, { order: 1 }) }));
  const dosClases = buildMapSections([...items('c1', ['p', 'q']), ...items('c2', ['r']), ...items(null, ['s'])], [
    { id: 'c1', name: 'Biologia 9', map_template: 'bosque' },
    { id: 'c2', name: 'Quimica 10', map_template: 'laboratorio' },
  ]);
  const html = (sections = dosClases) => renderToStaticMarkup(h(MapSections, { sections, categoryMeta: META }));

  it('con varias clases: pestañas accesibles, una por seccion, y solo el panel de la activa', () => {
    const out = html();
    expect(out).toContain('role="tablist"');
    expect((out.match(/role="tab"/g) ?? []).length).toBe(3);
    expect(out).toContain('Biologia 9');
    expect(out).toContain('Quimica 10');
    expect(out).toContain('Módulos generales');
    expect((out.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect((out.match(/role="tabpanel"/g) ?? []).length).toBe(1);
    expect(out).toContain('aria-controls="panel-map"');
  });

  it('la pestaña activa es enfocable y las demas no (flechas para moverse)', () => {
    const out = html();
    expect((out.match(/tabindex="0"/g) ?? []).length).toBe(1);
    expect((out.match(/tabindex="-1"/g) ?? []).length).toBe(2);
  });

  it('el encabezado de la pagina es el unico h1 y la seccion activa usa h2', () => {
    const out = html();
    expect((out.match(/<h1/g) ?? []).length).toBe(1);
    expect(out).toMatch(/<h2/);
  });

  it('el total junta todas las clases', () => {
    expect(html()).toContain('0 de 4 módulos completados en 3 clases');
  });

  it('con una sola clase no hay pestañas y se pinta con la plantilla de esa clase', () => {
    const una = buildMapSections(items('c1', ['p', 'q']), [{ id: 'c1', name: 'Biologia 9', map_template: 'neon' }]);
    const out = html(una);
    expect(out).not.toContain('role="tablist"');
    expect(out).toContain('data-map-theme="neon"');
    expect(out).toContain('Mapa de Aprendizaje · Biologia 9');
    expect((out.match(/<h1/g) ?? []).length).toBe(1);
  });

  it('solo modulos generales: el mapa de islas de siempre, con su titulo de siempre', () => {
    const out = html(buildMapSections(items(null, ['s', 't']), []));
    expect(out).not.toContain('role="tablist"');
    expect(out).toContain('Mapa de Aprendizaje');
    expect(out).not.toContain('data-map-theme');
  });

  it('sin modulos, lo dice en vez de quedar en blanco', () => {
    expect(html([])).toContain('Todavía no hay módulos');
  });
});

describe('el CSS del mapa no lleva colores propios (todo viene del tema)', () => {
  // Los saltos de linea se normalizan: segun la configuracion de Git el archivo puede venir con CRLF.
  const css = fs.readFileSync(path.join(process.cwd(), 'src/components/map/mapThemes.css'), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');

  it('sin hex, rgb(), hsl() ni nombres de color', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/);
    expect(css).not.toMatch(/:\s*(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey)\b/);
  });

  it('el movimiento solo si el sistema lo permite, foco visible e impresion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media print');
    // Las animaciones y transiciones viven dentro de la consulta de movimiento.
    const fuera = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/, '');
    expect(fuera).not.toMatch(/animation:|transition:/);
  });

  it('usa solo variables que el tema define', () => {
    const base = fs.readFileSync(path.join(process.cwd(), 'src/lib/study/fichaThemes.ts'), 'utf8');
    const usadas = Array.from(new Set(css.match(/var\(--f-[a-z0-9-]+/g) ?? [])).map((s) => s.slice(4));
    expect(usadas.length).toBeGreaterThan(15);
    for (const v of usadas) {
      if (/^--f-t\d-(bg|fg)$/.test(v)) continue; // se generan por mosaico
      expect(base, v).toContain(`'${v}'`);
    }
  });
});
