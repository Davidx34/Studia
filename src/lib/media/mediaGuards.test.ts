import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  checkClassQuota,
  fitWithin,
  formatMB,
  kindOfMime,
  mediaStoragePath,
  sniffMediaType,
  validateMediaInput,
  MAX_CLASS_MEDIA_BYTES,
  MAX_CLASS_MEDIA_COUNT,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
} from './mediaGuards';

const CLASS = '11111111-2222-3333-4444-555555555555';
const ok = { classroomId: CLASS, filename: 'mapa.webp', mimeType: 'image/webp', sizeBytes: 200_000, altText: 'Mapa del antiguo Egipto' };

describe('validateMediaInput', () => {
  it('acepta imagen y video dentro de los topes', () => {
    expect(validateMediaInput(ok).ok).toBe(true);
    expect(validateMediaInput({ ...ok, filename: 'escena.mp4', mimeType: 'video/mp4', sizeBytes: MAX_VIDEO_BYTES }).ok).toBe(true);
  });

  it('la imagen tiene tope mas bajo que el video', () => {
    expect(validateMediaInput({ ...ok, sizeBytes: MAX_IMAGE_BYTES + 1 }).ok).toBe(false);
    expect(validateMediaInput({ ...ok, filename: 'a.mp4', mimeType: 'video/mp4', sizeBytes: MAX_VIDEO_BYTES + 1 }).ok).toBe(false);
  });

  it('rechaza tipos no permitidos (SVG puede llevar scripts; GIF/HTML/EXE no)', () => {
    for (const [f, m] of [['x.svg', 'image/svg+xml'], ['x.gif', 'image/gif'], ['x.html', 'text/html'], ['x.exe', 'application/octet-stream']]) {
      expect(validateMediaInput({ ...ok, filename: f, mimeType: m }).ok).toBe(false);
    }
  });

  it('la extension debe coincidir con el tipo declarado', () => {
    expect(validateMediaInput({ ...ok, filename: 'foto.exe', mimeType: 'image/png' }).ok).toBe(false);
    expect(validateMediaInput({ ...ok, filename: 'foto.jpg', mimeType: 'image/png' }).ok).toBe(false);
    expect(validateMediaInput({ ...ok, filename: 'FOTO.JPG', mimeType: 'image/jpeg' }).ok).toBe(true);
  });

  it('exige texto alternativo y acota su largo', () => {
    expect(validateMediaInput({ ...ok, altText: '' }).ok).toBe(false);
    expect(validateMediaInput({ ...ok, altText: '  ab ' }).ok).toBe(false);
    expect(validateMediaInput({ ...ok, altText: 'x'.repeat(301) }).ok).toBe(false);
    expect(validateMediaInput({ ...ok, caption: 'x'.repeat(301) }).ok).toBe(false);
  });

  it('rechaza clase invalida, archivo vacio y tamaños basura', () => {
    expect(validateMediaInput({ ...ok, classroomId: '../x' }).ok).toBe(false);
    expect(validateMediaInput({ ...ok, sizeBytes: 0 }).ok).toBe(false);
    expect(validateMediaInput({ ...ok, sizeBytes: NaN }).ok).toBe(false);
  });
});

describe('checkClassQuota', () => {
  it('deja subir mientras quepa', () => expect(checkClassQuota({ count: 3, bytes: 1_000_000 }, 500_000).ok).toBe(true));
  it('rechaza al pasar el tope de MB, diciendo cuanto queda', () => {
    const r = checkClassQuota({ count: 3, bytes: MAX_CLASS_MEDIA_BYTES - 1_000_000 }, 2_000_000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/quedan/);
  });
  it('rechaza al pasar el tope de cantidad', () => expect(checkClassQuota({ count: MAX_CLASS_MEDIA_COUNT, bytes: 0 }, 1).ok).toBe(false));
});

