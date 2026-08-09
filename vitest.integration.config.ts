import { defineConfig } from 'vitest/config';
import path from 'path';

// Config separada SOLO para tests/rls-integration.test.ts (y futuros tests
// de integracion que necesiten credenciales reales de Supabase). No forma
// parte de "npm test" ni de CI a proposito -- ver el comentario de
// cabecera de tests/rls-integration.test.ts. Uso manual:
//   npx vitest run --config vitest.integration.config.ts
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
