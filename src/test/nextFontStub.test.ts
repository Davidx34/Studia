import { describe, it, expect } from 'vitest';
import { fontClass } from '@/components/study/fichas/fichaFonts';

// Fuera del compilador de Next, next/font/google no tiene funciones ("Baloo_2 is not a function": asi fallo el CI). vitest.config.ts lo sustituye con un alias; esta
// prueba falla en cualquier entorno donde ese alias no este activo, en vez de romper por azar las pruebas que renderizan componentes con fuentes.
describe('sustituto de next/font/google en las pruebas', () => {
  it('importar fichaFonts no falla y devuelve la clase de cada fuente web', () => {
    expect(fontClass('baloo')).toBe('font-baloo');
    expect(fontClass('playfair')).toBe('font-playfair');
    expect(fontClass(null)).toBe('');
  });
});
