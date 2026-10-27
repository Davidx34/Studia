import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveSceneClip, rowToClip, TONITO_CLIPS, type SceneClipRow } from './clips';
import { CINEMATIC_TYPES, SCENE_DEFAULT_CLIP, isCinematicType } from './scenes';

const row = (over: Partial<SceneClipRow> = {}): SceneClipRow => ({
  scene: 'welcome', clip_id: 'bienvenida', src: 'clips/bienvenida.v1.mp4', poster: 'clips/bienvenida.v1.jpg', width: 720, height: 1280, loop: false, active: true, ...over,
});
const CODE = TONITO_CLIPS.celebracion;

describe('rowToClip', () => {
  it('convierte una fila valida', () => {
    expect(rowToClip(row())).toEqual({ id: 'bienvenida', src: 'clips/bienvenida.v1.mp4', poster: 'clips/bienvenida.v1.jpg', width: 720, height: 1280, loop: false });
  });
  it('rechaza rutas fuera de clips/, sin version o con ..', () => {
    for (const src of ['otra/x.v1.mp4', 'clips/x.mp4', 'clips/../x.v1.mp4', 'https://malo.com/x.v1.mp4', '/clips/x.v1.mp4']) {
      expect(rowToClip(row({ src }))).toBeNull();
    }
    expect(rowToClip(row({ poster: 'clips/x.v1.png' }))).toBeNull();
  });
  it('rechaza medidas absurdas e ids invalidos', () => {
    expect(rowToClip(row({ width: 0 }))).toBeNull();
    expect(rowToClip(row({ height: 99999 }))).toBeNull();
    expect(rowToClip(row({ width: NaN }))).toBeNull();
    expect(rowToClip(row({ clip_id: 'Mi Clip' }))).toBeNull();
  });
});

describe('resolveSceneClip: la base manda sobre el codigo', () => {
  it('fila activa y valida -> ese clip, aunque el codigo traiga otro', () => {
    expect(resolveSceneClip('welcome', [row()], CODE)?.id).toBe('bienvenida');
  });
  it('fila apagada -> ninguno, aunque el codigo traiga uno', () => {
    expect(resolveSceneClip('welcome', [row({ active: false })], CODE)).toBeUndefined();
  });
  it('sin fila para esa escena -> el clip del codigo', () => {
    expect(resolveSceneClip('streak', [row()], CODE)).toBe(CODE);
    expect(resolveSceneClip('streak', [row()], undefined)).toBeUndefined();
  });
  it('no se pudo leer la base (null) -> el clip del codigo', () => {
    expect(resolveSceneClip('welcome', null, CODE)).toBe(CODE);
  });
  it('fila invalida -> el clip del codigo, nunca rompe la escena', () => {
    expect(resolveSceneClip('welcome', [row({ src: 'https://malo.com/x.mp4' })], CODE)).toBe(CODE);
  });
});

describe('escenas', () => {
  it('son las 5 de siempre y isCinematicType las reconoce', () => {
    expect([...CINEMATIC_TYPES]).toEqual(['welcome', 'lesson_start', 'module_complete_good', 'module_complete_low', 'streak']);
    expect(isCinematicType('streak')).toBe(true);
    expect(isCinematicType('otra')).toBe(false);
  });
  it('el respaldo del codigo apunta a clips que existen en el registro', () => {
    for (const id of Object.values(SCENE_DEFAULT_CLIP)) expect(TONITO_CLIPS[id!]).toBeDefined();
  });
});

describe('loadSceneClips', () => {
  const select = vi.fn();
  beforeEach(async () => {
    vi.resetModules();
    select.mockReset();
    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => ({ from: () => ({ select }) }) }));
  });

  it('lee la tabla una vez y la guarda en cache', async () => {
    select.mockResolvedValue({ data: [row()], error: null });
    const m = await import('./sceneClips');
    expect(await m.loadSceneClips()).toEqual([row()]);
    expect(await m.loadSceneClips()).toEqual([row()]);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('peticiones simultaneas comparten una sola lectura', async () => {
    select.mockResolvedValue({ data: [row()], error: null });
    const m = await import('./sceneClips');
    await Promise.all([m.loadSceneClips(), m.loadSceneClips(), m.loadSceneClips()]);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('si la base da error (por ejemplo la tabla aun no existe) devuelve null y no lanza', async () => {
    select.mockResolvedValue({ data: null, error: { message: 'relation does not exist' } });
    const m = await import('./sceneClips');
    expect(await m.loadSceneClips()).toBeNull();
  });

  it('si la peticion revienta devuelve null y no lanza; el siguiente intento vuelve a pedir', async () => {
    select.mockRejectedValueOnce(new Error('red caida')).mockResolvedValueOnce({ data: [row()], error: null });
    const m = await import('./sceneClips');
    expect(await m.loadSceneClips()).toBeNull();
    expect(await m.loadSceneClips()).toEqual([row()]);
  });
});

describe('CinematicScene con la base ya leida', () => {
  it('sin clip (o con la base caida) se comporta como siempre: Toñito animado y ningun video', async () => {
    vi.resetModules();
    vi.doMock('@/lib/tonito/sceneClips', () => ({ useSceneClips: () => ({ ready: true, rows: null }), loadSceneClips: async () => null }));
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { CinematicScene } = await import('@/components/cinematics/CinematicScene');
    const out = renderToStaticMarkup(h(CinematicScene, { type: 'welcome', studentName: 'Ana', onComplete: () => {} }));
    expect(out).toContain('tonito-character');
    expect(out).not.toContain('<video');
    expect(out).not.toContain('aria-busy');
    vi.doUnmock('@/lib/tonito/sceneClips');
  });
});

// Colores de borde del clip (migracion 074): la escena los pinta de fondo para que el clip no se distinga de los lados en una pantalla ancha.
describe('bg_colors (colores de borde del clip)', () => {
  const COLORES = ['#edbb74', '#e8ac6e', '#dc8a64', '#e7a06a', '#d87c65', '#cd555e'];

  it('una fila con 6 colores validos los pasa al clip', () => {
    expect(rowToClip(row({ bg_colors: COLORES }))?.bgColors).toEqual(COLORES);
    expect(resolveSceneClip('welcome', [row({ bg_colors: COLORES })])?.bgColors).toEqual(COLORES);
  });

  it('sin colores (null, ausente o la columna aun no existe) el clip vale igual, sin bgColors', () => {
    expect(rowToClip(row())?.bgColors).toBeUndefined();
    expect(rowToClip(row({ bg_colors: null }))?.bgColors).toBeUndefined();
  });

  it('colores mal formados se ignoran, y el clip sigue valiendo (nunca rompen la escena ni inyectan CSS)', () => {
    for (const malos of [COLORES.slice(0, 5), [...COLORES.slice(0, 5), 'red'], [...COLORES.slice(0, 5), 'url(x)'], [...COLORES.slice(0, 5), '#EDBB74'], 'no-es-lista' as any]) {
      const c = rowToClip(row({ bg_colors: malos }));
      expect(c, JSON.stringify(malos)).not.toBeNull();
      expect(c!.bgColors).toBeUndefined();
    }
  });

  it('el clip de respaldo del codigo no trae colores (usa el degradado de siempre)', () => {
    expect(TONITO_CLIPS.celebracion.bgColors).toBeUndefined();
  });
});
