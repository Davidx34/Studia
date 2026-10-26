import { describe, it, expect } from 'vitest';
import {
  ENCODE_LADDER, durationWarning, fitsPoster, fitsVideo, nextVersion, parseVideoInfo, posterArgs, registrySnippet, validClipId, videoArgs,
} from './clipPipeline';
import { VERSIONED_POSTER, VERSIONED_VIDEO } from './media';
import { clipPaths } from './clipPipeline';
import { TONITO_CLIPS } from './clips';

describe('validClipId', () => {
  it('acepta minusculas, numeros y guiones sueltos', () => {
    for (const ok of ['celebracion', 'racha-7', 'a1']) expect(validClipId(ok)).toBe(true);
  });
  it('rechaza mayusculas, espacios, guiones dobles o en los bordes, puntos y rutas', () => {
    for (const bad of ['Celebracion', 'mi clip', 'a--b', '-a', 'a-', 'a.b', '../x', 'a/b', '']) expect(validClipId(bad)).toBe(false);
  });
});

describe('nextVersion / clipPaths', () => {
  it('empieza en 1 y sube sobre la mayor version usada de ese id', () => {
    expect(nextVersion('exito', [])).toBe(1);
    expect(nextVersion('exito', ['clips/exito.v1.mp4', 'clips/exito.v1.jpg', 'clips/exito.v3.mp4'])).toBe(4);
  });
  it('no mezcla ids parecidos', () => {
    expect(nextVersion('exito', ['clips/exito-total.v9.mp4', 'clips/otro.v5.mp4'])).toBe(1);
  });
  it('los nombres generados cumplen las reglas de subida', () => {
    const p = clipPaths('racha-7', 2);
    expect(p.video).toMatch(VERSIONED_VIDEO);
    expect(p.poster).toMatch(VERSIONED_POSTER);
  });
});

describe('argumentos de ffmpeg', () => {
  it('el video sale H.264 main, sin audio, yuv420p y con faststart', () => {
    const a = videoArgs('in.mp4', 'out.mp4', ENCODE_LADDER[0]).join(' ');
    for (const frag of ['-an', '-c:v libx264', '-profile:v main', '-pix_fmt yuv420p', '-movflags +faststart', "min(720,iw)"]) expect(a).toContain(frag);
    expect(a.endsWith('out.mp4')).toBe(true);
  });
  it('la escalera va de mejor a peor calidad y de mas a menos ancho', () => {
    for (let i = 1; i < ENCODE_LADDER.length; i++) {
      expect(ENCODE_LADDER[i].maxWidth).toBeLessThanOrEqual(ENCODE_LADDER[i - 1].maxWidth);
      if (ENCODE_LADDER[i].maxWidth === ENCODE_LADDER[i - 1].maxWidth) expect(ENCODE_LADDER[i].crf).toBeGreaterThan(ENCODE_LADDER[i - 1].crf);
    }
  });
  it('el poster es un solo cuadro en el instante pedido', () => {
    expect(posterArgs('v.mp4', 'p.jpg', 1.5, 6)).toEqual(['-y', '-ss', '1.5', '-i', 'v.mp4', '-frames:v', '1', '-q:v', '6', 'p.jpg']);
  });
});

describe('pesos', () => {
  it('video <= 400 KB y poster <= 60 KB', () => {
    expect(fitsVideo(400 * 1024)).toBe(true);
    expect(fitsVideo(400 * 1024 + 1)).toBe(false);
    expect(fitsVideo(0)).toBe(false);
    expect(fitsPoster(60 * 1024)).toBe(true);
    expect(fitsPoster(60 * 1024 + 1)).toBe(false);
  });
});

describe('parseVideoInfo', () => {
  const out = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'celebracion.mp4':
  Duration: 00:00:04.00, start: 0.000000, bitrate: 600 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 720x1280 [SAR 1:1 DAR 9:16], 600 kb/s, 24 fps`;
  it('lee ancho, alto y duracion', () => {
    expect(parseVideoInfo(out)).toEqual({ width: 720, height: 1280, seconds: 4 });
  });
  it('devuelve null si no es un video', () => {
    expect(parseVideoInfo('no such file')).toBeNull();
  });
});

describe('durationWarning', () => {
  it('avisa solo fuera de 1 a 8 s', () => {
    expect(durationWarning(4)).toBeNull();
    expect(durationWarning(12)).toMatch(/12\.0 s/);
    expect(durationWarning(0.4)).toMatch(/muy corto/);
  });
});

describe('registrySnippet', () => {
  it('da la linea del registro y, si hay escena, el clipId', () => {
    const s = registrySnippet({ id: 'racha-7', version: 1, width: 720, height: 1280, loop: false, scene: 'streak' });
    expect(s).toContain("'racha-7': { id: 'racha-7', src: 'clips/racha-7.v1.mp4', poster: 'clips/racha-7.v1.jpg', width: 720, height: 1280, loop: false },");
    expect(s).toContain("SCENES.streak");
    expect(s).toContain("clipId: 'racha-7'");
  });
});

describe('el registro actual cumple las reglas del flujo', () => {
  it('cada clip registrado tiene id valido, rutas versionadas y su id como clave', () => {
    for (const [key, c] of Object.entries(TONITO_CLIPS)) {
      expect(c.id).toBe(key);
      expect(validClipId(c.id)).toBe(true);
      expect(c.src).toMatch(VERSIONED_VIDEO);
      expect(c.poster).toMatch(VERSIONED_POSTER);
    }
  });
});
