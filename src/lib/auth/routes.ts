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
