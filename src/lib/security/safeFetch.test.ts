import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import dns from 'node:dns';
import type { AddressInfo } from 'node:net';
import { isBlockedIPv4, isBlockedIPv6, isBlockedAddress, parseSafeUrl, safeFetch, UnsafeUrlError, MAX_REDIRECTS } from './safeFetch';

describe('isBlockedIPv4', () => {
  it.each([
    '0.0.0.0', '10.0.0.5', '10.255.255.255', '100.64.0.1', '127.0.0.1', '127.8.8.8', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '192.0.0.8', '198.18.0.1', '224.0.0.1', '255.255.255.255',
  ])('%s se bloquea', (ip) => expect(isBlockedIPv4(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '11.0.0.1', '100.63.255.255', '100.128.0.1', '203.0.114.1', '93.184.216.34'])(
    '%s es publica y pasa',
    (ip) => expect(isBlockedIPv4(ip)).toBe(false)
  );
});

describe('isBlockedIPv6', () => {
  it.each([
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254',
    '::ffff:a00:1', '64:ff9b::a00:1', '2001:db8::1', '::127.0.0.1',
  ])('%s se bloquea', (ip) => expect(isBlockedIPv6(ip)).toBe(true));

  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8'])('%s es publica y pasa', (ip) => expect(isBlockedIPv6(ip)).toBe(false));

  it('algo que no se puede interpretar se rechaza', () => {
    expect(isBlockedIPv6('zzzz::1')).toBe(true);
    expect(isBlockedAddress('no-es-una-ip')).toBe(true);
  });
});

describe('parseSafeUrl', () => {
  it.each([
    ['http://localhost/', /interna/],
    ['http://LOCALHOST:80/x', /interna/],
    ['http://localhost./', /interna/],
    ['http://servicio.internal/', /interna/],
    ['http://impresora.local/', /interna/],
    ['http://127.0.0.1/', /interna/],
    ['http://169.254.169.254/latest/meta-data/', /interna/],
    ['http://[::1]/', /interna/],
    ['http://[::ffff:127.0.0.1]/', /interna/],
    ['http://2130706433/', /interna/], // 127.0.0.1 en decimal
    ['http://0x7f.0.0.1/', /interna/], // en hexadecimal
    ['http://0177.0.0.1/', /interna/], // en octal
    ['http://10.0.0.1/', /interna/],
    ['file:///etc/passwd', /http\/https/],
    ['ftp://ejemplo.com/', /http\/https/],
    ['javascript:alert(1)', /http\/https/],
    ['https://usuario:clave@ejemplo.com/', /usuario/],
    ['http://ejemplo.com:22/', /puerto/],
    ['https://ejemplo.com:8443/', /puerto/],
    ['esto no es una url', /invalida/],
  ])('rechaza %s', (url, why) => {
    expect(() => parseSafeUrl(url)).toThrow(UnsafeUrlError);
    expect(() => parseSafeUrl(url)).toThrow(why);
  });

  it('acepta una pagina publica normal', () => {
    expect(parseSafeUrl('https://es.wikipedia.org/wiki/Economia').hostname).toBe('es.wikipedia.org');
    expect(parseSafeUrl('http://ejemplo.com/a?b=1').port).toBe('');
  });
});

describe('safeFetch contra un servidor real en 127.0.0.1', () => {
  let server: http.Server;
  let port = 0;
  let hits: string[] = [];
  const routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void> = {};

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      (routes[req.url ?? ''] ?? ((_q, r) => { r.statusCode = 404; r.end('no'); }))(req, res);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  afterEach(() => {
    vi.restoreAllMocks();
    hits = [];
  });

  // "ok.example" resuelve a 127.0.0.1 (simulado) y la prueba permite esa direccion: es el camino feliz.
  const fakeDns = (map: Record<string, string>) =>
    vi.spyOn(dns, 'lookup').mockImplementation(((host: string, _o: any, cb: any) => {
      const ip = map[host];
      if (!ip) return cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
      cb(null, [{ address: ip, family: ip.includes(':') ? 6 : 4 }]);
    }) as any);
  const allow = { _allowAddress: () => true, _allowAnyPort: true };

  it('descarga una pagina normal', async () => {
    routes['/ok'] = (_q, r) => { r.setHeader('content-type', 'text/html'); r.end('<h1>Hola</h1>'); };
    fakeDns({ 'ok.example': '127.0.0.1' });
    const r = await safeFetch(`http://ok.example:${port}/ok`, allow);
    expect(r.status).toBe(200);
    expect(r.contentType).toContain('text/html');
    expect(r.body.toString()).toBe('<h1>Hola</h1>');
  });

  it('REGRESION (DNS rebinding): un nombre "publico" que resuelve a una IP interna se bloquea al CONECTAR', async () => {
    routes['/secreto'] = (_q, r) => r.end('METADATA');
    fakeDns({ 'rebind.example': '169.254.169.254' });
    await expect(safeFetch('http://rebind.example/secreto', { timeoutMs: 3000 })).rejects.toThrow(/interna/);
    fakeDns({ 'rebind2.example': '127.0.0.1' });
    await expect(safeFetch(`http://rebind2.example:${port}/secreto`, { _allowAnyPort: true, timeoutMs: 3000 })).rejects.toThrow(/interna/);
    expect(hits).toEqual([]); // el servidor interno ni se enteró
  });

  it('un nombre con VARIAS direcciones se bloquea si UNA es interna', async () => {
    vi.spyOn(dns, 'lookup').mockImplementation(((_h: string, _o: any, cb: any) => cb(null, [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }])) as any);
    await expect(safeFetch('http://mixto.example/', { timeoutMs: 3000 })).rejects.toThrow(/interna/);
  });

  it('REGRESION: una redireccion hacia una direccion interna se bloquea', async () => {
    routes['/redir'] = (_q, r) => { r.statusCode = 302; r.setHeader('location', 'http://169.254.169.254/latest/meta-data/'); r.end(); };
    fakeDns({ 'ok.example': '127.0.0.1' });
    await expect(safeFetch(`http://ok.example:${port}/redir`, allow)).rejects.toThrow(/interna/);
  });

  it('sigue una redireccion legitima y valida cada salto', async () => {
    routes['/a'] = (_q, r) => { r.statusCode = 301; r.setHeader('location', '/b'); r.end(); };
    routes['/b'] = (_q, r) => { r.setHeader('content-type', 'text/html'); r.end('destino'); };
    fakeDns({ 'ok.example': '127.0.0.1' });
    const r = await safeFetch(`http://ok.example:${port}/a`, allow);
    expect(r.body.toString()).toBe('destino');
    expect(hits).toEqual(['/a', '/b']);
  });

  it(`corta un bucle de redirecciones (maximo ${MAX_REDIRECTS})`, async () => {
    routes['/loop'] = (_q, r) => { r.statusCode = 302; r.setHeader('location', '/loop'); r.end(); };
    fakeDns({ 'ok.example': '127.0.0.1' });
    await expect(safeFetch(`http://ok.example:${port}/loop`, allow)).rejects.toThrow(/redirecciones/);
    expect(hits.length).toBe(MAX_REDIRECTS + 1);
  });

  it('REGRESION: la respuesta se corta al llegar al limite en vez de bajarse entera', async () => {
    routes['/grande'] = (_q, r) => { r.setHeader('content-type', 'text/html'); r.write(Buffer.alloc(200_000, 97)); r.end(Buffer.alloc(200_000, 97)); };
    fakeDns({ 'ok.example': '127.0.0.1' });
    await expect(safeFetch(`http://ok.example:${port}/grande`, { ...allow, maxBytes: 100_000 })).rejects.toThrow(/demasiado grande/);
  });

  it('rechaza una respuesta comprimida (bomba de descompresion)', async () => {
    routes['/gz'] = (_q, r) => { r.setHeader('content-encoding', 'gzip'); r.end(Buffer.from([31, 139])); };
    fakeDns({ 'ok.example': '127.0.0.1' });
    await expect(safeFetch(`http://ok.example:${port}/gz`, allow)).rejects.toThrow(/comprimida/);
  });

  it('pide la respuesta sin comprimir', async () => {
    let seen = '';
    routes['/enc'] = (q, r) => { seen = String(q.headers['accept-encoding']); r.end('x'); };
    fakeDns({ 'ok.example': '127.0.0.1' });
    await safeFetch(`http://ok.example:${port}/enc`, allow);
    expect(seen).toBe('identity');
  });

  it('un servidor que no responde se corta por tiempo', async () => {
    routes['/lento'] = () => { /* nunca responde */ };
    fakeDns({ 'ok.example': '127.0.0.1' });
    await expect(safeFetch(`http://ok.example:${port}/lento`, { ...allow, timeoutMs: 300 })).rejects.toThrow(/tardo demasiado/);
  });
});
