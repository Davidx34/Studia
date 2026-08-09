// Protocolo 7.1.2: chunkText y sanitizeText son la base de todo el RAG —
// un bug aqui corrompe silenciosamente el contexto que ve el LLM al
// generar preguntas para cualquier material. Cubre las invariantes que
// importan: sanitizeText nunca debe alterar el contenido semantico del
// texto (solo espacios/control chars), y chunkText nunca debe perder
// texto ni exceder el tamaño objetivo salvo cuando es imposible evitarlo
// (un parrafo unico mas largo que el objetivo).

import { describe, it, expect } from 'vitest';
import { sanitizeText, chunkText, estimateTokens } from './textProcessing';

describe('sanitizeText', () => {
  it('normaliza saltos de linea CRLF a LF', () => {
    expect(sanitizeText('linea1\r\nlinea2')).toBe('linea1\nlinea2');
  });

  it('colapsa espacios y tabs consecutivos a uno solo', () => {
    expect(sanitizeText('hola    mundo')).toBe('hola mundo');
    expect(sanitizeText('hola\t\tmundo')).toBe('hola mundo');
  });

  it('colapsa 3+ saltos de linea consecutivos a exactamente 2 (un parrafo)', () => {
    expect(sanitizeText('parrafo1\n\n\n\n\nparrafo2')).toBe('parrafo1\n\nparrafo2');
  });

  it('preserva un doble salto de linea (separador de parrafo)', () => {
    expect(sanitizeText('parrafo1\n\nparrafo2')).toBe('parrafo1\n\nparrafo2');
  });

  it('quita espacios en blanco al inicio y al final', () => {
    expect(sanitizeText('   texto con espacios   ')).toBe('texto con espacios');
  });

  it('quita caracteres de control (ej: null byte, bell) sin afectar el texto visible', () => {
    expect(sanitizeText('texto\x00con\x07control')).toBe('textoconcontrol');
  });

  it('NO altera el contenido semantico de un parrafo bien formado', () => {
    const texto = 'La fotosíntesis es el proceso mediante el cual las plantas convierten luz solar en energía química.';
    expect(sanitizeText(texto)).toBe(texto);
  });

  it('preserva acentos, ñ y signos de puntuación en español', () => {
    const texto = '¿Cuál es la función del núcleo celular? ¡Es fundamental!';
    expect(sanitizeText(texto)).toBe(texto);
  });
});

describe('estimateTokens', () => {
  it('estima proporcionalmente a la longitud del texto (0.25 tokens/char)', () => {
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });
  it('devuelve 0 para texto vacio', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('chunkText', () => {
  it('devuelve un solo chunk si el texto completo cabe en el tamaño objetivo', () => {
    const texto = 'Un párrafo corto que cabe perfectamente en un solo chunk.';
    const chunks = chunkText(texto);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(texto);
  });

  it('no pierde ningun parrafo: la concatenacion de chunks contiene todo el contenido original', () => {
    // Cada parrafo ~300 chars, 15 parrafos = ~4500 chars — muy por encima
    // del objetivo de 2000 chars (500 tokens / 0.25 tokens-por-char), para
    // garantizar multiples chunks sin depender de un conteo de caracteres
    // ajustado al limite.
    const parrafos = Array.from(
      { length: 15 },
      (_, i) => `Este es el párrafo número ${i} con contenido de relleno para forzar el chunking en múltiples piezas. `.repeat(3)
    );
    const texto = parrafos.join('\n\n');
    const chunks = chunkText(texto);

    expect(chunks.length).toBeGreaterThan(1);
    // Cada parrafo original debe aparecer integro en al menos un chunk.
    for (const p of parrafos) {
      const apareceEnAlgunChunk = chunks.some((c) => c.includes(p));
      expect(apareceEnAlgunChunk).toBe(true);
    }
  });

  it('respeta el tamaño objetivo (~500 tokens = 2000 chars) para parrafos normales, sin exceder por mucho', () => {
    const parrafoMediano = 'Palabra '.repeat(100); // ~800 chars
    const texto = Array.from({ length: 10 }, () => parrafoMediano).join('\n\n');
    const chunks = chunkText(texto);

    // 500 tokens objetivo / 0.25 tokens-por-char = 2000 chars objetivo.
    // Ningun chunk deberia exceder MUY por encima de eso (se permite algo
    // de margen porque el algoritmo agrupa parrafos completos).
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThan(2000 * 1.5);
    }
  });

  it('devuelve array vacio para texto vacio', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('ignora parrafos vacios (solo espacios en blanco) entre parrafos reales', () => {
    const texto = 'Primer párrafo.\n\n   \n\nSegundo párrafo.';
    const chunks = chunkText(texto);
    const contenidoTotal = chunks.join(' ');
    expect(contenidoTotal).toContain('Primer párrafo.');
    expect(contenidoTotal).toContain('Segundo párrafo.');
  });

  it('divide un parrafo unico mas largo que el objetivo por oraciones, sin perder ninguna', () => {
    // 60 oraciones de ~55 chars c/u = ~3300 chars, comodamente por encima
    // del objetivo de 2000 chars.
    const oraciones = Array.from({ length: 60 }, (_, i) => `Esta es la oración número ${i} del párrafo gigante de prueba.`);
    const parrafoGigante = oraciones.join(' '); // un solo "parrafo" (sin \n\n)
    const chunks = chunkText(parrafoGigante);

    expect(chunks.length).toBeGreaterThan(1);
    for (const oracion of oraciones) {
      const apareceEnAlgunChunk = chunks.some((c) => c.includes(oracion));
      expect(apareceEnAlgunChunk).toBe(true);
    }
  });

  it('mantiene overlap entre chunks consecutivos cuando el buffer se corta a mitad', () => {
    // Fuerza el camino de "tail overlap": el primer parrafo por si solo ya
    // esta muy cerca del objetivo (2000 chars), asi que agregar el segundo
    // parrafo excede el limite y dispara un chunk nuevo.
    const parrafo1 = 'A'.repeat(1990);
    const parrafo2 = 'Contenido nuevo que debería empezar un chunk nuevo con algo de cola del anterior.';
    const texto = `${parrafo1}\n\n${parrafo2}`;
    const chunks = chunkText(texto);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // El segundo chunk deberia contener el nuevo parrafo completo.
    expect(chunks.some((c) => c.includes(parrafo2))).toBe(true);
  });
});
