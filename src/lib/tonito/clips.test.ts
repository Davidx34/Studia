import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TONITO_CLIPS, planClip, readClipEnvironment, sceneUsesVideo, type TonitoClipDef } from './clips';
import { TonitoClip } from '@/components/tonito/TonitoClip';
import { CinematicScene } from '@/components/cinematics/CinematicScene';

const CLIP: TonitoClipDef = { id: 'prueba', src: '/tonito/clips/prueba.mp4', poster: '/tonito/clips/prueba.jpg', width: 480, height: 270, loop: false };

describe('planClip', () => {
  it('con un entorno normal reproduce el video', () => {
    expect(planClip({ reducedMotion: false })).toEqual({ mode: 'video', reason: 'ok' });
    expect(planClip({ reducedMotion: false, saveData: false, effectiveType: '4g', canPlayMp4: true })).toEqual({ mode: 'video', reason: 'ok' });
  });

  it('con movimiento reducido NO carga el video', () => {
    expect(planClip({ reducedMotion: true })).toEqual({ mode: 'still', reason: 'reduced-motion' });
  });

  it('con ahorro de datos o conexion muy lenta NO carga el video', () => {
    expect(planClip({ reducedMotion: false, saveData: true })).toMatchObject({ mode: 'still', reason: 'save-data' });
    expect(planClip({ reducedMotion: false, effectiveType: '2g' })).toMatchObject({ mode: 'still', reason: 'slow-network' });
    expect(planClip({ reducedMotion: false, effectiveType: 'slow-2g' })).toMatchObject({ mode: 'still', reason: 'slow-network' });
    expect(planClip({ reducedMotion: false, effectiveType: '3g' }).mode).toBe('video'); // 200 KB en 3G sigue siendo razonable
  });

  it('si el navegador dice que no puede reproducir H.264, no lo intenta; si no se pudo comprobar, lo intenta', () => {
    expect(planClip({ reducedMotion: false, canPlayMp4: false })).toMatchObject({ mode: 'still', reason: 'no-video-support' });
    expect(planClip({ reducedMotion: false, canPlayMp4: undefined }).mode).toBe('video');
  });

  it('el movimiento reducido manda sobre todo lo demas', () => {
    expect(planClip({ reducedMotion: true, saveData: true, effectiveType: '2g', canPlayMp4: false }).reason).toBe('reduced-motion');
  });
});

describe('sceneUsesVideo', () => {
  it('solo con clip registrado, plan de video y sin fallo', () => {
    const video = planClip({ reducedMotion: false });
    const still = planClip({ reducedMotion: true });
    expect(sceneUsesVideo(CLIP, video, false)).toBe(true);
    expect(sceneUsesVideo(undefined, video, false)).toBe(false); // sin clip
    expect(sceneUsesVideo(CLIP, null, false)).toBe(false); // todavia no se monto (servidor / primer render)
    expect(sceneUsesVideo(CLIP, still, false)).toBe(false);
    expect(sceneUsesVideo(CLIP, video, true)).toBe(false); // fallo al cargar: vuelve a lo de siempre
  });
});

describe('readClipEnvironment', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stub = (opts: { reduce?: boolean; conn?: any; canPlay?: string; throwVideo?: boolean }) => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: !!opts.reduce }) });
    vi.stubGlobal('navigator', { connection: opts.conn });
    vi.stubGlobal('document', {
      createElement: () => {
        if (opts.throwVideo) throw new Error('sin DOM');
        return { canPlayType: () => opts.canPlay ?? '' };
      },
    });
  };

  it('lee movimiento reducido, ahorro de datos, tipo de conexion y soporte de MP4', () => {
    stub({ reduce: true, conn: { saveData: true, effectiveType: '3g' }, canPlay: 'probably' });
    expect(readClipEnvironment()).toEqual({ reducedMotion: true, saveData: true, effectiveType: '3g', canPlayMp4: true });
  });

  it('un navegador sin la API de conexion no rompe y "" significa que no puede reproducir', () => {
    stub({ canPlay: '' });
    expect(readClipEnvironment()).toEqual({ reducedMotion: false, saveData: false, effectiveType: undefined, canPlayMp4: false });
  });

  it('si no se puede comprobar el soporte, queda sin definir (se intenta igual)', () => {
    stub({ throwVideo: true });
    expect(readClipEnvironment().canPlayMp4).toBeUndefined();
  });
});