describe('sniffMediaType (el contenido manda, no lo que declare el navegador)', () => {
  const bytes = (...n: number[]) => new Uint8Array([...n, ...new Array(32).fill(0)]);
  const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));
  it('PNG, JPEG, WebP, MP4 y WebM', () => {
    expect(sniffMediaType(bytes(0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffMediaType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffMediaType(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP')))).toBe('image/webp');
    expect(sniffMediaType(bytes(0, 0, 0, 0x18, ...ascii('ftypmp42')))).toBe('video/mp4');
    expect(sniffMediaType(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe('video/webm');
  });
  it('un ejecutable, HTML o SVG renombrados no pasan', () => {
    expect(sniffMediaType(new Uint8Array(ascii('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff')))).toBeNull();
    expect(sniffMediaType(new Uint8Array(ascii('<html><script>alert(1)</script>')))).toBeNull();
    expect(sniffMediaType(new Uint8Array(ascii('<svg xmlns="http://www.w3.org/2000/svg" onload="x()">')))).toBeNull();
    expect(sniffMediaType(new Uint8Array(0))).toBeNull();
  });
});

describe('utilidades', () => {
  it('mediaStoragePath queda dentro de la carpeta de la clase y sin caracteres raros', () => {
    const p = mediaStoragePath(CLASS, 'Ilustración Épica (1).PNG', 123);
    expect(p).toBe(`${CLASS}/123_ilustracion-epica-1.png`);
    expect(mediaStoragePath(CLASS, '../../etc/passwd.png', 1)).not.toContain('..');
    expect(mediaStoragePath(CLASS, '.png', 1).startsWith(`${CLASS}/1_medio`)).toBe(true);
  });
  it('fitWithin reduce sin ampliar y conserva la proporcion', () => {
    expect(fitWithin(4000, 2000, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1000, 4000, 1600)).toEqual({ width: 400, height: 1600 });
  });
  it('kindOfMime y formatMB', () => {
    expect(kindOfMime('image/png')).toBe('image');
    expect(kindOfMime('video/webm')).toBe('video');
    expect(kindOfMime('image/svg+xml')).toBeNull();
    expect(formatMB(1024 * 1024)).toBe('1 MB');
    expect(formatMB(100 * 1024 * 1024)).toBe('100 MB');
  });
});

describe('integracion', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
  const sql = read('supabase/migrations/056_class_media.sql').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it('el bucket es privado y solo admite los 5 tipos', () => {
    expect(sql).toMatch(/'class-media',\s*'class-media',\s*false/);
    expect(sql).toContain("ARRAY['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm']");
    expect(sql).not.toMatch(/svg|gif|html/i);
  });

  it('solo el profesor dueño escribe; el modulo enlazado debe ser de la misma clase; sin FOR ALL', () => {
    expect(sql).not.toMatch(/FOR ALL/);
    expect(sql.match(/m\.classroom_id = class_media\.classroom_id/g)!.length).toBe(2); // INSERT y UPDATE
    expect(sql).toContain('created_by = auth.uid()');
    expect(sql).toMatch(/Estudiantes leen class-media[\s\S]*FOR SELECT|FOR SELECT[\s\S]*Estudiantes leen class-media/);
    // los estudiantes solo tienen SELECT en storage
    const studentPolicy = sql.slice(sql.indexOf('Estudiantes leen class-media'));
    expect(studentPolicy.slice(0, studentPolicy.indexOf(';'))).toContain('FOR SELECT');
  });

  it('las acciones exigen ser dueño de la clase, verifican contenido real y descartan lo invalido', () => {
    const src = read('src/lib/actions/media.ts');
    expect(src).toContain('requireTeacherOfClass');
    expect(src).toContain('sniffMediaType');
    expect(src).toContain('checkClassQuota');
    expect(src.match(/await discard\(\)/g)!.length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("rest.includes('..')");
  });

  it('el estudiante no descarga videos de antemano y las imagenes llevan alt', () => {
    const src = read('src/components/lesson/ModuleMedia.tsx');
    expect(src).toContain('preload="none"');
    expect(src).toContain('alt={m.alt_text}');
    expect(src).toContain('loading="lazy"');
    expect(src).not.toMatch(/autoPlay|autoplay/);
    expect(src).not.toMatch(/\btext-white\b|\b(bg|text|border)-(slate|gray|violet|blue)-\d/);
  });

  it('la leccion incluye el bloque de material visual', () => {
    expect(read('src/app/(student)/lesson/[id]/page.tsx')).toContain('<ModuleMedia moduleId={mod.id}');
  });
});
