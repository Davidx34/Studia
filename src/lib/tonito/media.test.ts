import { describe, it, expect } from 'vitest';
import { LOCAL_MEDIA_BASE, VERSIONED_POSTER, VERSIONED_VIDEO, judgeMediaResponse, mediaUrl, resolveMediaBase, isExternalMediaBase } from './media';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TonitoClip } from '@/components/tonito/TonitoClip';

const SUPABASE = 'https://roulrdmxsazjkczxkzax.supabase.co/storage/v1/object/public/tonito-media';
const R2 = 'https://media.ejemplo.com';

describe('resolveMediaBase', () => {
  it('sin variable, la base es local', () => {
    expect(resolveMediaBase(undefined)).toBe(LOCAL_MEDIA_BASE);
    expect(resolveMediaBase('')).toBe(LOCAL_MEDIA_BASE);
    expect(resolveMediaBase('   ')).toBe(LOCAL_MEDIA_BASE);
  });

  it('acepta una base https de Supabase o de R2, y quita las barras finales', () => {
    expect(resolveMediaBase(SUPABASE)).toBe(SUPABASE);
    expect(resolveMediaBase(SUPABASE + '/')).toBe(SUPABASE);
    expect(resolveMediaBase('  ' + R2 + '///')).toBe(R2);
    expect(resolveMediaBase('https://pub-abc123.r2.dev')).toBe('https://pub-abc123.r2.dev');
  });

  it('una variable mal escrita cae a la base local en vez de romper las cinematicas', () => {
    for (const bad of ['http://media.ejemplo.com', 'media.ejemplo.com', '//media.ejemplo.com', 'javascript:alert(1)', 'https://', 'ftp://x.com']) {
      expect(resolveMediaBase(bad)).toBe(LOCAL_MEDIA_BASE);
    }
  });

  it('rechaza credenciales, parametros y fragmentos en la base (nada de secretos ni de URLs firmadas pegadas por error)', () => {
    expect(resolveMediaBase('https://user:pass@media.ejemplo.com')).toBe(LOCAL_MEDIA_BASE);
    expect(resolveMediaBase(R2 + '?token=abc')).toBe(LOCAL_MEDIA_BASE);
    expect(resolveMediaBase(R2 + '#x')).toBe(LOCAL_MEDIA_BASE);
  });

  it('isExternalMediaBase distingue local de externa', () => {
    expect(isExternalMediaBase(LOCAL_MEDIA_BASE)).toBe(false);
    expect(isExternalMediaBase(SUPABASE)).toBe(true);
  });
});

describe('mediaUrl', () => {
  it('une base y ruta relativa para cualquier proveedor', () => {
    expect(mediaUrl('clips/celebracion.v1.mp4', LOCAL_MEDIA_BASE)).toBe('/tonito/clips/celebracion.v1.mp4');
    expect(mediaUrl('clips/celebracion.v1.mp4', SUPABASE)).toBe(SUPABASE + '/clips/celebracion.v1.mp4');
    expect(mediaUrl('clips/celebracion.v1.jpg', R2)).toBe(R2 + '/clips/celebracion.v1.jpg');
  });

  it('rechaza rutas peligrosas o mal formadas', () => {
    for (const bad of ['', '/clips/x.mp4', '../x.mp4', 'clips/../x.mp4', 'clips//x.mp4', 'https://otro.com/x.mp4', 'clips/x y.mp4', 'clips/x.mp4?a=1', '.oculto']) {
      expect(() => mediaUrl(bad, SUPABASE)).toThrow('no valida');
    }
  });
});

describe('convencion de nombres versionados', () => {
  it('video y poster llevan la version en el nombre', () => {
    expect(VERSIONED_VIDEO.test('clips/celebracion.v1.mp4')).toBe(true);
    expect(VERSIONED_VIDEO.test('clips/celebracion.v12.mp4')).toBe(true);
    expect(VERSIONED_VIDEO.test('clips/celebracion.mp4')).toBe(false); // sin version: se podria sobrescribir
    expect(VERSIONED_VIDEO.test('clips/Celebracion.v1.mp4')).toBe(false);
    expect(VERSIONED_VIDEO.test('celebracion.v1.mp4')).toBe(false);
    expect(VERSIONED_POSTER.test('clips/celebracion.v1.jpg')).toBe(true);
    expect(VERSIONED_POSTER.test('clips/celebracion.v1.webp')).toBe(true);
    expect(VERSIONED_POSTER.test('clips/celebracion.v1.png')).toBe(false);
  });
});

describe('judgeMediaResponse', () => {
  const good = { 'content-type': 'video/mp4', 'content-length': String(214 * 1024), 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=31536000, immutable' };

  it('un video bien servido pasa sin avisos', () => {
    expect(judgeMediaResponse('video', 200, good)).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('un estado distinto de 200 es un error y no se revisa nada mas', () => {
    expect(judgeMediaResponse('video', 404, good)).toMatchObject({ ok: false, errors: [expect.stringContaining('404')] });
    expect(judgeMediaResponse('video', 403, {}).warnings).toEqual([]);
  });

  it('tipo equivocado y peso por encima del tope son errores', () => {
    expect(judgeMediaResponse('video', 200, { ...good, 'content-type': 'application/octet-stream' }).errors[0]).toContain('video/mp4');
    expect(judgeMediaResponse('video', 200, { ...good, 'content-type': 'video/mp4; charset=binary' }).ok).toBe(true);
    expect(judgeMediaResponse('video', 200, { ...good, 'content-length': String(500 * 1024) }).errors[0]).toContain('tope');
    expect(judgeMediaResponse('poster', 200, { 'content-type': 'image/jpeg', 'content-length': String(70 * 1024), 'cache-control': 'max-age=31536000' }).errors[0]).toContain('60 KB');
    expect(judgeMediaResponse('poster', 200, { 'content-type': 'image/png', 'cache-control': 'max-age=31536000' }).errors[0]).toContain('image/jpeg');
  });

  it('sin accept-ranges, o con cache corto o ausente, avisa pero no falla', () => {
    const v = judgeMediaResponse('video', 200, { ...good, 'accept-ranges': undefined, 'cache-control': 'max-age=3600' });
    expect(v.ok).toBe(true);
    expect(v.warnings.join(' ')).toContain('accept-ranges');
    expect(v.warnings.join(' ')).toContain('3600');
    expect(judgeMediaResponse('video', 200, { ...good, 'cache-control': undefined }).warnings.join(' ')).toContain('sin cache-control');
  });

  it('un cache-control que impide cachear es un error para un archivo inmutable', () => {
    expect(judgeMediaResponse('video', 200, { ...good, 'cache-control': 'no-store' }).ok).toBe(false);
    expect(judgeMediaResponse('video', 200, { ...good, 'cache-control': 'no-cache' }).ok).toBe(false);
  });
});

describe('TonitoClip con una base externa', () => {
  it('el reproductor pide el archivo a la URL que arma mediaUrl (la base se inyecta, no esta cableada)', () => {
    // La base se fija al compilar; aqui se comprueba que el marcado usa mediaUrl y no una ruta fija.
    const html = renderToStaticMarkup(h(TonitoClip, { clip: { id: 'x', src: 'clips/x.v1.mp4', poster: 'clips/x.v1.jpg', width: 480, height: 270, loop: false } }));
    expect(html).toContain(mediaUrl('clips/x.v1.mp4'));
    expect(html).toContain(mediaUrl('clips/x.v1.jpg'));
  });
});
