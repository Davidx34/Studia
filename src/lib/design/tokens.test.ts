import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseThemePreference, resolveTheme, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from './theme';

const css = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(/\r\n/g, '\n');

// Extrae las variables --c-* de un bloque de CSS.
function vars(block: string): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  Array.from(block.matchAll(/--c-([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+);/g)).forEach((m) => {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  });
  return out;
}

const darkBlock = css.slice(css.indexOf(':root {\n  --c-bg'), css.indexOf('/* Tema claro'));
const lightBlock = css.slice(css.indexOf('html[data-theme="light"] .theme-scope {'), css.indexOf('.theme-scope {\n  background'));
const dark = vars(darkBlock);
const light = vars(lightBlock);

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Pares texto/fondo que la interfaz usa de verdad. Texto normal: 4.5:1 (WCAG AA).
const TEXT_PAIRS: [string, string][] = [
  ['fg', 'bg'],
  ['fg', 'surface'],
  ['fg', 'surface-2'],
  ['fg-muted', 'bg'],
  ['fg-muted', 'surface'],
  ['fg-muted', 'surface-2'],
  ['on-primary', 'primary'],
  ['on-accent', 'accent'],
  ['on-danger', 'danger'],
  ['primary-text', 'surface'],
  ['primary-text', 'bg'],
  ['accent-text', 'surface'],
  ['accent-text', 'bg'],
  ['success', 'surface'],
  ['danger', 'surface'],
  ['danger', 'bg'],
];

describe.each([
  ['oscuro', dark],
  ['claro', light],
])('contraste del tema %s', (_name, t) => {
  it('define todos los tokens', () => {
    for (const k of ['bg', 'surface', 'surface-2', 'line', 'line-strong', 'fg', 'fg-muted', 'primary', 'primary-text', 'on-primary', 'accent', 'on-accent', 'accent-text', 'success', 'danger', 'on-danger', 'ring']) {
      expect(t[k], `falta --c-${k}`).toBeDefined();
    }
  });

  it.each(TEXT_PAIRS)('texto %s sobre %s: al menos 4.5:1', (fg, bg) => {
    expect(contrast(t[fg], t[bg]), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('el borde de un campo (line-strong) y el anillo de foco son visibles: al menos 3:1', () => {
    expect(contrast(t['line-strong'], t['surface-2'])).toBeGreaterThanOrEqual(3);
    expect(contrast(t['ring'], t['bg'])).toBeGreaterThanOrEqual(3);
  });
});

describe('el tema claro es opcional y no toca el resto de la app', () => {
  it('las variables claras solo se aplican dentro de .theme-scope', () => {
    expect(css).toContain('html[data-theme="light"] .theme-scope {');
    // Ningun bloque :root redefine los tokens con valores claros.
    expect(css.match(/:root\s*\{[^}]*--c-bg:/g)!.length).toBe(1);
  });

  it('respeta prefers-reduced-motion en toda la app', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms/);
  });
});

describe('preferencia de tema', () => {
  it('por defecto es oscuro y descarta valores raros', () => {
    expect(parseThemePreference(null)).toBe('dark');
    expect(parseThemePreference('rosa')).toBe('dark');
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('system')).toBe('system');
  });

  it('"sistema" sigue al sistema; claro y oscuro lo ignoran', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('el script de arranque usa la misma clave de almacenamiento y no rompe si no hay localStorage', () => {
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_INIT_SCRIPT).toContain('catch');
    expect(() => new Function(THEME_INIT_SCRIPT)).not.toThrow(); // sintaxis valida
  });
});
