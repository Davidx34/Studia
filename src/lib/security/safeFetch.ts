// Descarga de paginas externas SIN dejar que el servidor ataque su propia red (SSRF).
//
// Antes scrapeLink hacia fetch(url) a lo que escribiera un profesor: sin bloquear IPs privadas, ni la
// metadata de la nube (169.254.169.254), ni redirecciones hacia ellas, y la respuesta se guardaba en
// extracted_text, que el atacante luego lee. Aqui:
//   - solo http/https, sin credenciales en la URL y solo los puertos 80 y 443;
//   - la direccion se valida en el momento de CONECTAR (opcion `lookup` de node:http), no antes: asi un DNS que
//     cambie de respuesta (DNS rebinding) no se salta la comprobacion;
//   - las redirecciones se siguen a mano, maximo 5, validando cada salto;
//   - la respuesta se lee por partes y se corta al llegar al limite (antes se bajaba entera a memoria);
//   - se pide Accept-Encoding: identity y se rechaza una respuesta comprimida (bomba de descompresion).

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

export const MAX_REDIRECTS = 5;
const ALLOWED_PORTS = new Set([80, 443]);

// ---------------------------------------------------------------- direcciones

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
}

// [inicio, mascara] de los rangos IPv4 que NUNCA son un sitio publico.
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8], // "esta red"
  ['10.0.0.0', 8], // privada
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local: aqui vive la metadata de la nube
  ['172.16.0.0', 12], // privada
  ['192.0.0.0', 24], // reservada IETF
  ['192.0.2.0', 24], // documentacion
  ['192.168.0.0', 16], // privada
  ['198.18.0.0', 15], // pruebas de red
  ['198.51.100.0', 24], // documentacion
  ['203.0.113.0', 24], // documentacion
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservada y broadcast
];

export function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    const start = ipv4ToInt(base);
    return n >= start && n < start + size;
  });
}

// Expande una IPv6 a sus 8 grupos de 16 bits (maneja "::" y un IPv4 incrustado al final).
function expandIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    s = s.slice(0, -v4[1].length) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (parts.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...Array(parts.length === 2 ? missing : 0).fill('0'), ...tail].map((g) => parseInt(g || '0', 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

export function isBlockedIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return true; // no se pudo interpretar: se rechaza
  const allZeroUntil = (k: number) => g.slice(0, k).every((x) => x === 0);
  if (allZeroUntil(7) && (g[7] === 0 || g[7] === 1)) return true; // :: y ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unica local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  // IPv4 incrustado: ::ffff:a.b.c.d (mapeada), ::a.b.c.d (compatible) y 64:ff9b::/96 (NAT64)
  const embedded = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (allZeroUntil(5) && g[5] === 0xffff) return isBlockedIPv4(embedded);
  if (allZeroUntil(6)) return isBlockedIPv4(embedded);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedIPv4(embedded);
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentacion
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isBlockedIPv4(ip);
  if (kind === 6) return isBlockedIPv6(ip);
  return true;
}

// ---------------------------------------------------------------- URL

export class UnsafeUrlError extends Error {}

export function parseSafeUrl(raw: string, allowAnyPort = false): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError('URL invalida.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UnsafeUrlError('Solo se aceptan links http/https.');
  if (u.username || u.password) throw new UnsafeUrlError('El link no puede llevar usuario ni contraseña.');
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  if (!allowAnyPort && !ALLOWED_PORTS.has(port)) throw new UnsafeUrlError('El link usa un puerto no permitido.');
  // Sin corchetes de IPv6 y sin el punto final de un nombre absoluto ("localhost." es localhost).
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) {
    throw new UnsafeUrlError('El link apunta a una direccion interna.');
  }
  // Una IP escrita directamente (incluida la forma decimal u octal que URL normaliza) se valida ya.
  if (net.isIP(host) && isBlockedAddress(host)) throw new UnsafeUrlError('El link apunta a una direccion interna.');
  return u;
}

// ---------------------------------------------------------------- descarga

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  // Solo para pruebas: permite una direccion que normalmente se bloquearia (un servidor local de prueba).
  _allowAddress?: (ip: string) => boolean;
  _allowAnyPort?: boolean;
}

export interface SafeFetchResult {
  status: number;
  contentType: string;
  body: Buffer;
  finalUrl: string;
}

function requestOnce(u: URL, opts: Required<Pick<SafeFetchOptions, 'timeoutMs' | 'maxBytes'>> & SafeFetchOptions): Promise<{ res: http.IncomingMessage; body: Buffer | null }> {
  const allow = opts._allowAddress ?? ((ip: string) => !isBlockedAddress(ip));
  const lib = u.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      u,
      {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StudiaBot/1.0)', 'Accept-Encoding': 'identity', ...opts.headers },
        timeout: opts.timeoutMs,
        // Se valida la IP REAL a la que se va a conectar (anula el DNS rebinding).
        lookup: (hostname, options, callback) => {
          dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
            if (err) return (callback as any)(err);
            const list = addresses as dns.LookupAddress[];
            if (list.length === 0 || list.some((a) => !allow(a.address))) {
              return (callback as any)(new UnsafeUrlError('El link apunta a una direccion interna.'));
            }
            if ((options as any)?.all) return (callback as any)(null, list);
            return (callback as any)(null, list[0].address, list[0].family);
          });
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ res, body: null });
        }
        const enc = String(res.headers['content-encoding'] ?? 'identity').toLowerCase();
        if (enc !== 'identity') {
          res.destroy();
          return reject(new UnsafeUrlError('La respuesta viene comprimida y no se acepta.'));
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > opts.maxBytes) {
            res.destroy();
            reject(new UnsafeUrlError('La pagina es demasiado grande para procesar.'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ res, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new UnsafeUrlError('El link tardo demasiado en responder.')));
    req.on('error', reject);
    req.end();
  });
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts = { timeoutMs: 15_000, maxBytes: 5 * 1024 * 1024, ...options };
  let url = parseSafeUrl(rawUrl, opts._allowAnyPort);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { res, body } = await requestOnce(url, opts);
    const status = res.statusCode ?? 0;
    if (body === null) {
      // Redireccion: se vuelve a validar el destino completo.
      url = parseSafeUrl(new URL(String(res.headers.location), url).toString(), opts._allowAnyPort);
      continue;
    }
    return { status, contentType: String(res.headers['content-type'] ?? ''), body, finalUrl: url.toString() };
  }
  throw new UnsafeUrlError('El link tiene demasiadas redirecciones.');
}
