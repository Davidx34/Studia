// Une clases de Tailwind ignorando valores vacios.
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
