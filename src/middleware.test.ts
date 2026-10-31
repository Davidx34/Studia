import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// El middleware de acceso. setAll de Supabase NO puede devolver una respuesta (su tipo es void): las cookies de la renovacion de la sesion se guardan y se aplican a la
// respuesta que SE DEVUELVE. Antes se creaba una respuesta dentro de setAll y se descartaba, asi que esas cookies nunca llegaban al navegador.

const h = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  role: 'student' as string | null,
  throwOnGetUser: false,
  refresh: [{ name: 'sb-access', value: 'token-nuevo', options: { path: '/', httpOnly: true } }] as { name: string; value: string; options: Record<string, unknown> }[],
  created: 0,
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: (c: typeof h.refresh) => void } }) => {
    h.created++;
    return {
      auth: {
        getUser: async () => {
          if (h.throwOnGetUser) throw new Error('supabase caido');
          // Supabase renueva la sesion durante getUser y pide fijar las cookies nuevas.
          if (h.refresh.length > 0) opts.cookies.setAll(h.refresh);
          return { data: { user: h.user } };
        },
      },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: h.role ? { role: h.role } : null }) }) }) }),
    };
  },
}));

import { middleware } from './middleware';

const run = (pathname: string) => middleware(new NextRequest('http://localhost' + pathname));
const location = (res: Response) => new URL(res.headers.get('location') ?? '', 'http://localhost').pathname;
const cookie = (res: { cookies: { get: (n: string) => { value: string } | undefined } }) => res.cookies.get('sb-access')?.value;

beforeEach(() => {
  h.user = { id: 'u1' };
  h.role = 'student';
  h.throwOnGetUser = false;
  h.refresh = [{ name: 'sb-access', value: 'token-nuevo', options: { path: '/', httpOnly: true } }];
  h.created = 0;
});

describe('middleware: la sesion renovada llega al navegador', () => {
  it('un estudiante en su ruta pasa Y recibe la cookie renovada', async () => {
    const res = await run('/dashboard');
    expect(res.status).toBe(200);
    expect(cookie(res)).toBe('token-nuevo');
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
  });

  it('una redireccion por rol tambien lleva la cookie (si no, el usuario pierde la sesion renovada)', async () => {
    h.role = 'teacher';
    const res = await run('/dashboard');
    expect(res.status).toBe(307);
    expect(location(res)).toBe('/teacher/dashboard');
    expect(cookie(res)).toBe('token-nuevo');
  });

  it('un estudiante en una ruta de profesor va al dashboard, con la cookie', async () => {
    const res = await run('/teacher/classrooms');
    expect(location(res)).toBe('/dashboard');
    expect(cookie(res)).toBe('token-nuevo');
  });

  it('una pagina de acceso con sesion redirige segun el rol, con la cookie', async () => {
    expect(location(await run('/login'))).toBe('/dashboard');
    h.role = 'teacher';
    const res = await run('/login');
    expect(location(res)).toBe('/teacher/dashboard');
    expect(cookie(res)).toBe('token-nuevo');
  });

  it('sin renovacion no se fija ninguna cookie', async () => {
    h.refresh = [];
    const res = await run('/dashboard');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('varias cookies de la renovacion se aplican todas', async () => {
    h.refresh = [
      { name: 'sb-access', value: 'a', options: { path: '/' } },
      { name: 'sb-refresh', value: 'b', options: { path: '/' } },
    ];
    const res = await run('/dashboard');
    expect(res.cookies.get('sb-access')?.value).toBe('a');
    expect(res.cookies.get('sb-refresh')?.value).toBe('b');
  });
});

describe('middleware: el control de acceso no cambia', () => {
  it('sin sesion, una ruta protegida va a /login', async () => {
    h.user = null;
    const res = await run('/dashboard');
    expect(res.status).toBe(307);
    expect(location(res)).toBe('/login');
  });

  it('sin sesion, una pagina publica o de acceso pasa', async () => {
    h.user = null;
    expect((await run('/login')).status).toBe(200);
    expect((await run('/forgot-password')).status).toBe(200);
  });

  it('un profesor en una ruta de estudiante va a su dashboard', async () => {
    h.role = 'teacher';
    expect(location(await run('/lesson/abc'))).toBe('/teacher/dashboard');
  });

  it('el panel de desarrollo no pasa por el control de Supabase', async () => {
    h.user = null;
    expect((await run('/dev/panel')).status).toBe(200);
    expect((await run('/api/dev/system-health')).status).toBe(200);
  });

  it('los assets publicos ni siquiera crean el cliente de Supabase', async () => {
    h.user = null;
    expect((await run('/manifest.json')).status).toBe(200);
    expect((await run('/icons/icon-192.png')).status).toBe(200);
    expect(h.created).toBe(0);
  });

  it('FALLA CERRADO: si Supabase falla, una ruta protegida va a /login y una publica pasa', async () => {
    h.throwOnGetUser = true;
    const protectedRes = await run('/teacher/classrooms');
    expect(protectedRes.status).toBe(307);
    expect(location(protectedRes)).toBe('/login');
    expect((await run('/dashboard')).status).toBe(307);
    expect((await run('/login')).status).toBe(200);
    expect((await run('/api/dev/system-health')).status).toBe(200);
  });

  it('perfil sin rol: se trata como estudiante', async () => {
    h.role = null;
    expect((await run('/dashboard')).status).toBe(200);
    expect(location(await run('/teacher/classrooms'))).toBe('/dashboard');
  });
});
