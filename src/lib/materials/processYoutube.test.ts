// Protocolo 7.1.2: extractYoutubeId es la puerta de entrada de todo el
// pipeline de YouTube (Sesion K/L) — si falla en reconocer un formato de
// URL valido, el profesor recibe "No reconocemos ese link" para un video
// perfectamente valido. Cubre los 4 formatos que el codigo dice soportar
// explicitamente (youtu.be, watch?v=, embed/, shorts/, live/) mas los
// casos de entrada invalida que deben devolver null sin lanzar excepcion.

import { describe, it, expect } from 'vitest';
import { extractYoutubeId } from './processYoutube';

describe('extractYoutubeId', () => {
  it('extrae el id de una URL youtu.be corta', () => {
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extrae el id de una URL youtu.be con parametros extra despues del id', () => {
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ?t=30')).toBe('dQw4w9WgXcQ');
  });

  it('extrae el id de una URL youtube.com/watch?v=', () => {
    expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extrae el id de youtube.com/watch?v= con parametros adicionales (ej: playlist)', () => {
    expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123')).toBe('dQw4w9WgXcQ');
  });

  it('extrae el id de una URL de embed', () => {
    expect(extractYoutubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extrae el id de una URL de shorts', () => {
    expect(extractYoutubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extrae el id de una URL de live', () => {
    expect(extractYoutubeId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('funciona sin el subdominio www', () => {
    expect(extractYoutubeId('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('devuelve null para una URL de youtube.com sin id reconocible', () => {
    expect(extractYoutubeId('https://www.youtube.com/channel/UC123456')).toBeNull();
  });

  it('devuelve null para una URL que no es de YouTube', () => {
    expect(extractYoutubeId('https://vimeo.com/12345678')).toBeNull();
  });

  it('devuelve null para un string que no es una URL valida, sin lanzar excepcion', () => {
    expect(() => extractYoutubeId('esto no es una url')).not.toThrow();
    expect(extractYoutubeId('esto no es una url')).toBeNull();
  });

  it('devuelve null para string vacio', () => {
    expect(extractYoutubeId('')).toBeNull();
  });

  it('devuelve null para youtu.be sin id (solo el dominio)', () => {
    expect(extractYoutubeId('https://youtu.be/')).toBeNull();
  });
});
