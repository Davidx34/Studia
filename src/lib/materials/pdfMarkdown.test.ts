import { describe, it, expect } from 'vitest';
import {
  buildPdfPrompt,
  buildPdfPagesPrompt,
  cleanModelMarkdown,
  parsePages,
  joinPages,
  sanitizeMarkdown,
  countUnreadableSymbols,
  PAGES_PER_BATCH,
} from './pdfMarkdown';

describe('buildPdfPrompt', () => {
  it('pide todo el documento cuando la tanda es la unica', () => {
    expect(buildPdfPrompt({ from: 1, to: 10 }, 10)).toContain('TODO el documento');
  });

  it('acota el rango cuando hay varias tandas', () => {
    const p = buildPdfPrompt({ from: 21, to: 30 }, 47);
    expect(p).toContain('paginas 21 a 30');
    expect(p).not.toContain('TODO el documento');
  });

  it('exige fidelidad: sin resumir, sin inventar, formulas en LaTeX y marcador de pagina', () => {
    const p = buildPdfPrompt({ from: 1, to: 5 }, 5);
    expect(p).toMatch(/No resumas/);
    expect(p).toMatch(/no lo inventes/i);
    expect(p).toContain('LaTeX');
    expect(p).toContain('[[PAGINA N]]');
  });
});

describe('buildPdfPagesPrompt (PDF completo, paginas por su numero real)', () => {
  it('lista las paginas pedidas y no pide todo el documento', () => {
    const p = buildPdfPagesPrompt([3, 7, 12], 47);
    expect(p).toContain('SOLO estas paginas: 3, 7, 12');
    expect(p).not.toContain('TODO el documento');
    expect(p).toContain('[[PAGINA N]]');
  });
});

describe('PAGES_PER_BATCH', () => {
  it('es corto: una tanda de 20 paginas dio 503 con flash-lite', () => {
    expect(PAGES_PER_BATCH).toBeLessThanOrEqual(10);
  });
});

describe('cleanModelMarkdown', () => {
  it('quita la frase de cortesia anterior al primer marcador', () => {
    const raw = 'Aquí tienes la transcripción:\n\n[[PAGINA 1]]\n# Titulo';
    expect(cleanModelMarkdown(raw)).toBe('[[PAGINA 1]]\n# Titulo');
  });

  it('quita el bloque ```markdown que envuelve la respuesta', () => {
    const raw = '```markdown\n[[PAGINA 1]]\n# Titulo\n```';
    expect(cleanModelMarkdown(raw)).toBe('[[PAGINA 1]]\n# Titulo');
  });

  it('no toca una respuesta que ya viene limpia', () => {
    expect(cleanModelMarkdown('[[PAGINA 1]]\nTexto')).toBe('[[PAGINA 1]]\nTexto');
  });
});

describe('parsePages / joinPages', () => {
  const md = '[[PAGINA 1]]\n# A\n\ntexto uno\n\n[[PAGINA 2]]\n## B\n\n[[PAGINA 3]]\ntexto tres';

  it('separa el contenido por pagina', () => {
    const { pages, hadMarkers } = parsePages(md);
    expect(hadMarkers).toBe(true);
    expect(Array.from(pages.keys())).toEqual([1, 2, 3]);
    expect(pages.get(1)).toContain('texto uno');
    expect(pages.get(3)).toBe('texto tres');
  });

  it('acepta el marcador con tilde o en minusculas', () => {
    expect(parsePages('[[PÁGINA 4]]\nx').pages.has(4)).toBe(true);
    expect(parsePages('[[pagina 5]]\nx').pages.has(5)).toBe(true);
  });

  it('sin marcadores no hay paginas', () => {
    expect(parsePages('solo texto').hadMarkers).toBe(false);
  });

  it('un marcador repetido conserva el contenido mas largo', () => {
    const { pages } = parsePages('[[PAGINA 1]]\ncorto\n\n[[PAGINA 1]]\nmucho mas largo que el otro');
    expect(pages.get(1)).toBe('mucho mas largo que el otro');
  });

  it('joinPages ordena por pagina y no deja marcadores', () => {
    const pages = new Map<number, string>([[3, 'c'], [1, 'a'], [2, '']]);
    expect(joinPages(pages)).toBe('a\n\nc');
    expect(joinPages(parsePages(md).pages)).not.toContain('[[PAGINA');
  });
});

describe('sanitizeMarkdown', () => {
  it('conserva la sangria de las listas anidadas (sanitizeText la aplastaria)', () => {
    expect(sanitizeMarkdown('- a\n  - b\n    - c')).toBe('- a\n  - b\n    - c');
  });

  it('quita caracteres de control y colapsa lineas en blanco de mas', () => {
    expect(sanitizeMarkdown('a\u0001b\n\n\n\nc  \n')).toBe('ab\n\nc');
  });
});

describe('countUnreadableSymbols', () => {
  it('cuenta caracteres de control y de uso privado, no el texto normal', () => {
    expect(countUnreadableSymbols('hola\n\tmundo')).toBe(0);
    expect(countUnreadableSymbols('a\u0001\u0002b\ue001')).toBe(3);
  });
});
