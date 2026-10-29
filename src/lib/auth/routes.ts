// Rutas de autenticacion y rutas publicas, compartidas por el middleware y sus
// tests. Antes estaban escritas a mano (dos veces) dentro de middleware.ts.

// Solo para quien NO tiene sesion: con sesion se redirige al dashboard.
export const AUTH_PAGES: readonly string[] = ['/login', '/signup'];

// Accesibles CON o SIN sesion.
//
// /reset-password tiene que estar aqui y NO en AUTH_PAGES: el enlace del correo
// deja al usuario con una sesion de recuperacion ya iniciada, asi que tratarla
// como pagina de auth lo mandaria al dashboard antes de poder escribir la
// contraseña nueva. /forgot-password se agrega por la razon contraria: sin
// sesion, el middleware la mandaba a /login, que es justo donde esta quien
// olvido su contraseña.
export const PUBLIC_PAGES: readonly string[] = ['/offline', '/forgot-password', '/reset-password'];

export function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.includes(pathname);
}

export function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGES.includes(pathname);
}

// Archivos estaticos de public/ que el navegador debe poder leer SIN sesion.
// El matcher del middleware no excluye public/, asi que sin esto el manifest y
// los iconos de la PWA responden 307 -> /login y la instalacion desde la
// pantalla de acceso falla (el navegador recibe HTML en vez del JSON/PNG).
// Son solo assets de marca (sin datos de usuarios); no abre ninguna ruta de la
// app ni de la API. sw.js y /_next/static ya estan excluidos en el matcher.
const PUBLIC_ASSET_EXACT: readonly string[] = ['/manifest.json'];
const PUBLIC_ASSET_PREFIXES: readonly string[] = ['/icons/', '/tonito/', '/labs/'];

export function isPublicAsset(pathname: string): boolean {
  if (pathname.includes('..')) return false;
  return (
    PUBLIC_ASSET_EXACT.includes(pathname) ||
    PUBLIC_ASSET_PREFIXES.some((p) => pathname.startsWith(p) && pathname.length > p.length)
  );
}