describe('TonitoClip (marcado)', () => {
  const html = renderToStaticMarkup(h(TonitoClip, { clip: CLIP }));

  it('es decorativo, sin sonido y compatible con iOS', () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('muted');
    expect(html).toContain('playsinline');
    expect(html).toContain('autoplay');
    expect(html).not.toContain('controls');
  });

  it('trae el poster debajo del video y el MP4 como fuente', () => {
    expect(html).toContain('<img src="/tonito/clips/prueba.jpg" alt=""');
    expect(html).toContain('<source src="/tonito/clips/prueba.mp4" type="video/mp4"');
  });

  it('empieza invisible hasta que el video puede reproducirse (sin parpadeos) y respeta movimiento reducido', () => {
    expect(html).toContain('opacity-0');
    expect(html).toContain('motion-reduce:transition-none');
  });

  it('reserva el espacio con la proporcion del clip (sin saltos de maquetacion)', () => {
    expect(html).toContain('aspect-ratio:480 / 270');
  });

  it('el bucle sale del registro', () => {
    expect(renderToStaticMarkup(h(TonitoClip, { clip: { ...CLIP, loop: true } }))).toContain('loop');
    expect(html).not.toContain(' loop');
  });
});

describe('CinematicScene sin clips registrados', () => {
  it('se comporta como siempre: muestra a Toñito animado y ningun video', () => {
    const out = renderToStaticMarkup(h(CinematicScene, { type: 'module_complete_good', score: 90, onComplete: () => {} }));
    expect(out).toContain('tonito-character');
    expect(out).not.toContain('<video');
  });
});

// Guardas de los activos reales (hoy no hay ninguno: se cumplen en vacio y empiezan a vigilar cuando se agregue el primero).
describe('activos de clips', () => {
  const publicPath = (url: string) => path.join(process.cwd(), 'public', url.replace(/^\//, ''));
  const entries = Object.values(TONITO_CLIPS);

  it('cada clip registrado esta bien formado y sus archivos existen (nunca un 404 en una cinematica)', () => {
    for (const c of entries) {
      expect(c.src).toMatch(/^\/tonito\/clips\/[\w-]+\.mp4$/);
      expect(c.poster).toMatch(/^\/tonito\/clips\/[\w-]+\.(jpg|webp)$/);
      expect(c.width).toBeGreaterThan(0);
      expect(c.height).toBeGreaterThan(0);
      expect(fs.existsSync(publicPath(c.src))).toBe(true);
      expect(fs.existsSync(publicPath(c.poster))).toBe(true);
    }
  });

  it('respetan el presupuesto de la ficha de arte: clip <= 400 KB, poster <= 60 KB, todos los clips <= 2 MB', () => {
    let total = 0;
    for (const c of entries) {
      const mp4 = fs.statSync(publicPath(c.src)).size;
      total += mp4;
      expect(mp4).toBeLessThanOrEqual(400 * 1024);
      expect(fs.statSync(publicPath(c.poster)).size).toBeLessThanOrEqual(60 * 1024);
    }
    expect(total).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('el registro y la carpeta coinciden: no hay MP4 huerfanos ni entradas sin archivo', () => {
    const dir = path.join(process.cwd(), 'public', 'tonito', 'clips');
    const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')) : [];
    const registered = entries.map((c) => path.basename(c.src));
    expect(onDisk.sort()).toEqual(registered.sort());
  });
});
