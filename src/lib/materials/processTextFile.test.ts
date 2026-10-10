import { describe, it, expect } from 'vitest';
import { decodeTextFile } from './processTextFile';
import { detectMimeType, validateFile } from './file-helpers';
import { TEXT_MIME_TYPES, ALLOWED_MIME_TYPES, ACCEPT_ATTRIBUTE } from './constants';
import { extractMathSegments, countInvalidLatex, defaultLatexRenderer } from './pdfVerify';

const file = (name: string, type = '', size = 100) => ({ name, type, size }) as File;

describe('archivos .md y .txt', () => {
  it('se aceptan: el navegador los reporta como "" o text/plain y la extension decide', () => {
    expect(detectMimeType(file('guia.md'))).toBe('text/markdown');
    expect(detectMimeType(file('guia.md', 'text/plain'))).toBe('text/markdown');
    expect(detectMimeType(file('notas.txt', 'text/plain'))).toBe('text/plain');
    expect(detectMimeType(file('guia.MARKDOWN'))).toBe('text/markdown');
    expect(validateFile(file('guia.md'))).toBeNull();
  });

  it('los tipos nuevos estan permitidos y en el selector de archivos', () => {
    TEXT_MIME_TYPES.forEach((m) => expect(ALLOWED_MIME_TYPES as readonly string[]).toContain(m));
    expect(ACCEPT_ATTRIBUTE).toContain('.md');
    expect(ACCEPT_ATTRIBUTE).toContain('.txt');
  });

  it('un PDF sigue siendo PDF y un .exe sigue rechazado', () => {
    expect(detectMimeType(file('a.pdf', 'application/pdf'))).toBe('application/pdf');
    expect(validateFile(file('virus.exe'))?.code).toBe('invalid_mime');
  });

  it('decodeTextFile quita el BOM de los editores de Windows y conserva tildes', () => {
    const bytes = new TextEncoder().encode('﻿# Fórmulas\n- ñandú');
    expect(decodeTextFile(bytes)).toBe('# Fórmulas\n- ñandú');
  });
});

describe('signo de pesos escapado dentro de una formula', () => {
  it('REGRESION: "$CMg = \$2$" es UNA formula valida (antes se partia en "CMg = \\")', async () => {
    const render = await defaultLatexRenderer();
    const BS = String.fromCharCode(92);
    const md = `Costo $CMg = ${BS}$2$ y $P^* = ${BS}$6$ con $Q = 40$.`;
    expect(extractMathSegments(md).map((s) => s.expression)).toEqual([`CMg = ${BS}$2`, `P^* = ${BS}$6`, 'Q = 40']);
    expect(countInvalidLatex(md, render)).toEqual({ total: 3, invalid: 0 });
  });

  it('una formula realmente rota sigue detectandose', async () => {
    const render = await defaultLatexRenderer();
    expect(countInvalidLatex(`$${String.fromCharCode(92)}frac{a}{$`, render).invalid).toBe(1);
  });

  it('formulas de bloque con signo de pesos escapado dentro', () => {
    const BS = String.fromCharCode(92);
    expect(extractMathSegments(`$$ EC = ${BS}$320 $$`).map((s) => s.expression)).toEqual([`EC = ${BS}$320`]);
  });
});
