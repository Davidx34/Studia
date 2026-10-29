import { defineConfig } from 'vitest/config';
import path from 'path';

// Protocolo 7.1.2 (post-auditoria): config minima, sin plugin de Next.js —
// las 5 funciones del alcance inicial son puras (sin JSX, sin dependencias
// de runtime de Next), asi que no hace falta el entorno jsdom ni el
// bundler de Next para probarlas. Se agrega el alias @/ para que los
// imports de las funciones bajo prueba (que importan otros modulos con
// ese alias) resuelvan igual que en la app real.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // next/font/google solo funciona dentro del compilador de Next: en las pruebas se usa un sustituto.
      'next/font/google': path.resolve(__dirname, './src/test/nextFontGoogleStub.ts'),
    },
  },
  // Vite 8 transforma con oxc: JSX automatico para probar componentes con react-dom/server (sin jsdom).
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
