import { describe, it, expect } from 'vitest';
import {
  splitPageRanges,
  buildPdfPrompt,
  cleanModelMarkdown,
  parsePages,
  joinPages,
  sanitizeMarkdown,
  countUnreadableSymbols,
  wordRecall,
  assessConversion,
  allowedMissingPages,
  PAGES_PER_BATCH,
} from './pdfMarkdown';

describe('splitPageRanges', () => {
  it('un documento corto va en una sola tanda', () => {
    expect(splitPageRanges(10)).toEqual([{ from: 1, to: 10 }]);
  });

  it('parte en tandas sin dejar paginas fuera ni repetirlas', () => {
    const r = splitPageRanges(47);
    expect(r[0]).toEqual({ from: 1, to: PAGES_PER_BATCH });
    expect(r[r.length - 1].to).toBe(47);
    const covered = r.flatMap((x) => Array.from({ length: x.to - x.from + 1 }, (_, i) => x.from + i));
    expect(covered).toEqual(Array.from({ length: 47 }, (_, i) => i + 1));
  });

  it('un numero exacto de tandas no crea una tanda vacia', () => {
    expect(splitPageRanges(PAGES_PER_BATCH * 2)).toHaveLength(2);
  });
});

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

describe('wordRecall', () => {
  const plain = Array.from({ length: 40 }, (_, i) => `palabra${i}xyz`).join(' ');

  it('todo el texto simple aparece: 1', () => {
    expect(wordRecall(plain, `# T\n${plain}`)).toBe(1);
  });

  it('ignora mayusculas, tildes y puntuacion', () => {
    const p = 'Elasticidad demanda consumidor restricción presupuestaria utilidad marginal '.repeat(6) + Array.from({ length: 30 }, (_, i) => `termino${i}abc`).join(' ');
    const m = p.toUpperCase().replace(/ó/gi, 'o');
    expect(wordRecall(p, m)).toBeGreaterThan(0.95);
  });

  it('si el Markdown omite la mitad, baja a ~0,5', () => {
    const half = plain.split(' ').slice(0, 20).join(' ');
    const r = wordRecall(plain, half)!;
    expect(r).toBeGreaterThan(0.45);
    expect(r).toBeLessThan(0.55);
  });

  it('con muy poco texto simple no hay con que comparar (null)', () => {
    expect(wordRecall('hola mundo', 'otra cosa')).toBeNull();
  });
});

describe('assessConversion', () => {
  const plain = Array.from({ length: 60 }, (_, i) => `concepto${i}alfa`).join(' ');

  it('acepta una conversion completa', () => {
    const r = assessConversion({ expectedPages: 10, pagesFound: 10, plainText: plain, markdown: `# Titulo\n\n${plain}` });
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('tolera una pagina casi vacia sin transcribir (10 %, minimo 1)', () => {
    expect(allowedMissingPages(10)).toBe(1);
    expect(allowedMissingPages(47)).toBe(4);
    expect(assessConversion({ expectedPages: 10, pagesFound: 9, plainText: plain, markdown: plain }).ok).toBe(true);
  });

  it('REGRESION: falta media transcripcion (25 de 47 paginas) -> se rechaza', () => {
    // Asi fallo el PDF real de 47 paginas cuando una de las dos tandas devolvio error.
    const r = assessConversion({ expectedPages: 47, pagesFound: 25, plainText: plain, markdown: plain });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toContain('25 de 47');
  });

  it('rechaza si el modelo resumio y perdio palabras', () => {
    const half = plain.split(' ').slice(0, 25).join(' ');
    const r = assessConversion({ expectedPages: 5, pagesFound: 5, plainText: plain, markdown: half });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/palabras/);
  });

  it('rechaza un Markdown casi vacio', () => {
    expect(assessConversion({ expectedPages: 1, pagesFound: 1, plainText: '', markdown: 'x' }).ok).toBe(false);
  });

  it('rechaza un Markdown desproporcionadamente mas largo (contenido inventado)', () => {
    const r = assessConversion({ expectedPages: 3, pagesFound: 3, plainText: plain, markdown: `${plain} ${'inventado '.repeat(9000)}` });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/mas largo/);
  });

  it('un PDF de solo imagenes (sin texto simple) no se puede comparar y no se rechaza por palabras', () => {
    const r = assessConversion({ expectedPages: 2, pagesFound: 2, plainText: '', markdown: 'Contenido leido de las imagenes '.repeat(5) });
    expect(r.recall).toBeNull();
    expect(r.ok).toBe(true);
  });
});
