import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildAiStatus } from './status';
import { HealthTracker } from './health';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

describe('estado de la pasarela para el panel /dev', () => {
  const ENV = {
    GROQ_API_KEY: 'gsk_SECRETO_UNO_1234567890',
    CEREBRAS_API_KEY: 'csk_SECRETO_DOS_1234567890',
    SUPABASE_SERVICE_ROLE_KEY: 'eyJSECRETO_TRES',
    SERVER_GRADING: 'on',
    CLOUDFLARE_API_TOKEN: 'cf_SECRETO_CUATRO',
    CLOUDFLARE_ACCOUNT_ID: 'acct_SECRETO_CINCO',
  };

  it('nunca incluye valores de llaves ni identificadores de cuenta', () => {
    const json = JSON.stringify(buildAiStatus(ENV, new HealthTracker()));
    for (const secret of ['SECRETO_UNO', 'SECRETO_DOS', 'SECRETO_TRES', 'SECRETO_CUATRO', 'SECRETO_CINCO']) expect(json).not.toContain(secret);
  });

  it('dice que proveedores estan activos y las cadenas efectivas', () => {
    const s = buildAiStatus(ENV, new HealthTracker());
    const on = s.providers.filter((p) => p.configured).map((p) => p.id).sort();
    expect(on).toEqual(['cerebras', 'cloudflare', 'groq']);
    expect(s.chains.generation[0]).toBe('cerebras:gpt-oss-120b');
    expect(s.chains.judge.every((c) => /^(groq|cerebras|cloudflare):/.test(c))).toBe(true);
    expect(s.flags).toEqual({ serviceRoleKey: true, serverGrading: true });
  });

  it('sin variables: nada activo y cadenas vacias', () => {
    const s = buildAiStatus({}, new HealthTracker());
    expect(s.providers.some((p) => p.configured)).toBe(false);
    expect(Object.values(s.chains).every((c) => c.length === 0)).toBe(true);
    expect(s.flags).toEqual({ serviceRoleKey: false, serverGrading: false });
  });

  it('refleja los cortacircuitos de la instancia', () => {
    let t = 1_000_000;
    const h = new HealthTracker(() => t);
    h.failure({ provider: 'groq', model: 'm' }, 'auth');
    h.success({ provider: 'cerebras', model: 'n' }, 120);
    const s = buildAiStatus(ENV, h, t);
    const g = s.breakers.find((b) => b.key === 'groq:m')!;
    expect(g.available).toBe(false);
    expect(g.reopensInSeconds).toBeGreaterThan(0);
    expect(s.breakers.find((b) => b.key === 'cerebras:n')).toMatchObject({ available: true, latencyMs: 120, calls: 1 });
  });

  it('la ruta exige la sesion del panel y solo devuelve este estado', () => {
    const src = read('src/app/api/dev/system-health/route.ts');
    expect(src).toContain('requireDevSession()');
    expect(src).toContain('buildAiStatus()');
  });
});
