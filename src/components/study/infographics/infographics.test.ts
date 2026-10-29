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

import { InfographicView } from '../InfographicView';
import {
  DEFAULT_INFOGRAPHIC_TEMPLATE, INFOGRAPHIC_CATEGORY_LABEL, INFOGRAPHIC_TEMPLATES, SAMPLE_INFOGRAPHICS, getInfographicTemplate, isInfographicTemplateId,
  normalizeInfographicTemplate, type InfographicItem,
} from '@/lib/study/infographicTemplates';
import { FICHA_THEME_IDS } from '@/lib/study/fichaThemes';

const html = (item: InfographicItem, template?: string | null) =>
  renderToStaticMarkup(h(InfographicView, { title: item.title, section: item.section, data: item.data, template }));

// Todos los textos que debe mostrar una infografia, segun su tipo.
function textos(item: InfographicItem): string[] {
  const d = item.data;
  const out = [item.title];
  if (d.tipo === 'timeline') d.eventos.forEach((e) => out.push(e.cuando, e.titulo, e.detalle));
  if (d.tipo === 'comparison') {
    out.push(...d.columnas);
    d.filas.forEach((f) => out.push(f.criterio, ...f.valores));
  }
  if (d.tipo === 'process') d.pasos.forEach((p) => out.push(p.titulo, p.detalle));
  if (d.tipo === 'stats') d.cifras.forEach((c) => out.push(c.valor, c.etiqueta, c.nota));
  return out.filter(Boolean);
}

const TEMATICAS = INFOGRAPHIC_TEMPLATES.filter((t) => t.theme);

describe('catalogo de plantillas de infografias', () => {
  it('son 13 en 4 categorias, la clasica primero (la de siempre) y las demas con un tema de las fichas', () => {
    expect(INFOGRAPHIC_TEMPLATES).toHaveLength(13);
    expect(INFOGRAPHIC_TEMPLATES[0].id).toBe('clasica');
    expect(INFOGRAPHIC_TEMPLATES[0].theme).toBeNull();
    expect(DEFAULT_INFOGRAPHIC_TEMPLATE).toBe('clasica');
    const por = (c: string) => INFOGRAPHIC_TEMPLATES.filter((t) => t.category === c).length;
    expect([por('funcional'), por('infantil'), por('area'), por('estetica')]).toEqual([1, 2, 6, 4]);
    for (const t of TEMATICAS) expect(FICHA_THEME_IDS, t.id).toContain(t.theme);
    for (const c of ['funcional', 'infantil', 'area', 'estetica'] as const) expect(INFOGRAPHIC_CATEGORY_LABEL[c]).toBeTruthy();
  });

  it('usa los 12 temas, cada uno una vez, con ids unicos y la forma que acepta el CHECK de la migracion 077', () => {
    expect(new Set(TEMATICAS.map((t) => t.theme)).size).toBe(12);
    const ids = INFOGRAPHIC_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/077_classroom_infographic_template.sql'), 'utf8');
    expect(sql).toContain(String.raw`'^[a-z][a-z0-9-]{0,31}$'`);
    expect(sql).toContain(`DEFAULT '${DEFAULT_INFOGRAPHIC_TEMPLATE}'`);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS infographic_template/);
  });

  it('cada plantilla tiene nombre, descripcion y para que sirve', () => {
    for (const t of INFOGRAPHIC_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(2);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.bestFor.length).toBeGreaterThan(10);
    }
  });

  it('lo desconocido o ausente cae en la clasica; una plantilla de fichas o de mapa no es de infografias', () => {
    expect(normalizeInfographicTemplate('neon')).toBe('neon');
    for (const v of [null, undefined, '', 'inexistente', 'NEON', 4, {}]) expect(normalizeInfographicTemplate(v), String(v)).toBe('clasica');
    expect(isInfographicTemplateId('cornell')).toBe(false);
    expect(isInfographicTemplateId('bosque')).toBe(false);
    expect(getInfographicTemplate('inventada').id).toBe('clasica');
  });
});

