import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FichaList } from './FichaViews';
import { FICHA_TEMPLATES, SAMPLE_FICHAS, type FichaData } from '@/lib/study/fichaTemplates';

const html = (fichas: FichaData[], template?: string | null) => renderToStaticMarkup(h(FichaList, { fichas, template }));

// Texto plano de lo que debe verse de una ficha (sin las formulas, que KaTeX parte en pedazos).
const textos = (f: FichaData) => [
  f.front,
  f.back,
  ...(f.extra?.puntos_clave ?? []),
  ...(f.extra?.terminos ?? []).flatMap((t) => [t.termino, t.definicion]),
  f.extra?.reflexion ?? '',
];

const SIN_FORMULA = SAMPLE_FICHAS[0];
const CON_FORMULA = SAMPLE_FICHAS[1];

describe.each(FICHA_TEMPLATES.map((t) => t.id))('plantilla %s', (id) => {
  it('muestra TODOS los campos de la ficha (la plantilla solo cambia como se ve, no el contenido)', () => {
    const out = html([SIN_FORMULA], id);
    for (const t of textos(SIN_FORMULA)) expect(out, t).toContain(t);
    expect(out).toContain(SIN_FORMULA.section!);
  });

  it('muestra todas las fichas, en orden', () => {
    const out = html(SAMPLE_FICHAS, id);
    expect(out.indexOf(SAMPLE_FICHAS[0].front)).toBeGreaterThan(-1);
    expect(out.indexOf(SAMPLE_FICHAS[1].front)).toBeGreaterThan(out.indexOf(SAMPLE_FICHAS[0].front));
  });

  it('pinta las formulas con KaTeX', () => {
    expect(html([CON_FORMULA], id)).toContain('katex');
  });

  it('una ficha sin extras (solo titulo e idea) se ve bien y no rompe', () => {
    const minima: FichaData = { id: 'm', section: null, front: 'Solo titulo', back: 'Solo una idea principal de la ficha.', extra: null };
    const out = html([minima], id);
    expect(out).toContain('Solo titulo');
    expect(out).toContain('Solo una idea principal de la ficha.');
    expect(out).not.toMatch(/undefined|null|NaN/);
  });

  it('usa solo los colores del sistema (cambian con el tema claro/oscuro): sin hex ni colores a mano', () => {
    const out = html(SAMPLE_FICHAS, id);
    // KaTeX trae sus propios estilos en linea; se revisa solo el HTML de las plantillas, sin el de las formulas.
    const sinFormulas = out.replace(/<span class="katex[\s\S]*?<\/span><\/span><\/span>/g, '');
    expect(sinFormulas).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(sinFormulas).not.toMatch(/(?:bg|text|border|ring|from|to|via)-\[/);
    expect(sinFormulas).not.toMatch(/(?:bg|text|border)-(?:white|black|gray|slate|zinc|neutral|red|green|blue|yellow|purple|pink|orange)-?\d*/);
  });

  it('no depende de JavaScript propio: ningun manejador de eventos ni script', () => {
    const out = html(SAMPLE_FICHAS, id);
    expect(out).not.toMatch(/<script|onclick|onerror/i);
  });

  it('usa listas reales para los puntos (lectores de pantalla)', () => {
    expect(html([SIN_FORMULA], id)).toMatch(/<ul|<ol/);
  });
});

describe('encabezados', () => {
  it('Tarjeta, Cornell y Compacta ponen el titulo de cada ficha en un h3', () => {
    for (const id of ['tarjeta', 'cornell', 'compacta']) {
      const out = html(SAMPLE_FICHAS, id);
      expect(out.match(/<h3/g)?.length, id).toBe(SAMPLE_FICHAS.length);
    }
  });

  it('Cornell tiene sus tres partes: pistas, notas y resumen', () => {
    const out = html([SIN_FORMULA], 'cornell');
    for (const parte of ['Pistas', 'Notas', 'Resumen']) expect(out).toContain(parte);
  });

  it('Cornell sin terminos ni reflexion no deja la columna de pistas vacia', () => {
    const f: FichaData = { ...SIN_FORMULA, extra: { puntos_clave: SIN_FORMULA.extra!.puntos_clave } };
    const out = html([f], 'cornell');
    expect(out).not.toContain('Pistas');
    expect(out).toContain('Notas');
  });
});

describe('FichaList', () => {
  it('sin fichas, avisa en vez de quedar en blanco', () => {
    expect(html([], 'tarjeta')).toContain('no produjo fichas');
  });

  it('un id desconocido o ausente se pinta como la clasica', () => {
    const clasica = html(SAMPLE_FICHAS, 'clasica');
    for (const t of [null, undefined, '', 'inexistente']) expect(html(SAMPLE_FICHAS, t)).toBe(clasica);
  });

  it('las plantillas son distintas entre si', () => {
    const salidas = FICHA_TEMPLATES.map((t) => html(SAMPLE_FICHAS, t.id));
    expect(new Set(salidas).size).toBe(FICHA_TEMPLATES.length);
  });
});
