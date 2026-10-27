import { describe, it, expect } from 'vitest';
import { protectLatexBackslashes, escapeInvalidJsonBackslashes } from './latexJson';

const parse = (raw: string) => JSON.parse(protectLatexBackslashes(raw));
const CONTROL = /[\f\b\t]/;

describe('protectLatexBackslashes', () => {
  it('sin proteccion, \\frac \\beta \\times se corrompen en silencio (lo que paso en produccion)', () => {
    const q = JSON.parse(String.raw`{"q":"$\frac{dx}{dK}$ $\beta$ $\times$"}`).q;
    expect(q).toContain('\f'); // salto de pagina
    expect(q).toContain('\b'); // retroceso
    expect(q).toContain('\t'); // tabulacion
  });

  it('con proteccion, la formula llega intacta', () => {
    const q = parse(String.raw`{"q":"Efecto: $\frac{dx}{dK}$, con $\beta$ y $a \times b$"}`).q;
    expect(q).toBe(String.raw`Efecto: $\frac{dx}{dK}$, con $\beta$ y $a \times b$`);
    expect(q).not.toMatch(CONTROL);
  });

  it('cubre \\nu \\rho y otras barras dentro de la formula', () => {
    const q = parse(String.raw`{"q":"$\nu + \rho \partial \to \tau$"}`).q;
    expect(q).toBe(String.raw`$\nu + \rho \partial \to \tau$`);
  });

  it('lo que el modelo ya escapo bien no se duplica', () => {
    const q = parse(String.raw`{"q":"$\\frac{a}{b}$ y $\\beta$"}`).q;
    expect(q).toBe(String.raw`$\frac{a}{b}$ y $\beta$`);
  });

  it('fuera de las formulas un salto de linea real sigue siendo un salto de linea', () => {
    expect(parse(String.raw`{"q":"linea1\nlinea2 $\frac{a}{b}$"}`).q).toBe('linea1\nlinea2 $' + '\\' + 'frac{a}{b}$');
  });

  it('varias formulas en un mismo texto y en listas', () => {
    const o = parse(String.raw`{"opts":["A. $\frac{1}{2}$","B. $\sqrt{x}$"],"exp":"Usa $\tau$."}`);
    expect(o.opts).toEqual([String.raw`A. $\frac{1}{2}$`, String.raw`B. $\sqrt{x}$`]);
    expect(o.exp).toBe(String.raw`Usa $\tau$.`);
  });
});

describe('escapeInvalidJsonBackslashes (respaldo)', () => {
  it('dobla barras que no inician un escape valido', () => {
    expect(JSON.parse(escapeInvalidJsonBackslashes(String.raw`{"q":"\partial x"}`)).q).toBe(String.raw`\partial x`);
  });
});

describe('integracion', () => {
  it('los dos generadores protegen las formulas ANTES del primer JSON.parse', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
    const q = read('src/lib/questions/cohereGeneration.ts');
    // Todo texto pasa por parseLenient, que protege las formulas antes de parsear (objeto, lista o pregunta suelta).
    expect(q.indexOf('protectLatexBackslashes(src)')).toBeGreaterThan(-1);
    expect(q.indexOf('protectLatexBackslashes(src)')).toBeLessThan(q.indexOf('JSON.parse(protectedJson)'));
    expect(read('src/lib/study/validate.ts')).toContain('protectLatexBackslashes(m[0])');
  });
});
