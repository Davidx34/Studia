// Rutas del estudiante YA migradas a los tokens de diseño, y por tanto aptas para el tema claro.
//
// El resto sigue con colores fijos (texto blanco, fondos oscuros): si se les aplicara el tema claro quedarian
// ilegibles. Al migrar una pantalla se agrega aqui su ruta.
export const THEMED_STUDENT_ROUTES = ['/dashboard', '/lesson', '/map', '/achievements'] as const;

export function isThemedStudentRoute(pathname: string): boolean {
  return THEMED_STUDENT_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'));
}
