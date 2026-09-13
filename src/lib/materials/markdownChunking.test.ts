// Cubre las dos garantias nuevas que markdownChunking.ts agrega sobre el
// chunking generico (ver textProcessing.test.ts para las garantias que ya
// existian y siguen intactas): 1) nunca partir una tabla ni un bloque de
// codigo entre dos chunks, y 2) etiquetar cada chunk con la ruta de
// encabezados activa. Sin red -- logica pura, igual que textProcessing.test.ts.

import { describe, it, expect } from 'vitest';
import { segmentMarkdown, chunkMarkdownAware } from './markdownChunking';

const TARGET = 300; // chars — deliberadamente chico para forzar chunking en los tests
const OVERLAP = 30;

describe('segmentMarkdown', () => {
  it('agrupa un bloque de codigo (```...```) como un solo segmento atomico', () => {
    const texto = 'Antes del codigo.\n\n```js\nconst x = 1;\nconst y = 2;\n```\n\nDespues del codigo.';
    const segs = segmentMarkdown(texto);
    const codeSeg = segs.find((s) => s.text.includes('const x = 1;'));
    expect(codeSeg).toBeDefined();
    expect(codeSeg!.atomic).toBe(true);
    expect(codeSeg!.text).toContain('const y = 2;');
    expect(codeSeg!.text.startsWith('```js')).toBe(true);
    expect(codeSeg!.text.endsWith('```')).toBe(true);
  });

  it('agrupa una tabla Markdown completa (header + separador + filas) como un solo segmento atomico', () => {
    const texto = [
      'Texto antes.',
      '',
      '| Concepto | Definición |',
      '| --- | --- |',
      '| Oferta | Cantidad ofrecida a cada precio |',
      '| Demanda | Cantidad demandada a cada precio |',
      '',
      'Texto después.',
    ].join('\n');
    const segs = segmentMarkdown(texto);
    const tableSeg = segs.find((s) => s.text.includes('| Concepto |'));
    expect(tableSeg).toBeDefined();
    expect(tableSeg!.atomic).toBe(true);
    expect(tableSeg!.text).toContain('| Oferta | Cantidad ofrecida a cada precio |');
    expect(tableSeg!.text).toContain('| Demanda | Cantidad demandada a cada precio |');
  });

  it('rastrea la ruta de encabezados anidados correctamente', () => {
    const texto = [
      '# Unidad 2',
      'Intro de la unidad.',
      '',
      '## Teoría del Consumidor',
      'Contenido de la sección.',
      '',
      '### Utilidad Marginal',
      'Contenido mas especifico.',
    ].join('\n');
    const segs = segmentMarkdown(texto);

    const intro = segs.find((s) => s.text.includes('Intro de la unidad'));
    expect(intro!.headingPath).toEqual(['Unidad 2']);

    const seccion = segs.find((s) => s.text.includes('Contenido de la sección'));
    expect(seccion!.headingPath).toEqual(['Unidad 2', 'Teoría del Consumidor']);

    const subseccion = segs.find((s) => s.text.includes('Contenido mas especifico'));
    expect(subseccion!.headingPath).toEqual(['Unidad 2', 'Teoría del Consumidor', 'Utilidad Marginal']);
  });

  it('cierra una sub-sección al volver a un encabezado del mismo nivel o superior (no anida hermanos)', () => {
    const texto = [
      '## Sección A',
      'Contenido A.',
      '',
      '## Sección B',
      'Contenido B.',
    ].join('\n');
    const segs = segmentMarkdown(texto);
    const segA = segs.find((s) => s.text === 'Contenido A.');
    const segB = segs.find((s) => s.text === 'Contenido B.');
    expect(segA!.headingPath).toEqual(['Sección A']);
    expect(segB!.headingPath).toEqual(['Sección B']);
  });

  it('texto plano sin ningun elemento Markdown produce segmentos no-atomicos sin heading path (comportamiento identico al chunking generico)', () => {
    const texto = 'Un párrafo cualquiera.\n\nOtro párrafo más.';
    const segs = segmentMarkdown(texto);
    expect(segs).toHaveLength(2);
    expect(segs.every((s) => !s.atomic)).toBe(true);
    expect(segs.every((s) => s.headingPath.length === 0)).toBe(true);
  });
});

