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

describe('judgeMediaResponse (una peticion GET con Range: bytes=0-1)', () => {
  // Respuesta tipica de un archivo bien servido: 206 y el peso total en content-range (content-length mide solo los 2 bytes pedidos).
  const good = { 'content-type': 'video/mp4', 'content-range': 'bytes 0-1/' + String(214 * 1024), 'content-length': '2', 'cache-control': 'public, max-age=31536000' };

  it('un video bien servido (206, tipo, peso total y cache larga) pasa sin avisos', () => {
    expect(judgeMediaResponse('video', 206, good)).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('el peso total sale de content-range en un 206, no del content-length de 2 bytes', () => {
    expect(judgeMediaResponse('video', 206, { ...good, 'content-range': 'bytes 0-1/' + String(500 * 1024) }).errors[0]).toContain('tope');
    expect(judgeMediaResponse('video', 206, { ...good, 'content-range': undefined }).warnings.join(' ')).toContain('tamano total');
  });

  it('un estado que no es 200 ni 206 es un error y no se revisa nada mas', () => {
    expect(judgeMediaResponse('video', 404, good)).toMatchObject({ ok: false, errors: [expect.stringContaining('404')] });
    expect(judgeMediaResponse('video', 403, {}).warnings).toEqual([]);
    expect(judgeMediaResponse('video', 307, good).ok).toBe(false);
  });

  it('un video que responde 200 completo (ignora Range) funciona, pero avisa que no podra avanzar ni reanudarse', () => {
    const v = judgeMediaResponse('video', 200, { 'content-type': 'video/mp4', 'content-length': String(214 * 1024), 'cache-control': 'public, max-age=31536000' });
    expect(v.ok).toBe(true);
    expect(v.warnings.join(' ')).toContain('Range');
    // Para un poster, ignorar Range no importa.
    expect(judgeMediaResponse('poster', 200, { 'content-type': 'image/jpeg', 'content-length': '5000', 'cache-control': 'public, max-age=31536000' })).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('tipo equivocado y peso por encima del tope son errores', () => {
    expect(judgeMediaResponse('video', 206, { ...good, 'content-type': 'application/octet-stream' }).errors[0]).toContain('video/mp4');
    expect(judgeMediaResponse('video', 206, { ...good, 'content-type': 'video/mp4; charset=binary' }).ok).toBe(true);
    expect(judgeMediaResponse('poster', 200, { 'content-type': 'image/jpeg', 'content-length': String(70 * 1024), 'cache-control': 'max-age=31536000' }).errors[0]).toContain('60 KB');
    expect(judgeMediaResponse('poster', 200, { 'content-type': 'image/png', 'cache-control': 'max-age=31536000' }).errors[0]).toContain('image/jpeg');
  });

  it('cache corta o ausente avisa pero no falla', () => {
    const v = judgeMediaResponse('video', 206, { ...good, 'cache-control': 'max-age=3600' });
    expect(v.ok).toBe(true);
    expect(v.warnings.join(' ')).toContain('3600');
    expect(judgeMediaResponse('video', 206, { ...good, 'cache-control': undefined }).warnings.join(' ')).toContain('sin cache-control');
  });

  it('un cache-control que impide cachear es un error para un archivo inmutable', () => {
    expect(judgeMediaResponse('video', 206, { ...good, 'cache-control': 'no-store' }).ok).toBe(false);
    expect(judgeMediaResponse('video', 206, { ...good, 'cache-control': 'private, no-cache' }).ok).toBe(false);
  });

  it('el caso real que enganaba al script: Supabase por GET dice public, max-age=31536000 (el "private, no-cache" era solo del HEAD)', () => {
    expect(judgeMediaResponse('poster', 206, { 'content-type': 'image/jpeg', 'content-range': 'bytes 0-1/3691', 'content-length': '2', 'cache-control': 'public, max-age=31536000', 'cf-cache-status': 'HIT' })).toEqual({ ok: true, errors: [], warnings: [] });
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
