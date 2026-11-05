// Cookie de sesion de Supabase tal como la lee la app (@supabase/ssr 0.10): `sb-<ref>-auth-token` = "base64-" + JSON de la sesion en base64url, partida en trozos de 3180 si es larga
// (`sb-<ref>-auth-token.0`, `.1`...). Codigo puro y SIN imports de k6: lo prueba vitest (src/lib/loadtest/cookie.test.ts) contra el propio @supabase/ssr, y k6 le pasa su `encoding.b64encode`.

export const MAX_CHUNK_SIZE = 3180;

export function projectRef(supabaseUrl) {
  const m = /^https?:\/\/([^./]+)\./.exec(supabaseUrl || '');
  if (!m) throw new Error('SUPABASE_URL invalida: ' + supabaseUrl);
  return m[1];
}

export const authCookieName = (supabaseUrl) => `sb-${projectRef(supabaseUrl)}-auth-token`;

// encodeBase64Url(texto) -> base64url SIN relleno (en k6: (s) => encoding.b64encode(s, 'rawurl')).
export function authCookies(name, session, encodeBase64Url) {
  const value = 'base64-' + encodeBase64Url(JSON.stringify(session));
  if (value.length <= MAX_CHUNK_SIZE) return [{ name, value }];
  const out = [];
  for (let i = 0; i * MAX_CHUNK_SIZE < value.length; i++) out.push({ name: `${name}.${i}`, value: value.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE) });
  return out;
}

export const cookieHeader = (cookies) => cookies.map((c) => `${c.name}=${c.value}`).join('; ');
