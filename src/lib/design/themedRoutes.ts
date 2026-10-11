// Rutas del estudiante YA migradas a los tokens de diseño, y por tanto aptas para el tema claro.
//
// Si una pantalla vuelve a usar colores fijos (texto blanco, fondos oscuros) NO debe estar aqui: con el tema claro
// quedaria ilegible. Al migrar una pantalla se agrega aqui su ruta.
export const THEMED_STUDENT_ROUTES = ['/dashboard', '/lesson', '/map', '/achievements', '/my-classes', '/repaso'] as const;

export function isThemedStudentRoute(pathname: string): boolean {
  return THEMED_STUDENT_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'));
}
