import { describe, it, expect } from 'vitest';
import { EDGE_SAMPLES, edgeBackgrounds, isEdgeColors, luminance, rgbToHex, sampleArgs, sampleSpecs, whiteTextContrast } from './clipColors';

const COLORS = ['#eebc73', '#e7a96c', '#cc535d', '#ecb871', '#e2a068', '#c24f5a'];

describe('rgbToHex', () => {
  it('convierte bytes a #rrggbb en minusculas', () => {
    expect(rgbToHex([238, 188, 115])).toBe('#eebc73');
    expect(rgbToHex(new Uint8Array([0, 0, 0]))).toBe('#000000');
    expect(rgbToHex([255, 255, 255])).toBe('#ffffff');
  });
  it('acota lo que se sale de rango y exige 3 bytes', () => {
    expect(rgbToHex([300, -5, 12.4])).toBe('#ff000c');
    expect(() => rgbToHex([1, 2])).toThrow(/3 bytes/);
  });
});

describe('sampleArgs / sampleSpecs', () => {
  const size = { width: 720, height: 1280 };

  it('mide un cuadrito del PRIMER cuadro y entrega 3 bytes RGB por stdout', () => {
    const a = sampleArgs('c.mp4', size, 'left', 0.5);
    expect(a).toContain('c.mp4');
    expect(a).toEqual(expect.arrayContaining(['-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']));
    expect(a[a.indexOf('-vf') + 1]).toMatch(/^crop=4:4:0:\d+,scale=1:1/);
  });

  // x e y del cuadrito que mide ffmpeg (crop=ancho:alto:x:y).
  const cropXY = (args: string[]) => {
    const m = /crop=\d+:\d+:(\d+):(\d+)/.exec(args[args.indexOf('-vf') + 1])!;
    return { x: Number(m[1]), y: Number(m[2]) };
  };

  it('el borde derecho se mide al final del ancho, sin salirse del cuadro', () => {
    expect(cropXY(sampleArgs('c.mp4', size, 'right', 0.05)).x).toBe(size.width - 4);
    expect(cropXY(sampleArgs('c.mp4', size, 'left', 0.05)).x).toBe(0);
  });

  it('la altura se acota al cuadro (0 y 1)', () => {
    expect(cropXY(sampleArgs('c.mp4', size, 'left', -1)).y).toBe(0);
    expect(cropXY(sampleArgs('c.mp4', size, 'left', 2)).y).toBe(size.height - 4);
  });

  it('son 6 muestras: izquierda (arriba, medio, abajo) y derecha (arriba, medio, abajo)', () => {
    const s = sampleSpecs();
    expect(s).toHaveLength(EDGE_SAMPLES);
    expect(s.map((x) => x.side)).toEqual(['left', 'left', 'left', 'right', 'right', 'right']);
    expect(s.slice(0, 3).map((x) => x.yFrac)).toEqual([0.05, 0.5, 0.95]);
  });
});

describe('isEdgeColors / edgeBackgrounds', () => {
  it('acepta exactamente 6 colores #rrggbb', () => {
    expect(isEdgeColors(COLORS)).toBe(true);
    expect(isEdgeColors(COLORS.slice(0, 5))).toBe(false);
    expect(isEdgeColors([...COLORS, '#000000'])).toBe(false);
    expect(isEdgeColors(null)).toBe(false);
    expect(isEdgeColors('#eebc73')).toBe(false);
  });

  it('rechaza formatos que podrian inyectar CSS o no son colores', () => {
    for (const bad of ['red', '#fff', '#GGGGGG', 'url(x)', '#eebc73; background:url(x)', 'rgb(1,2,3)', '#EEBC73', '']) {
      expect(isEdgeColors([bad, ...COLORS.slice(1)]), bad).toBe(false);
    }
  });

  it('arma un degradado vertical por lado', () => {
    expect(edgeBackgrounds(COLORS)).toEqual({
      left: 'linear-gradient(to bottom, #eebc73, #e7a96c, #cc535d)',
      right: 'linear-gradient(to bottom, #ecb871, #e2a068, #c24f5a)',
    });
  });

  it('colores invalidos o ausentes -> null (la escena usa su degradado de siempre)', () => {
    expect(edgeBackgrounds(undefined)).toBeNull();
    expect(edgeBackgrounds(['x'])).toBeNull();
    expect(edgeBackgrounds(null)).toBeNull();
  });
});

describe('contraste del texto blanco', () => {
  it('el fondo claro del clip real da poco contraste (por eso la escena lleva un velo oscuro); uno oscuro da mucho', () => {
    expect(whiteTextContrast('#eebc73')).toBeLessThan(2);
    expect(whiteTextContrast('#0f172a')).toBeGreaterThan(15);
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });
});

