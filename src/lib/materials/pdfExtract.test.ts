import { describe, it, expect } from 'vitest';
import { analyzePages, fixSpacingAccents, type RawItem, type RawPage } from './pdfExtract';

// Constructor de paginas sinteticas: cada linea es { text, size, y, x?, parts? }.
interface L {
  text?: string;
  size?: number;
  y: number;
  x?: number;
  parts?: { str: string; x: number; width?: number }[]; // para tablas: varios trozos en la misma linea
}

function page(number: number, lines: L[], extra: Partial<RawPage> = {}): RawPage {
  const items: RawItem[] = [];
  for (const l of lines) {
    const size = l.size ?? 12;
    if (l.parts) {
      l.parts.forEach((p, i) =>
        items.push({ str: p.str, x: p.x, y: l.y, size, width: p.width ?? p.str.length * size * 0.5, hasEOL: i === l.parts!.length - 1 })
      );
    } else {
      items.push({ str: l.text!, x: l.x ?? 50, y: l.y, size, width: l.text!.length * size * 0.5, hasEOL: true });
    }
  }
  return { number, width: 600, height: 800, items, images: [], paths: 0, ...extra };
}

// Un texto de cuerpo largo para que el tamaño 12 sea el "normal" del documento.
const body = (y: number, text = 'texto normal del cuerpo del documento para fijar el tamaño base') => ({ text, size: 12, y });

describe('fixSpacingAccents', () => {
  it('une el acento suelto de LaTeX con su letra', () => {
    expect(fixSpacingAccents('F´ormulas: Teor´ıa del consumidor')).toBe('Fórmulas: Teoría del consumidor');
    expect(fixSpacingAccents('soluci´on est´a')).toBe('solución está');
    expect(fixSpacingAccents('ma˜nana')).toBe('mañana');
  });

  it('no toca el texto sin acentos sueltos', () => {
    expect(fixSpacingAccents('Fórmulas normales')).toBe('Fórmulas normales');
  });
});

describe('analyzePages: estructura', () => {
  it('los titulos se detectan por tamaño y llevan nivel segun su tamaño relativo', () => {
    const [p] = analyzePages([
      page(1, [
        { text: 'Titulo principal', size: 30, y: 100 },
        { text: 'Subtitulo', size: 20, y: 160 },
        body(220),
        body(240),
        body(260),
      ]),
    ]);
    expect(p.markdown).toContain('# Titulo principal');
    expect(p.markdown).toContain('## Subtitulo');
    expect(p.markdown).not.toContain('### Subtitulo');
  });

  it('las vinetas pasan a "- " y las lineas siguientes sin marcador son su continuacion', () => {
    const [p] = analyzePages([
      page(1, [
        body(100),
        body(120),
        { text: '• primer punto largo', y: 160 },
        { text: '• segundo punto que continua', y: 180 },
        { text: 'en la linea de abajo', y: 195 },
      ]),
    ]);
    expect(p.markdown).toContain('- primer punto largo');
    expect(p.markdown).toContain('- segundo punto que continua en la linea de abajo');
  });

  it('las lineas cercanas forman un parrafo y se quita el guion de corte de palabra', () => {
    const [p] = analyzePages([
      page(1, [
        { text: 'La elasticidad mide la sensibili-', y: 100 },
        { text: 'dad de la cantidad demandada.', y: 114 },
      ]),
    ]);
    expect(p.markdown).toContain('La elasticidad mide la sensibilidad de la cantidad demandada.');
  });

  it('un salto vertical grande separa parrafos', () => {
    const [p] = analyzePages([page(1, [{ text: 'Primer parrafo.', y: 100 }, { text: 'Segundo parrafo.', y: 300 }])]);
    expect(p.markdown).toBe('Primer parrafo.\n\nSegundo parrafo.');
  });

  it('aplica el arreglo de acentos al texto de la pagina y a lo que se usa para verificar', () => {
    const [p] = analyzePages([page(1, [{ text: 'Teor´ıa del consumidor', y: 100 }])]);
    expect(p.markdown).toContain('Teoría');
    expect(p.text).toContain('Teoría');
  });
});

