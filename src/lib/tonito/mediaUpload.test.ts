import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { CACHE_CONTROL_SECONDS, TONITO_BUCKET, mp4TopLevelBoxes, planUpload, sniffMime, supabasePublicBase } from './mediaUpload';

const enc = (s: string) => Array.from(new TextEncoder().encode(s));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

// Caja MP4: tamano (4 bytes) + tipo (4) + relleno hasta `size`.
const box = (type: string, size: number): number[] => [...u32(size), ...enc(type), ...new Array(Math.max(0, size - 8)).fill(0)];
const mp4 = (...parts: [string, number][]) => new Uint8Array(parts.flatMap(([t, s]) => box(t, s)));

const FASTSTART = mp4(['ftyp', 24], ['moov', 200], ['mdat', 3000]);
const NO_FASTSTART = mp4(['ftyp', 24], ['mdat', 3000], ['moov', 200]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(2000).fill(1)]);
const WEBP = new Uint8Array([...enc('RIFF'), ...u32(1000), ...enc('WEBP'), ...new Array(1000).fill(2)]);

describe('sniffMime', () => {
  it('reconoce MP4, JPEG y WebP por el contenido', () => {
    expect(sniffMime(FASTSTART)).toBe('video/mp4');
    expect(sniffMime(JPEG)).toBe('image/jpeg');
    expect(sniffMime(WEBP)).toBe('image/webp');
  });
  it('lo demas, y los archivos demasiado cortos, no se reconocen', () => {
    expect(sniffMime(new Uint8Array(enc('hola mundo, esto es texto')))).toBeNull();
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull(); // PNG
    expect(sniffMime(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffMime(new Uint8Array())).toBeNull();
  });
});

describe('mp4TopLevelBoxes', () => {
  it('lista las cajas de primer nivel en orden', () => {
    expect(mp4TopLevelBoxes(FASTSTART)).toEqual(['ftyp', 'moov', 'mdat']);
    expect(mp4TopLevelBoxes(NO_FASTSTART)).toEqual(['ftyp', 'mdat', 'moov']);
  });
  it('se detiene ante una caja invalida en vez de ciclarse', () => {
    const roto = new Uint8Array([...box('ftyp', 24), ...u32(3), ...enc('moov')]); // tamano < 8
    expect(mp4TopLevelBoxes(roto)).toEqual(['ftyp']);
    expect(mp4TopLevelBoxes(new Uint8Array(5))).toEqual([]);
  });
  it('entiende el tamano 0 (hasta el final) y el de 64 bits', () => {
    const hastaElFinal = new Uint8Array([...box('ftyp', 24), ...u32(0), ...enc('mdat'), 1, 2, 3]);
    expect(mp4TopLevelBoxes(hastaElFinal)).toEqual(['ftyp', 'mdat']);
    const grande = new Uint8Array([...box('ftyp', 24), ...u32(1), ...enc('mdat'), 0, 0, 0, 0, 0, 0, 0, 24, ...new Array(8).fill(0), ...box('moov', 100)]);
    expect(mp4TopLevelBoxes(grande)).toEqual(['ftyp', 'mdat', 'moov']);
  });
});

describe('planUpload', () => {
  it('un clip valido con faststart pasa sin avisos', () => {
    expect(planUpload('clips/celebracion.v1.mp4', FASTSTART)).toEqual({ ok: true, kind: 'video', contentType: 'video/mp4', errors: [], warnings: [] });
  });

  it('un poster JPEG o WebP valido pasa', () => {
    expect(planUpload('clips/celebracion.v1.jpg', JPEG)).toMatchObject({ ok: true, kind: 'poster', contentType: 'image/jpeg' });
    expect(planUpload('clips/celebracion.v1.webp', WEBP)).toMatchObject({ ok: true, kind: 'poster', contentType: 'image/webp' });
  });

  it('un MP4 SIN faststart sube, pero con un aviso claro (no empezaria a reproducirse hasta bajarse entero)', () => {
    const p = planUpload('clips/celebracion.v1.mp4', NO_FASTSTART);
    expect(p.ok).toBe(true);
    expect(p.warnings.join(' ')).toContain('faststart');
  });

  it('un MP4 sin indice (moov) se rechaza', () => {
    const p = planUpload('clips/celebracion.v1.mp4', mp4(['ftyp', 24], ['mdat', 3000]));
    expect(p.ok).toBe(false);
    expect(p.errors.join(' ')).toContain('moov');
  });

  it('rechaza nombres sin version, en mayusculas, fuera de clips/ o con otra extension', () => {
    for (const bad of ['clips/celebracion.mp4', 'clips/Celebracion.v1.mp4', 'celebracion.v1.mp4', 'clips/celebracion.v1.png', 'clips/celebracion.v1.jpeg', '../clips/x.v1.mp4', 'clips/x y.v1.mp4']) {
      const p = planUpload(bad, FASTSTART);
      expect(p.ok, bad).toBe(false);
      expect(p.errors[0]).toContain('nombre');
    }
  });

  it('rechaza lo que pesa mas que el tope de su tipo (clip 400 KB, poster 60 KB) y lo vacio', () => {
    const grandeVideo = new Uint8Array([...box('ftyp', 24), ...box('moov', 100), ...box('mdat', 401 * 1024)]);
    expect(planUpload('clips/x.v1.mp4', grandeVideo).errors.join(' ')).toContain('400 KB');
    const grandePoster = new Uint8Array([0xff, 0xd8, 0xff, ...new Array(61 * 1024).fill(1)]);
    expect(planUpload('clips/x.v1.jpg', grandePoster).errors.join(' ')).toContain('60 KB');
    expect(planUpload('clips/x.v1.jpg', new Uint8Array()).errors.join(' ')).toContain('vacio');
  });

  it('rechaza un archivo cuyo contenido no es lo que dice su extension', () => {
    expect(planUpload('clips/x.v1.mp4', JPEG).errors.join(' ')).toContain('contenido es image/jpeg');
    expect(planUpload('clips/x.v1.jpg', FASTSTART).errors.join(' ')).toContain('contenido es video/mp4');
    expect(planUpload('clips/x.v1.webp', JPEG).ok).toBe(false);
    expect(planUpload('clips/x.v1.mp4', new Uint8Array(enc('texto cualquiera que no es video'))).errors.join(' ')).toContain('no es un MP4');
  });
});

describe('supabasePublicBase', () => {
  it('arma la base publica del bucket (el valor de NEXT_PUBLIC_TONITO_MEDIA_BASE_URL)', () => {
    expect(supabasePublicBase('https://abc.supabase.co')).toBe('https://abc.supabase.co/storage/v1/object/public/tonito-media');
    expect(supabasePublicBase(' https://abc.supabase.co// ')).toBe('https://abc.supabase.co/storage/v1/object/public/tonito-media');
    expect(supabasePublicBase('https://abc.supabase.co', 'otro')).toBe('https://abc.supabase.co/storage/v1/object/public/otro');
  });
  it('un año de cache para archivos inmutables', () => {
    expect(CACHE_CONTROL_SECONDS).toBe('31536000');
    expect(TONITO_BUCKET).toBe('tonito-media');
  });
});

// La migracion y el script tienen que ir de la mano: el nombre del bucket, que sea publico, y que NO cree politicas de escritura.
describe('migracion 072', () => {
  const sql = fs
    .readFileSync(path.join(process.cwd(), 'supabase/migrations/072_tonito_media_bucket.sql'), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

  it('crea el bucket publico con el mismo nombre que usa el script, con tope de 5 MB y solo MP4, JPEG y WebP', () => {
    expect(sql).toContain(`'${TONITO_BUCKET}'`);
    expect(sql).toMatch(/true,\s*5242880/);
    expect(sql).toContain("ARRAY['video/mp4', 'image/jpeg', 'image/webp']");
  });

  it('NO crea politicas ni toca RLS: sin politicas, solo el service role puede escribir y nadie puede listar', () => {
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE/i);
    expect(sql).not.toMatch(/GRANT/i);
    expect(sql).not.toMatch(/storage\.objects/i);
  });
});
