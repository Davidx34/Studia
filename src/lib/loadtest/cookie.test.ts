import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createServerClient } from '@supabase/ssr';
// módulo JS de k6: no importa nada de k6, para poder probarse aquí
import { authCookieName, authCookies, cookieHeader, MAX_CHUNK_SIZE, projectRef } from '../../../loadtest/lib/cookie.js';

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const URL_ = 'https://abcdefghijklmnop.supabase.co';
const session = (pad = 0) => ({
  access_token: 'eyJ' + 'a'.repeat(900 + pad),
  refresh_token: 'r'.repeat(12),
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'carga@ejemplo.test', app_metadata: { provider: 'email' }, user_metadata: { nota: 'ñ' } },
});

// La prueba de verdad: la cookie que arma el script de k6 la LEE el propio @supabase/ssr (el mismo que usa el middleware de la app) y devuelve la misma sesion.
async function readBack(header: string) {
  const jar = header.split('; ').map((p) => ({ name: p.slice(0, p.indexOf('=')), value: p.slice(p.indexOf('=') + 1) }));
  const supabase = createServerClient(URL_, 'anon-key', { cookies: { getAll: () => jar, setAll: () => {} } });
  return (await supabase.auth.getSession()).data.session;
}

describe('cookie de sesion de las pruebas de carga', () => {
  it('nombre del proyecto y de la cookie', () => {
    expect(projectRef(URL_)).toBe('abcdefghijklmnop');
    expect(authCookieName(URL_)).toBe('sb-abcdefghijklmnop-auth-token');
    expect(() => projectRef('no-es-url')).toThrow();
  });
  it('sesion corta: una sola cookie que @supabase/ssr lee de vuelta', async () => {
    const c = authCookies(authCookieName(URL_), session(), b64url);
    expect(c.length).toBe(1);
    expect(c[0].value.startsWith('base64-')).toBe(true);
    const back = await readBack(cookieHeader(c));
    expect(back?.access_token).toBe(session().access_token);
    expect(back?.user.email).toBe('carga@ejemplo.test');
  });
  it('sesion larga: se parte en trozos de 3180 (.0, .1...) y vuelve entera', async () => {
    const s = session(4000);
    const c = authCookies(authCookieName(URL_), s, b64url);
    expect(c.length).toBeGreaterThan(1);
    expect(c.map((x: { name: string }) => x.name)).toEqual(c.map((_: unknown, i: number) => `sb-abcdefghijklmnop-auth-token.${i}`));
    for (const x of c.slice(0, -1)) expect(x.value.length).toBe(MAX_CHUNK_SIZE);
    const back = await readBack(cookieHeader(c));
    expect(back?.access_token).toBe(s.access_token);
  });
  it('el tamano de trozo coincide con el de @supabase/ssr', async () => {
    const ssr = await import('@supabase/ssr');
    expect(MAX_CHUNK_SIZE).toBe(ssr.MAX_CHUNK_SIZE);
  });
});

describe('scripts de k6: estructura y seguridad', () => {
  const dir = path.join(process.cwd(), 'loadtest');
  const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
  it('no hay secretos: users.json y los resultados no se versionan; el ejemplo no trae claves reales', () => {
    const gi = fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8');
    expect(gi).toContain('loadtest/users.json');
    expect(gi).toContain('loadtest/results/');
    expect(read('users.example.json')).toContain('CAMBIAR');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).concat(['lib/auth.js', 'lib/config.js', 'lib/cookie.js'])) {
      expect(read(f), f).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}|service_role|sk-[A-Za-z0-9]{20,}/);
    }
  });
  it('la prueba de leccion se ABORTA si el servidor genera con IA (no gastar la cuota)', () => {
    const s = read('03-lesson-flow.js');
    expect(s).toContain("unexpected_generation: [{ threshold: 'count==0', abortOnFail: true }]");
    expect(s).toContain('body.cached !== true');
  });
  it('cada escenario declara umbrales y lee todo de variables de entorno', () => {
    for (const f of ['01-public.js', '02-student-pages.js', '03-lesson-flow.js']) {
      const s = read(f);
      expect(s, f).toContain('thresholds');
      expect(s, f).toContain("stagesFor(env('PROFILE', 'smoke'))");
    }
    expect(read('lib/config.js')).toContain("required('BASE_URL')");
  });
  it('los perfiles existen y los desconocidos fallan', async () => {
    const { stagesFor } = await import('../../../loadtest/lib/config.js');
    (globalThis as any).__ENV = {};
    for (const p of ['smoke', 'load', 'stress', 'spike', 'soak', 'aula']) expect(stagesFor(p).executor, p).toMatch(/vus/);
    expect(() => stagesFor('otro')).toThrow(/desconocido/);
    expect((stagesFor('aula') as any).stages[0]).toEqual({ duration: '10s', target: 40 });
  });
});