describe('ejemplos de infografias', () => {
  it('hay uno de cada tipo, con los minimos que exige el validador', () => {
    expect(SAMPLE_INFOGRAPHICS.map((s) => s.data.tipo)).toEqual(['timeline', 'comparison', 'process', 'stats']);
    for (const s of SAMPLE_INFOGRAPHICS) {
      const d = s.data;
      if (d.tipo === 'timeline') expect(d.eventos.length).toBeGreaterThanOrEqual(3);
      if (d.tipo === 'comparison') {
        expect(d.columnas.length).toBeGreaterThanOrEqual(2);
        expect(d.filas.length).toBeGreaterThanOrEqual(2);
        for (const f of d.filas) expect(f.valores).toHaveLength(d.columnas.length);
      }
      if (d.tipo === 'process') expect(d.pasos.length).toBeGreaterThanOrEqual(3);
      if (d.tipo === 'stats') expect(d.cifras.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe.each(INFOGRAPHIC_TEMPLATES.map((t) => t.id))('plantilla de infografias %s', (id) => {
  it.each(SAMPLE_INFOGRAPHICS.map((s) => [s.data.tipo, s] as const))('muestra TODOS los datos de una infografia de tipo %s', (_tipo, item) => {
    const out = html(item, id);
    for (const t of textos(item)) expect(out, t).toContain(t);
    if (item.section) expect(out).toContain(item.section);
  });

  it('usa estructuras reales segun el tipo (lista, tabla con encabezados, lista de definiciones)', () => {
    expect(html(SAMPLE_INFOGRAPHICS[0], id)).toMatch(/<ol/);
    const tabla = html(SAMPLE_INFOGRAPHICS[1], id);
    expect(tabla).toContain('<table');
    expect(tabla).toContain('scope="col"');
    expect(tabla).toContain('scope="row"');
    expect(tabla).toContain('<caption');
    expect(html(SAMPLE_INFOGRAPHICS[2], id)).toMatch(/<ol/);
    expect(html(SAMPLE_INFOGRAPHICS[3], id)).toContain('<dl');
  });

  it('el titulo va en un h3 y el tipo se dice con texto', () => {
    for (const s of SAMPLE_INFOGRAPHICS) {
      const out = html(s, id);
      expect(out).toMatch(/<h3[^>]*>/);
      expect(out).toMatch(/Línea de tiempo|Comparativa|Proceso|Cifras clave/);
    }
  });

  it('sin colores escritos en las clases ni scripts', () => {
    for (const s of SAMPLE_INFOGRAPHICS) {
      const out = html(s, id);
      const sin = out.replace(/ style="[^"]*"/g, '');
      expect(sin).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(sin).not.toMatch(/(?:bg|text|border|ring|from|to|via)-\[/);
      expect(sin).not.toMatch(/(?:bg|text|border)-(?:white|black|gray|slate|zinc|neutral|red|green|blue|yellow|purple|pink|orange)-?\d*/);
      expect(out).not.toMatch(/<script|onclick|onerror/i);
    }
  });
});

describe('plantillas con tema', () => {
  it('el contenedor lleva solo variables --f-* y marca su tema y su tipo', () => {
    for (const t of TEMATICAS) {
      for (const s of SAMPLE_INFOGRAPHICS) {
        const out = html(s, t.id);
        const style = out.match(/^<figure class="fk fi[^"]*" style="([^"]*)"/)?.[1];
        expect(style, `${t.id} ${s.data.tipo}`).toBeTruthy();
        const css = style!.replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
        for (const d of css.split(';').filter(Boolean)) expect(d.split(':')[0].trim(), `${t.id}: ${d.slice(0, 30)}`).toMatch(/^--f-/);
        expect(out).toContain(`data-ficha-theme="${t.theme}"`);
        expect(out).toContain(`data-infographic-type="${s.data.tipo}"`);
      }
    }
  });

  it('los temas con fuente web cargan su variable; los de sistema, no', () => {
    expect(html(SAMPLE_INFOGRAPHICS[3], 'aventura')).toContain('mock-baloo');
    expect(html(SAMPLE_INFOGRAPHICS[0], 'archivo')).toContain('mock-playfair');
    expect(html(SAMPLE_INFOGRAPHICS[3], 'neon')).not.toMatch(/mock-baloo|mock-playfair/);
  });

  it('las cifras y los encabezados de la comparativa rotan los colores del tema', () => {
    const cifras = html(SAMPLE_INFOGRAPHICS[3], 'arcoiris');
    for (const n of [1, 2, 3]) expect(cifras).toContain(`fk-tile-${n}`);
    const tabla = html(SAMPLE_INFOGRAPHICS[1], 'arcoiris');
    expect(tabla).toContain('fi-c1');
    expect(tabla).toContain('fi-c2');
  });

  it('los pasos se numeran y dicen "Paso n" a los lectores de pantalla', () => {
    const out = html(SAMPLE_INFOGRAPHICS[2], 'cuadriculado');
    expect(out).toMatch(/class="fi-step-num">4<\/span>/);
    expect(out).toContain('Paso 1: ');
  });

  it('las formulas se pintan con KaTeX', () => {
    const f: InfographicItem = {
      id: 'x', title: 'Derivadas', section: null,
      data: { tipo: 'stats', titulo: 'Derivadas', cifras: [{ valor: '$x^2$', etiqueta: 'Funcion cuadratica', nota: '' }, { valor: '2', etiqueta: 'Derivada de x', nota: '' }] },
    };
    expect(html(f, 'plano')).toContain('katex');
  });
});

describe('InfographicView: la plantilla clasica sigue siendo la de siempre', () => {
  it('sin plantilla, con "clasica" o con un id desconocido se ve igual', () => {
    for (const s of SAMPLE_INFOGRAPHICS) {
      const base = html(s);
      for (const t of ['clasica', null, undefined, '', 'inexistente']) expect(html(s, t as string | null | undefined)).toBe(base);
    }
  });

  it('la clasica usa los colores de la app (clases del sistema de diseño), no variables de tema', () => {
    const out = html(SAMPLE_INFOGRAPHICS[3]);
    expect(out).toContain('text-primary-text');
    expect(out).not.toContain('--f-');
    expect(out).not.toContain('data-ficha-theme');
  });

  it('todas las plantillas se ven distintas entre si', () => {
    for (const s of SAMPLE_INFOGRAPHICS) {
      const salidas = INFOGRAPHIC_TEMPLATES.map((t) => html(s, t.id));
      expect(new Set(salidas).size, s.data.tipo).toBe(INFOGRAPHIC_TEMPLATES.length);
    }
  });
});

describe('el CSS de las infografias no lleva colores propios (todo viene del tema)', () => {
  const css = fs
    .readFileSync(path.join(process.cwd(), 'src/components/study/infographics/infographicThemes.css'), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('sin hex, rgb(), hsl() ni nombres de color', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/);
    expect(css).not.toMatch(/:\s*(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey)\b/);
  });

  it('no tiene animaciones ni transiciones y prepara la impresion', () => {
    expect(css).not.toMatch(/animation:|transition:/);
    expect(css).toContain('@media print');
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