describe('chunkMarkdownAware', () => {
  it('nunca parte una tabla entre dos chunks aunque el resto del contenido fuerce chunking', () => {
    const relleno = 'Palabra de relleno para forzar el chunking. '.repeat(10); // ~450 chars, > TARGET
    const tabla = [
      '| Concepto | Definición |',
      '| --- | --- |',
      '| Oferta | Cantidad ofrecida a cada precio |',
      '| Demanda | Cantidad demandada a cada precio |',
      '| Equilibrio | Punto donde oferta y demanda coinciden |',
    ].join('\n');
    const texto = `${relleno}\n\n${tabla}\n\n${relleno}`;

    const chunks = chunkMarkdownAware(texto, TARGET, OVERLAP);

    // La tabla completa debe aparecer INTEGRA en un solo chunk.
    const chunkConTabla = chunks.find((c) => c.includes('| Concepto |'));
    expect(chunkConTabla).toBeDefined();
    expect(chunkConTabla).toContain('| Oferta | Cantidad ofrecida a cada precio |');
    expect(chunkConTabla).toContain('| Demanda | Cantidad demandada a cada precio |');
    expect(chunkConTabla).toContain('| Equilibrio | Punto donde oferta y demanda coinciden |');

    // Ningun OTRO chunk debe contener una fila suelta de esa tabla (senal de
    // que se partio a la mitad).
    const otrosChunks = chunks.filter((c) => c !== chunkConTabla);
    for (const c of otrosChunks) {
      expect(c).not.toContain('| Oferta');
      expect(c).not.toContain('| Demanda');
    }
  });

  it('la cola de overlap nunca reinserta un fragmento de tabla sin su encabezado en el chunk siguiente (bug real encontrado al verificar con una muestra realista)', () => {
    // Caso especifico que el test anterior no cubria: relleno ANTES y
    // DESPUES de la tabla, de forma que la tabla termina de llenar un
    // chunk y el parrafo siguiente dispara el mecanismo de "cola de
    // overlap" -- el buffer que se acaba de cerrar termina en la tabla, asi
    // que tomar sus ultimos N caracteres como cola cortaria filas de la
    // tabla sin su encabezado.
    const tabla = [
      '| Unidades | Utilidad Total |',
      '| --- | --- |',
      '| 1 | 10 |',
      '| 2 | 18 |',
      '| 3 | 24 |',
      '| 4 | 28 |',
    ].join('\n');
    const parrafoLargo = 'Contenido de relleno para llenar el chunk hasta el limite. '.repeat(6);
    const parrafoSiguiente = 'La utilidad marginal es decreciente en este ejemplo.';
    const texto = `${parrafoLargo}\n\n${tabla}\n\n${parrafoSiguiente}`;

    const chunks = chunkMarkdownAware(texto, TARGET, OVERLAP);

    // Cualquier chunk que contenga una fila de datos de la tabla debe
    // contener TAMBIEN su encabezado -- nunca una fila huerfana.
    for (const c of chunks) {
      const tieneFilaDeDatos = /\|\s*[1-4]\s*\|\s*(10|18|24|28)\s*\|/.test(c);
      if (tieneFilaDeDatos) {
        expect(c).toContain('| Unidades | Utilidad Total |');
      }
    }
  });

  it('nunca parte un bloque de codigo entre dos chunks', () => {
    const relleno = 'Texto de relleno para forzar el chunking en varias piezas. '.repeat(10);
    const codigo = '```python\ndef f(x):\n    return x ** 2\n\ndef g(x):\n    return f(x) + 1\n```';
    const texto = `${relleno}\n\n${codigo}\n\n${relleno}`;

    const chunks = chunkMarkdownAware(texto, TARGET, OVERLAP);
    const chunkConCodigo = chunks.find((c) => c.includes('def f(x)'));
    expect(chunkConCodigo).toBeDefined();
    expect(chunkConCodigo).toContain('def g(x):');
    expect(chunkConCodigo).toContain('```');
  });

  it('antepone la ruta de sección a los chunks que caen dentro de un heading', () => {
    const texto = [
      '## Teoría del Consumidor',
      'Contenido largo de la sección. '.repeat(5),
    ].join('\n\n');
    const chunks = chunkMarkdownAware(texto, TARGET, OVERLAP);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toContain('[Sección: Teoría del Consumidor]');
  });

  it('texto plano sin headings/tablas/codigo no lleva ningun prefijo de sección', () => {
    const texto = 'Un párrafo corto que cabe perfectamente en un solo chunk.';
    const chunks = chunkMarkdownAware(texto, 2000, 200);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(texto);
    expect(chunks[0]).not.toContain('[Sección:');
  });

  it('no pierde contenido: cada segmento original aparece integro en algun chunk (texto con headings mezclados)', () => {
    const texto = [
      '# Introducción',
      'Parrafo intro uno. '.repeat(4),
      '',
      '## Parte 1',
      'Contenido parte 1. '.repeat(4),
      '',
      '## Parte 2',
      'Contenido parte 2. '.repeat(4),
    ].join('\n');

    const segs = segmentMarkdown(texto).map((s) => s.text);
    const chunks = chunkMarkdownAware(texto, TARGET, OVERLAP);
    for (const seg of segs) {
      expect(chunks.some((c) => c.includes(seg))).toBe(true);
    }
  });
});
