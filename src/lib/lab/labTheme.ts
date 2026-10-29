// Los colores del tema de la app (claro u oscuro) pasados al laboratorio como variables --lab-*. Sin React: recibe una funcion que lee una variable CSS, asi se puede probar.

// Variable de la app (triple "R G B" de Tailwind) -> variable del laboratorio.
const MAP: Record<string, string> = {
  '--lab-bg': '--c-bg',
  '--lab-surface': '--c-surface',
  '--lab-surface2': '--c-surface-2',
  '--lab-line': '--c-line',
  '--lab-fg': '--c-fg',
  '--lab-muted': '--c-fg-muted',
  '--lab-primary': '--c-primary',
  '--lab-on-primary': '--c-on-primary',
  '--lab-accent': '--c-accent-text',
  '--lab-success': '--c-success',
  '--lab-danger': '--c-danger',
};

// "79 70 229" -> "rgb(79 70 229)". Cualquier otra cosa se descarta (el laboratorio solo acepta valores de color simples).
export function toRgb(triple: string): string | null {
  const m = triple.trim().match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  return r <= 255 && g <= 255 && b <= 255 ? `rgb(${r} ${g} ${b})` : null;
}

export function labThemeVars(read: (cssVar: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [lab, app] of Object.entries(MAP)) {
    const rgb = toRgb(read(app));
    if (rgb) out[lab] = rgb;
  }
  return out;
}
