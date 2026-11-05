import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MathText } from './MathText';

const html = (content: string) => renderToStaticMarkup(createElement(MathText, { content }));

describe('MathText dibuja con KaTeX lo que antes se veia mal (casos reales)', () => {
  it('dinero: «$100 … $10 y $20» sale como texto, sin formula', () => {
    const h = html('Si un consumidor tiene un ingreso de $100 y los precios de los bienes x e y son $10 y $20 respectivamente');
    expect(h).not.toContain('katex');
    expect(h).toContain('$100');
    expect(h).toContain('$10 y $20');
  });
  it('LaTeX corrupto (salto de pagina + rac) se dibuja como fraccion', () => {
    const h = html('la condicion $\frac{\\partial U}{\\partial x} = 0$ se cumple');
    expect(h).toContain('katex');
    expect(h).toContain('mfrac');
    expect(h).not.toContain('\f');
    expect(h).not.toContain('class="katex-error"');
  });
  it('\\beta corrupto (retroceso + eta) y una casilla en blanco dentro de la formula', () => {
    const h = html('$U = x^{\\alpha}y^{\beta}$ y $L = P - CMg = ___$');
    expect(h.match(/class="katex"/g)?.length).toBe(2);
    expect(h).not.toContain('katex-error');
  });
  it('dinero + formula en la misma frase: solo la formula se dibuja', () => {
    const h = html('Con ingreso de $100 se cumple $p_x x + p_y y \\le 100$ siempre');
    expect(h.match(/class="katex"/g)?.length).toBe(1);
    expect(h).toContain('$100 se cumple');
  });
  it('un % sin escapar dentro de la formula ya no se come el resto', () => {
    const h = html('mide $\\frac{%\\Delta Q}{%\\Delta I}$ siempre');
    expect(h).toContain('katex');
    expect(h).not.toContain('katex-error');
  });
  it('sin dolares: texto igual (con la reparacion de caracteres de control)', () => {
    expect(html('texto simple')).toBe('<span>texto simple</span>');
    expect(html('')).toBe('');
  });
});
