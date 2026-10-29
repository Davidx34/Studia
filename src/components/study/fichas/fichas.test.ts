import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// next/font/google solo existe dentro del compilador de Next: aqui se sustituye por clases de mentira.
vi.mock('next/font/google', () => ({
  Baloo_2: () => ({ variable: 'mock-baloo' }),
  Playfair_Display: () => ({ variable: 'mock-playfair' }),
}));

import { FichaList } from './FichaViews';
import { initialOf } from './ThemedLayouts';
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

  it('los colores NO estan escritos en las clases: o son los del sistema o llegan como variables del tema', () => {
    const out = html(SAMPLE_FICHAS, id);
    // Se quitan los estilos en linea: los de KaTeX son suyos y los del tema (--f-*) se revisan aparte.
    const sinEstilos = out.replace(/ style="[^"]*"/g, '');
    expect(sinEstilos).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(sinEstilos).not.toMatch(/(?:bg|text|border|ring|from|to|via)-\[/);
    expect(sinEstilos).not.toMatch(/(?:bg|text|border)-(?:white|black|gray|slate|zinc|neutral|red|green|blue|yellow|purple|pink|orange)-?\d*/);
  });

  it('no depende de JavaScript propio: ningun manejador de eventos ni script', () => {
    expect(html(SAMPLE_FICHAS, id)).not.toMatch(/<script|onclick|onerror/i);
  });

  it('usa listas reales para los puntos (lectores de pantalla)', () => {
    expect(html([SIN_FORMULA], id)).toMatch(/<ul|<ol/);
  });

  it('el titulo de cada ficha va en un encabezado h3 (la clasica lo pone dentro de su resumen desplegable)', () => {
    const out = html(SAMPLE_FICHAS, id);
    if (id === 'clasica') return;
    expect(out.match(/<h3/g)?.length ?? 0).toBeGreaterThanOrEqual(SAMPLE_FICHAS.length);
  });
});

describe('plantillas con tema', () => {
  const conTema = FICHA_TEMPLATES.filter((t) => t.theme);

  it('el contenedor lleva solo variables --f-* (y la fuente), nunca colores sueltos', () => {
    for (const t of conTema) {
      const out = html([SIN_FORMULA], t.id);
      const style = out.match(/^<div class="fk[^"]*" style="([^"]*)"/)?.[1];
      expect(style, t.id).toBeTruthy();
      // El HTML escapa las comillas (&#x27; y &quot;): se deshace antes de separar las declaraciones.
      const css = style!.replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
      const props = css.split(';').filter(Boolean).map((d) => d.split(':')[0].trim());
      for (const p of props) expect(p, `${t.id} ${p}`).toMatch(/^--f-/);
      expect(props).toContain('--f-fg');
      expect(props).toContain('--f-card');
    }
  });

  it('marca su estructura y su tema (para depurar y para las pruebas)', () => {
    for (const t of conTema) {
      const out = html([SIN_FORMULA], t.id);
      expect(out).toContain(`data-ficha-theme="${t.theme}"`);
      expect(out).toContain(`data-ficha-layout="${t.layout}"`);
    }
  });

  it('los temas con fuente web cargan la variable de esa fuente', () => {
    expect(html([SIN_FORMULA], 'aventura')).toContain('mock-baloo');
    expect(html([SIN_FORMULA], 'libro')).toContain('mock-playfair');
    expect(html([SIN_FORMULA], 'neon')).not.toMatch(/mock-baloo|mock-playfair/);
  });

  it('los iconos son decorativos (aria-hidden) y no hay emojis como iconos', () => {
    for (const t of conTema) {
      const out = html(SAMPLE_FICHAS, t.id);
      for (const svg of out.match(/<svg[^>]*>/g) ?? []) expect(svg, t.id).toContain('aria-hidden="true"');
      // Emojis: simbolos varios (U+2600-27BF) y los pictogramas, que en UTF-16 empiezan con un sustituto alto D83C-D83E.
      expect(out, t.id).not.toMatch(/[☀-➿]|[\uD83C-\uD83E][\uDC00-\uDFFF]/);
    }
  });

  it('las estructuras con acordeon usan details/summary reales (teclado y lector de pantalla)', () => {
    const out = html(SAMPLE_FICHAS, 'brutalista');
    expect(out).toContain('<details');
    expect(out).toContain('<summary');
  });
});

describe('estructuras', () => {
  it('Cornell (funcional) tiene sus tres partes: pistas, notas y resumen', () => {
    const out = html([SIN_FORMULA], 'cornell');
    for (const parte of ['Pistas', 'Notas', 'Resumen']) expect(out).toContain(parte);
  });

  it('Cornell sin terminos ni reflexion no deja la columna de pistas vacia (funcional y con tema)', () => {
    const f: FichaData = { ...SIN_FORMULA, extra: { puntos_clave: SIN_FORMULA.extra!.puntos_clave } };
    for (const id of ['cornell', 'plano']) {
      const out = html([f], id);
      expect(out, id).not.toContain('Pistas');
      expect(out, id).toContain('Notas');
    }
  });

  it('el mosaico muestra la inicial de cada termino, oculta a los lectores de pantalla', () => {
    const out = html([SIN_FORMULA], 'laboratorio');
    expect(out).toMatch(/<span aria-hidden="true" class="fk-initial">C<\/span>/);
  });

  it('la ruta numera las paradas', () => {
    const out = html([SIN_FORMULA], 'aventura');
    expect(out).toMatch(/class="fk-num">3<\/span>/);
  });

  it('la revista pone el glosario y la cita final', () => {
    const out = html([SIN_FORMULA], 'libro');
    expect(out).toContain('Glosario');
    expect(out).toContain('fk-pull');
  });

  it('el cuaderno pone los terminos como notas adhesivas', () => {
    const out = html([SIN_FORMULA], 'cuadriculado');
    expect(out).toContain('fk-sticky');
  });
});

describe('initialOf', () => {
  it('toma la primera letra o numero, ignorando las marcas de formula y las tildes se conservan', () => {
    expect(initialOf('Clorofila')).toBe('C');
    expect(initialOf('ácido')).toBe('Á');
    expect(initialOf('$x^2$')).toBe('X');
    expect(initialOf('2n')).toBe('2');
    expect(initialOf('   ')).toBe('•');
  });
});

describe('FichaList', () => {
  it('sin fichas, avisa en vez de quedar en blanco', () => {
    expect(html([], 'tarjeta')).toContain('no produjo fichas');
    expect(html([], 'aventura')).toContain('no produjo fichas');
  });

  it('un id desconocido o ausente se pinta como la clasica', () => {
    const clasica = html(SAMPLE_FICHAS, 'clasica');
    for (const t of [null, undefined, '', 'inexistente']) expect(html(SAMPLE_FICHAS, t as string | null | undefined)).toBe(clasica);
  });

  it('todas las plantillas se ven distintas entre si', () => {
    const salidas = FICHA_TEMPLATES.map((t) => html(SAMPLE_FICHAS, t.id));
    expect(new Set(salidas).size).toBe(FICHA_TEMPLATES.length);
  });
});
