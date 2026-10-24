import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TONITO_CLIPS, planClip, readClipEnvironment, sceneUsesVideo, type TonitoClipDef } from './clips';
import { VERSIONED_POSTER, VERSIONED_VIDEO, MAX_BYTES, isExternalMediaBase } from './media';
import { TonitoClip } from '@/components/tonito/TonitoClip';
import { CinematicScene } from '@/components/cinematics/CinematicScene';

const CLIP: TonitoClipDef = { id: 'prueba', src: 'clips/prueba.v1.mp4', poster: 'clips/prueba.v1.jpg', width: 480, height: 270, loop: false };

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
    expect(html).toContain('<img src="/tonito/clips/prueba.v1.jpg" alt=""');
    expect(html).toContain('<source src="/tonito/clips/prueba.v1.mp4" type="video/mp4"');
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
// Con una base EXTERNA (Supabase o R2) los archivos no estan en el repo: los comprueba `npm run media:check` contra la URL real.
describe('activos de clips', () => {
  const localFile = (rel: string) => path.join(process.cwd(), 'public', 'tonito', rel);
  const entries = Object.values(TONITO_CLIPS);

  it('cada clip registrado usa rutas relativas y VERSIONADAS (inmutables: sin sobrescribir)', () => {
    for (const c of entries) {
      expect(c.src).toMatch(VERSIONED_VIDEO);
      expect(c.poster).toMatch(VERSIONED_POSTER);
      expect(c.width).toBeGreaterThan(0);
      expect(c.height).toBeGreaterThan(0);
    }
  });

  it.skipIf(isExternalMediaBase())('con base local, los archivos existen y respetan el presupuesto (clip <= 400 KB, poster <= 60 KB, total <= 2 MB)', () => {
    let total = 0;
    for (const c of entries) {
      expect(fs.existsSync(localFile(c.src))).toBe(true);
      expect(fs.existsSync(localFile(c.poster))).toBe(true);
      const mp4 = fs.statSync(localFile(c.src)).size;
      total += mp4;
      expect(mp4).toBeLessThanOrEqual(MAX_BYTES.video);
      expect(fs.statSync(localFile(c.poster)).size).toBeLessThanOrEqual(MAX_BYTES.poster);
    }
    expect(total).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it.skipIf(isExternalMediaBase())('con base local, el registro y la carpeta coinciden: no hay MP4 huerfanos', () => {
    const dir = path.join(process.cwd(), 'public', 'tonito', 'clips');
    const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')) : [];
    expect(onDisk.sort()).toEqual(entries.map((c) => path.basename(c.src)).sort());
  });
});
