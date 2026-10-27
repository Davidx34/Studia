import { describe, it, expect } from 'vitest';
import { POSES } from './flowPrompts';
import { POSE_IDS, POSE_MOOD, alphaBounds, consistencyWarnings, despillMagenta, moodForPose, poseStats, poseWarnings } from './posePipeline';

// Imagen de w x h con un rectangulo opaco (x0..x1, y0..y1) del color dado; el resto, transparente.
function img(w: number, h: number, rect: [number, number, number, number], rgb: [number, number, number] = [200, 150, 120]) {
  const a = new Uint8Array(w * h * 4);
  for (let y = rect[1]; y <= rect[3]; y++) {
    for (let x = rect[0]; x <= rect[2]; x++) {
      const i = (y * w + x) * 4;
      a[i] = rgb[0]; a[i + 1] = rgb[1]; a[i + 2] = rgb[2]; a[i + 3] = 255;
    }
  }
  return a;
}

describe('poses y estados', () => {
  it('cada pose del catalogo (P1-P8) tiene su estado, y son los 8 de TonitoCharacter', () => {
    expect(POSE_IDS).toEqual(POSES.map((p) => p.id));
    expect(Object.keys(POSE_MOOD)).toEqual(POSE_IDS);
    expect(Object.values(POSE_MOOD).sort()).toEqual(['celebrating', 'encouraging', 'excited', 'happy', 'sad', 'sleeping', 'surprised', 'thinking']);
  });

  it('el estado de cada pose esta en su descripcion del catalogo', () => {
    for (const p of POSES) expect(p.mood).toContain(POSE_MOOD[p.id]);
  });

  it('moodForPose acepta id (cualquier mayuscula) o estado, y rechaza lo demas', () => {
    expect(moodForPose('p1')).toBe('happy');
    expect(moodForPose('P8')).toBe('sleeping');
    expect(moodForPose('Excited')).toBe('excited');
    expect(moodForPose('P9')).toBeNull();
    expect(moodForPose('feliz')).toBeNull();
  });
});

describe('despillMagenta', () => {
  it('quita el magenta de un borde (mucho rojo y azul, poco verde)', () => {
    const px = new Uint8Array([230, 90, 230, 255]);
    expect(despillMagenta(px)).toBe(1);
    expect(px[0]).toBe(90);
    expect(px[1]).toBe(90);
    expect(px[2]).toBe(90);
  });

  it('no toca el durazno, el cafe, el blanco ni el beige', () => {
    for (const rgb of [[236, 170, 130], [110, 70, 45], [255, 255, 255], [215, 190, 150]]) {
      const px = new Uint8Array([rgb[0], rgb[1], rgb[2], 255]);
      expect(despillMagenta(px)).toBe(0);
      expect(Array.from(px.slice(0, 3))).toEqual(rgb);
    }
  });

  it('ignora los pixeles totalmente transparentes', () => {
    const px = new Uint8Array([255, 0, 255, 0]);
    expect(despillMagenta(px)).toBe(0);
    expect(Array.from(px)).toEqual([255, 0, 255, 0]);
  });
});

describe('alphaBounds y poseStats', () => {
  it('caja del personaje y su estadistica en %', () => {
    const a = img(100, 100, [30, 10, 69, 89]); // 40 de ancho, 80 de alto, pies en la fila 89
    expect(alphaBounds(a, 100, 100)).toEqual({ x0: 30, y0: 10, x1: 69, y1: 89 });
    expect(poseStats(a, 100, 100)).toEqual({ heightPct: 80, feetPct: 90, centroPct: 50, opaquePct: 32 });
  });

  it('imagen vacia -> null', () => {
    expect(alphaBounds(new Uint8Array(100 * 100 * 4), 100, 100)).toBeNull();
    expect(poseStats(new Uint8Array(100 * 100 * 4), 100, 100)).toBeNull();
  });

  it('ignora el alfa casi invisible (ruido del recorte)', () => {
    const a = img(50, 50, [20, 20, 29, 39]);
    a[3] = 10; // pixel (0,0) casi transparente
    expect(alphaBounds(a, 50, 50)!.x0).toBe(20);
  });
});

describe('avisos de una pose', () => {
  const ok = { heightPct: 80, feetPct: 90, centroPct: 50, opaquePct: 30 };
  it('una pose normal no avisa nada', () => expect(poseWarnings(ok)).toEqual([]));
  it('sin pixeles opacos', () => expect(poseWarnings(null)[0]).toMatch(/ningun pixel opaco/));
  it('fondo que no se quito', () => expect(poseWarnings({ ...ok, opaquePct: 90 })[0]).toMatch(/no se quito/));
  it('casi nada visible', () => expect(poseWarnings({ ...ok, opaquePct: 3 })[0]).toMatch(/se quito de mas/));
  it('descentrada', () => expect(poseWarnings({ ...ok, centroPct: 30 })[0]).toMatch(/descentrado/));
  it('pies pegados al borde', () => expect(poseWarnings({ ...ok, feetPct: 100 })[0]).toMatch(/cortado/));
});

describe('consistencia entre poses', () => {
  const base = { heightPct: 80, feetPct: 90, centroPct: 50, opaquePct: 30 };
  it('poses parecidas no avisan', () => {
    expect(consistencyWarnings({ happy: base, sad: { ...base, feetPct: 91, heightPct: 78 }, thinking: { ...base, heightPct: 82 } })).toEqual([]);
  });
  it('avisa la que tiene los pies en otra linea', () => {
    const w = consistencyWarnings({ happy: base, sad: base, thinking: { ...base, feetPct: 80 } });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^thinking: los pies caen en 80%/);
  });
  it('avisa la de otro tamaño', () => {
    const w = consistencyWarnings({ happy: base, sad: base, excited: { ...base, heightPct: 60 } });
    expect(w[0]).toMatch(/^excited: ocupa 60%/);
  });
  it('con una sola pose no hay con que comparar', () => expect(consistencyWarnings({ happy: base })).toEqual([]));
});
