import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { BUSTO_MAX_SIZE, POSE_DIR, POSE_EXT, bustoImgStyle, poseSrc, usesBusto } from './poseCrop';
import { POSE_MOOD, POSE_PUBLIC_DIR, POSE_EXT as SCRIPT_EXT } from './posePipeline';

describe('busto o cuerpo entero segun el tamaño', () => {
  it('los tamaños pequeños de la app (avatar 42, widget 72, pantallas ~100-110) usan el busto', () => {
    for (const s of [42, 72, 80, 90, 100, 110]) expect(usesBusto(s)).toBe(true);
  });
  it('los grandes (cinematicas) usan el cuerpo entero', () => {
    for (const s of [140, 220, 300, 380]) expect(usesBusto(s)).toBe(false);
    expect(usesBusto(BUSTO_MAX_SIZE)).toBe(true);
    expect(usesBusto(BUSTO_MAX_SIZE + 1)).toBe(false);
  });
});

describe('recorte al busto', () => {
  it('muestra el 52 % del cuadro: la imagen se agranda ~1,92 veces y se corre para dejar la cabeza dentro', () => {
    const st = bustoImgStyle(100);
    expect(st.width).toBeCloseTo(192.3, 0);
    expect(st.height).toBeCloseTo(192.3, 0);
    expect(st.left).toBeCloseTo(-48.1, 0);
    expect(st.top).toBeCloseTo(-6.7, 0);
  });
  it('la region visible cae dentro de la imagen (no se sale por ningun lado)', () => {
    for (const size of [42, 72, 110]) {
      const st = bustoImgStyle(size);
      expect(st.left).toBeLessThanOrEqual(0);
      expect(st.top).toBeLessThanOrEqual(0);
      expect(st.left + st.width).toBeGreaterThanOrEqual(size); // cubre hasta el borde derecho
      expect(st.top + st.height).toBeGreaterThanOrEqual(size); // y hasta el inferior
    }
  });
});

describe('archivos de las poses', () => {
  it('la ruta de la app y la del script que las genera coinciden', () => {
    expect(POSE_DIR).toBe(`/${POSE_PUBLIC_DIR}`);
    expect(POSE_EXT).toBe(SCRIPT_EXT);
  });
  it('cada estado de Toñito tiene su archivo en public/', () => {
    for (const mood of Object.values(POSE_MOOD)) {
      const file = path.join(process.cwd(), 'public', poseSrc(mood));
      expect(fs.existsSync(file), file).toBe(true);
      expect(fs.statSync(file).size).toBeLessThan(120 * 1024); // son avatares: livianos
    }
  });
});
