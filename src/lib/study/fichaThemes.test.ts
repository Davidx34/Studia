import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FICHA_THEMES, FICHA_THEME_IDS, contrastRatio, getFichaTheme, luminance } from './fichaThemes';
import { FICHA_CATEGORY_LABEL, FICHA_TEMPLATES, type FichaCategory } from './fichaTemplates';

const LAYOUTS = ['tarjeta', 'mosaico', 'ruta', 'cuaderno', 'revista', 'cornell', 'acordeon'];

describe('contraste (WCAG)', () => {
  it('formula: negro sobre blanco = 21, y es simetrica', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('cada par texto/fondo de CADA tema cumple 4.5:1 (AA)', () => {
    for (const t of Object.values(FICHA_THEMES)) {
      expect(t.pairs.length, t.id).toBeGreaterThanOrEqual(10);
      for (const [que, fg, bg] of t.pairs) {
        const r = contrastRatio(fg, bg);
        expect(r, `${t.id}: ${que} (${fg} sobre ${bg}) = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('el tema de vidrio mide su texto contra el PEOR caso de la mezcla, no contra el fondo translucido', () => {
    const aurora = FICHA_THEMES.aurora;
    expect(aurora.vars['--f-card']).toMatch(/^rgba\(/);
    expect(aurora.pairs.some(([, , bg]) => bg === '#525865')).toBe(true);
    // El peor caso: la tarjeta (72 % de #0F172A) sobre blanco puro. Debe quedar por encima del valor medido.
    const mezcla = (c: number, f: number) => Math.round(c * 0.72 + 255 * 0.28 + 0 * f);
    const worst = `#${[15, 23, 42].map((c) => mezcla(c, 0).toString(16).padStart(2, '0')).join('')}`;
    expect(contrastRatio('#FFFFFF', worst)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#E2E8F0', worst)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('temas', () => {
  it('son 12 y cada uno tiene todas las variables que usa el CSS', () => {
    expect(FICHA_THEME_IDS).toHaveLength(12);
    const css = fs.readFileSync(path.join(process.cwd(), 'src/components/study/fichas/fichaThemes.css'), 'utf8');
    // Las que el propio CSS declara (por ejemplo --f-pad) no las pone el tema.
    const unicos = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) === i);
    const propias = unicos((css.match(/--f-[a-z0-9-]+(?=\s*:)/g) ?? []).map((s) => s.trim()));
    const usadas = unicos((css.match(/var\(--f-[a-z0-9-]+/g) ?? []).map((s) => s.slice(4))).filter((v) => propias.indexOf(v) < 0);
    expect(usadas.length).toBeGreaterThan(20);
    for (const t of Object.values(FICHA_THEMES)) {
      for (const v of usadas) expect(Object.keys(t.vars), `${t.id} no define ${v}`).toContain(v);
    }
  });

  it('las variables son solo --f-*, y ningun valor esta vacio', () => {
    for (const t of Object.values(FICHA_THEMES)) {
      for (const [k, v] of Object.entries(t.vars)) {
        expect(k, t.id).toMatch(/^--f-[a-z0-9-]+$/);
        expect(v.trim().length, `${t.id} ${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('la fuente web de un tema es una de las dos que se cargan (o ninguna), y su tipografia la usa', () => {
    for (const t of Object.values(FICHA_THEMES)) {
      expect([null, 'baloo', 'playfair']).toContain(t.font);
      if (t.font) expect(t.vars['--f-font-head']).toContain(`--font-${t.font}`);
    }
  });

  it('los temas infantiles son claros (la skill desaconseja el modo oscuro en estilos infantiles)', () => {
    for (const id of ['aventura', 'arcoiris']) {
      expect(luminance(FICHA_THEMES[id].vars['--f-bg']), id).toBeGreaterThan(0.6);
    }
  });

  it('getFichaTheme devuelve null para lo desconocido', () => {
    expect(getFichaTheme('inventado')).toBeNull();
    expect(getFichaTheme('neon')?.id).toBe('neon');
  });
});

describe('el CSS no lleva colores propios (todo viene del tema)', () => {
  const css = fs
    .readFileSync(path.join(process.cwd(), 'src/components/study/fichas/fichaThemes.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('sin colores hex, rgb(), hsl() ni nombres de color', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/);
    expect(css).not.toMatch(/:\s*(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey)\b/);
  });

  it('apaga las animaciones con prefers-reduced-motion y muestra el foco', () => {
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain(':focus-visible');
  });

  it('prepara la impresion', () => {
    expect(css).toContain('@media print');
  });
});

describe('catalogo de plantillas con tema', () => {
  it('son 16 en 4 categorias, y las que no son funcionales tienen estructura y tema validos', () => {
    expect(FICHA_TEMPLATES).toHaveLength(16);
    const porCategoria = (c: FichaCategory) => FICHA_TEMPLATES.filter((t) => t.category === c).length;
    expect([porCategoria('funcional'), porCategoria('infantil'), porCategoria('area'), porCategoria('estetica')]).toEqual([4, 2, 6, 4]);
    for (const t of FICHA_TEMPLATES) {
      if (t.category === 'funcional') {
        expect(t.layout).toBeNull();
        expect(t.theme).toBeNull();
      } else {
        expect(LAYOUTS, t.id).toContain(t.layout);
        expect(FICHA_THEME_IDS, t.id).toContain(t.theme);
      }
    }
  });

  it('cada categoria tiene su nombre y los ids son unicos y validos para el CHECK de la base', () => {
    for (const c of ['funcional', 'infantil', 'area', 'estetica'] as const) expect(FICHA_CATEGORY_LABEL[c]).toBeTruthy();
    const ids = FICHA_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
  });

  it('cada tema se usa en alguna plantilla (no hay temas huerfanos) y hay variedad de estructuras', () => {
    const usados = new Set<string | null>(FICHA_TEMPLATES.map((t) => t.theme).filter(Boolean));
    for (const id of FICHA_THEME_IDS) expect(usados.has(id), id).toBe(true);
    const layouts = new Set(FICHA_TEMPLATES.map((t) => t.layout).filter(Boolean));
    expect(layouts.size).toBe(LAYOUTS.length);
  });

  it('cubre las areas pedidas: biologia, quimica, matematicas, fisica, sociales y lenguaje', () => {
    const texto = FICHA_TEMPLATES.filter((t) => t.category === 'area').map((t) => t.bestFor.toLowerCase()).join(' | ');
    for (const area of ['biolog', 'química', 'matemáticas', 'física', 'sociales', 'lenguaje']) expect(texto).toContain(area);
  });

  it('cada plantilla tiene nombre, descripcion y para que sirve', () => {
    for (const t of FICHA_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(2);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.bestFor.length).toBeGreaterThan(10);
    }
  });
});
