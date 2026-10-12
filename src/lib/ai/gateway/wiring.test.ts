import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const GATEWAY = ['types', 'health', 'providers', 'client', 'router', 'index'].map((f) => `src/lib/ai/gateway/${f}.ts`);

describe('pasarela de IA: integracion y seguridad', () => {
  it('las llaves salen SOLO del entorno: ninguna llave escrita en el codigo ni enviada a un log', () => {
    for (const f of GATEWAY) {
      const src = read(f);
      expect(src).not.toMatch(/\b(sk|gsk|csk|nvapi|ghp|github_pat|AIza)[-_A-Za-z0-9]{12,}/); // formas tipicas de llaves reales
      expect(src).not.toMatch(/console\.(log|warn|error)\([^)]*(env\[|process\.env)/);
    }
  });

  it('el codigo del navegador no importa la pasarela', () => {
    const files = ['src/app/(student)/lesson/[id]/page.tsx', 'src/components/LessonQuestionMatch.tsx'];
    for (const f of files) expect(read(f)).not.toContain('ai/gateway');
  });

  it('el respaldo de generacion y el del juez pasan por la pasarela', () => {
    const gen = read('src/lib/questions/cohereGeneration.ts');
    expect(gen).toContain("routeText<any[]>({");
    expect(gen).toContain("hasProviderFor('generation')");
    const judge = read('src/lib/questions/judge.ts');
    expect(judge).toContain("task: 'judge'");
    // Gemini ya fallo antes de llegar al respaldo: no se le vuelve a pedir
    expect(judge).toContain("exclude: ['gemini']");
  });

  it('cada proveedor del catalogo tiene llave, enlace de alta y nivel', () => {
    const src = read('src/lib/ai/gateway/providers.ts');
    expect((src.match(/keyEnv:/g) ?? []).length).toBeGreaterThanOrEqual(10);
    expect(src).toContain("tier: 'paid'");
    expect(src).toContain("tier: 'self'");
  });
});
