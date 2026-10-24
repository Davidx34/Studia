import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { isPublicAsset } from './routes';

// Sin sesion: getUser() devuelve user null, como en la pantalla de acceso.
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

import { middleware } from '@/middleware';

describe('isPublicAsset', () => {
  it('deja publicos el manifest, los iconos y Tonito', () => {
    expect(isPublicAsset('/manifest.json')).toBe(true);
    expect(isPublicAsset('/icons/icon-192.png')).toBe(true);
    expect(isPublicAsset('/icons/icon-512.png')).toBe(true);
    expect(isPublicAsset('/tonito/happy.png')).toBe(true);
  });

  it('no abre rutas de la app ni de la API', () => {
    for (const p of ['/', '/dashboard', '/teacher/dashboard', '/api/lessons', '/api/tonito/chat', '/my-classes', '/login']) {
      expect(isPublicAsset(p)).toBe(false);
    }
  });

  it('no se deja engañar por prefijos parecidos, carpetas vacias ni ..', () => {
    expect(isPublicAsset('/icons')).toBe(false);
    expect(isPublicAsset('/icons/')).toBe(false);
    expect(isPublicAsset('/iconsx/a.png')).toBe(false);
    expect(isPublicAsset('/tonito-secreto/a.png')).toBe(false);
    expect(isPublicAsset('/manifest.json/x')).toBe(false);
    expect(isPublicAsset('/icons/../dashboard')).toBe(false);
  });
});

describe('middleware sin sesion', () => {
  const run = (path: string) => middleware(new NextRequest(`http://localhost:3000${path}`));

  it.each(['/manifest.json', '/icons/icon-192.png', '/tonito/happy.png'])(
    'deja pasar %s (sin redirigir a /login)',
    async (path) => {
      const res = await run(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    }
  );

  it.each(['/dashboard', '/teacher/dashboard', '/my-classes'])(
    'sigue redirigiendo %s a /login',
    async (path) => {
      const res = await run(path);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3000/login');
    }
  );
});