describe('analyzePages: encabezados y pies repetidos', () => {
  it('se quitan los que se repiten en la mayoria de las paginas y los numeros de pagina', () => {
    const pages = [1, 2, 3, 4].map((n) =>
      page(n, [
        { text: 'Universidad del Rosario - Microeconomía I', y: 20 }, // encabezado (zona superior)
        { text: `contenido unico de la pagina ${n}`, y: 300 },
        { text: String(n), y: 780 }, // numero de pagina (zona inferior)
      ])
    );
    const out = analyzePages(pages);
    out.forEach((p, i) => {
      expect(p.markdown).not.toContain('Universidad del Rosario');
      expect(p.markdown).not.toMatch(/^\d+$/m);
      expect(p.markdown).toContain(`contenido unico de la pagina ${i + 1}`);
    });
  });

  it('un texto de la zona superior que NO se repite se conserva', () => {
    const pages = [1, 2, 3, 4].map((n) => page(n, [{ text: n === 1 ? 'Titulo solo de la primera pagina' : 'otra cosa', y: 20 }, { text: 'cuerpo', y: 300 }]));
    expect(analyzePages(pages)[0].markdown).toContain('Titulo solo de la primera pagina');
  });
});

describe('analyzePages: paginas de riesgo (las unicas que van a la IA)', () => {
  it('una pagina de texto limpio NO es de riesgo', () => {
    const [p] = analyzePages([page(1, [body(100), body(120), body(140)])]);
    expect(p.risk).toEqual([]);
  });

  it('formulas ilegibles: caracteres de control en el texto', () => {
    const [p] = analyzePages([page(1, [body(100), { text: 'u(x) =  ', y: 120 }])]);
    expect(p.risk).toContain('formulas_ilegibles');
    expect(p.unreadable).toBe(3);
    expect(p.markdown).not.toContain(''); // no llega al Markdown determinista
  });

  it('imagen grande = riesgo; un logo pequeño (200x200) no', () => {
    const [grande] = analyzePages([page(1, [body(100)], { images: [{ w: 800, h: 600 }] })]);
    const [logo] = analyzePages([page(1, [body(100)], { images: [{ w: 200, h: 200 }] })]);
    expect(grande.risk).toContain('imagen');
    expect(logo.risk).toEqual([]);
  });

  it('un dibujo (muchos trazos) con poco texto es un grafico', () => {
    const [p] = analyzePages([page(1, [{ text: 'Eje X', y: 100 }], { paths: 120 })]);
    expect(p.risk).toContain('dibujo');
  });

  it('muchos trazos pero mucho texto NO es un grafico (un cuadro decorativo)', () => {
    const [p] = analyzePages([page(1, [{ text: 'x'.repeat(900), y: 100 }], { paths: 120 })]);
    expect(p.risk).not.toContain('dibujo');
  });

  it('una tabla (3+ filas con 3+ columnas separadas) es de riesgo', () => {
    const row = (y: number) => ({ y, parts: [{ str: 'a', x: 50 }, { str: 'b', x: 200 }, { str: 'c', x: 350 }] });
    const [p] = analyzePages([page(1, [body(50), row(100), row(120), row(140), row(160)])]);
    expect(p.risk).toContain('tabla');
  });

  it('una pagina en blanco sin dibujos no es de riesgo', () => {
    const [p] = analyzePages([page(1, [])]);
    expect(p.risk).toEqual([]);
    expect(p.markdown).toBe('');
  });
});

describe('analyzePages: orden', () => {
  it('conserva el orden del PDF (no reordena por posicion): dos columnas no se mezclan', () => {
    // Orden del flujo: columna izquierda completa y luego la derecha. Reordenar por y las mezclaria.
    const [p] = analyzePages([
      page(1, [
        { text: 'IZQ uno', y: 100, x: 50 },
        { text: 'IZQ dos', y: 300, x: 50 },
        { text: 'DER uno', y: 100, x: 320 },
        { text: 'DER dos', y: 300, x: 320 },
      ]),
    ]);
    expect(p.markdown.indexOf('IZQ dos')).toBeLessThan(p.markdown.indexOf('DER uno'));
  });
});
