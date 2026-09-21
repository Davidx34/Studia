import { describe, it, expect, beforeAll } from 'vitest';
import {
  extractMathSegments,
  countInvalidLatex,
  defaultLatexRenderer,
  latexToUnicodeSymbols,
  symbolRecall,
  numberRecall,
  pageWordRecall,
  verifyPage,
  type LatexRenderer,
} from './pdfVerify';

// El renderer REAL (KaTeX): la validez del LaTeX es determinista, no hace falta simularla.
let render: LatexRenderer;
beforeAll(async () => {
  render = await defaultLatexRenderer();
});

describe('extractMathSegments', () => {
  it('encuentra formulas en linea y en bloque', () => {
    const s = extractMathSegments('Texto $x^2$ y\n$$\\frac{a}{b}$$\nfin');
    expect(s.map((x) => x.expression).sort()).toEqual(['\\frac{a}{b}', 'x^2']);
  });

  it('un signo de pesos suelto no abre una formula', () => {
    expect(extractMathSegments('cuesta 5 pesos')).toEqual([]);
  });
});

describe('countInvalidLatex (KaTeX real)', () => {
  it('acepta LaTeX valido, incluida una tabla de demandas', () => {
    const md = '$$\\begin{array}{ll}\\max & u(x,y) \\\\ \\text{s.a} & p_x x + p_y y = w\\end{array}$$ y $\\frac{\\alpha w}{(\\alpha+\\beta)p_x}$';
    expect(countInvalidLatex(md, render)).toEqual({ total: 2, invalid: 0 });
  });

  it('detecta una formula truncada o mal formada', () => {
    expect(countInvalidLatex('$\\frac{a}{$', render).invalid).toBe(1);
    expect(countInvalidLatex('$$\\begin{array}{ll} a & b$$', render).invalid).toBe(1);
    expect(countInvalidLatex('$\\comandoinexistente{x}$', render).invalid).toBe(1);
  });

  it('sin formulas no hay nada invalido', () => {
    expect(countInvalidLatex('solo texto', render)).toEqual({ total: 0, invalid: 0 });
  });
});

describe('latexToUnicodeSymbols', () => {
  it('convierte comandos griegos y operadores a Unicode', () => {
    expect(latexToUnicodeSymbols('\\alpha + \\beta \\leq \\Delta')).toBe('α + β ≤ Δ');
  });

  it('no confunde \\beta con un comando mas largo', () => {
    expect(latexToUnicodeSymbols('\\betax')).toBe('\\betax');
  });
});

describe('symbolRecall', () => {
  const plain = 'xαyβ αw (α + β)px βw (α + β)py βw βpx + αpy';

  it('una transcripcion fiel en LaTeX conserva todos los simbolos', () => {
    const md = '$x^{\\alpha} y^{\\beta}$ $\\frac{\\alpha w}{(\\alpha+\\beta)p_x}$ $\\frac{\\beta w}{(\\alpha+\\beta)p_y}$ $\\frac{\\beta w}{\\beta p_x + \\alpha p_y}$';
    expect(symbolRecall(plain, md).ratio!).toBeGreaterThanOrEqual(0.8);
  });

  it('REGRESION: "β" transcrito como "B" baja el porcentaje de simbolos', () => {
    // Asi fallo la corrida real: beta salio como B en la tabla de demandas.
    const bien = '$\\beta w$ $\\beta p_x + \\alpha p_y$ $\\beta w$ $\\alpha w$ $\\beta y$ $\\beta$ $\\alpha$ $\\alpha$';
    const mal = bien.replace(/\\beta/g, 'B');
    const p = 'βw βpx + αpy βw αw βy β α α';
    expect(symbolRecall(p, bien).ratio!).toBe(1);
    expect(symbolRecall(p, mal).ratio!).toBeLessThan(0.5);
  });

  it('con muy pocos simbolos no compara (null)', () => {
    expect(symbolRecall('α β', 'nada').ratio).toBeNull();
  });
});

describe('numberRecall', () => {
  it('cuenta repeticiones: un numero perdido baja la proporcion', () => {
    const plain = 'valores 16 8 2 16 8 4 10';
    expect(numberRecall(plain, 'valores 16 8 2 16 8 4 10').ratio).toBe(1);
    expect(numberRecall(plain, 'valores 16 8 2').ratio!).toBeLessThan(0.6);
  });

  it('con pocos numeros no compara', () => {
    expect(numberRecall('a 1 b 2', 'nada').ratio).toBeNull();
  });
});

describe('pageWordRecall', () => {
  const plain = 'elasticidad precio demanda consumidor restriccion presupuestaria utilidad marginal optimo canasta';

  it('ignora tildes, mayusculas y formulas', () => {
    expect(pageWordRecall(plain, 'Elasticidad PRECIO demanda consumidor restricción presupuestaria utilidad marginal óptimo canasta')).toBe(1);
  });

  it('una pagina resumida pierde palabras', () => {
    expect(pageWordRecall(plain, 'elasticidad precio')!).toBeLessThan(0.3);
  });

  it('con muy poco texto no compara', () => {
    expect(pageWordRecall('poco texto', 'lo que sea')).toBeNull();
  });
});

describe('verifyPage', () => {
  const plain = 'Regla óptima consumidor preferencias convexas demanda marshalliana utilidad marginal α β γ δ px py 10 20 30 40 50 60';

  it('acepta una transcripcion fiel', () => {
    const md = '## Regla óptima\nconsumidor con preferencias convexas, demanda marshalliana y utilidad marginal.\n$\\alpha \\beta \\gamma \\delta p_x p_y$ 10 20 30 40 50 60';
    expect(verifyPage(plain, md, render)).toEqual({ ok: true, reasons: [] });
  });

  it('rechaza LaTeX invalido', () => {
    const md = 'consumidor preferencias convexas demanda marshalliana utilidad marginal regla optima $\\frac{a}{$ 10 20 30 40 50 60 $\\alpha \\beta \\gamma \\delta$';
    const v = verifyPage(plain, md, render);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/LaTeX/);
  });

  it('rechaza una transcripcion que perdio simbolos', () => {
    const md = 'Regla óptima consumidor preferencias convexas demanda marshalliana utilidad marginal 10 20 30 40 50 60';
    const v = verifyPage(plain, md, render);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/simbolos/);
  });

  it('rechaza una transcripcion vacia', () => {
    expect(verifyPage(plain, ' ', render).ok).toBe(false);
  });
});
