// Temas de las plantillas del mapa: son los MISMOS de las fichas (src/lib/study/fichaThemes.ts) mas uno adaptable, 'app', que sigue los colores de la app en
// claro y oscuro (lo usa el Tablero funcional). El CSS de las plantillas solo lee variables --f-*, asi que un tema es solo un juego de variables.

import { getFichaTheme, type FichaFont } from '@/lib/study/fichaThemes';

export interface MapTheme {
  id: string;
  font: FichaFont;
  vars: Record<string, string>;
}

const rgb = (token: string) => `rgb(var(--c-${token}))`;

// Adaptable: cada variable apunta a un color de la app (cambian con el tema claro/oscuro). Los pares de contraste ya los garantiza el sistema de diseño de la app.
const APP_THEME: MapTheme = {
  id: 'app',
  font: null,
  vars: {
    '--f-bg': rgb('surface-2'), '--f-card': rgb('surface'), '--f-fg': rgb('fg'), '--f-muted': rgb('fg-muted'), '--f-line': rgb('line'),
    '--f-accent': rgb('primary'), '--f-on-accent': rgb('on-primary'), '--f-accent-text': rgb('primary-text'), '--f-highlight': rgb('surface-2'),
    '--f-sticky-bg': rgb('surface-2'), '--f-sticky-fg': rgb('fg'), '--f-margin': rgb('primary'),
    '--f-radius': '20px', '--f-radius-sm': '12px', '--f-border-w': '1px', '--f-shadow': 'var(--shadow-card)', '--f-badge-radius': '9999px',
    '--f-head-weight': '700', '--f-head-transform': 'none', '--f-head-tracking': '0',
    '--f-font-head': 'var(--font-sans), system-ui, sans-serif', '--f-font-body': 'var(--font-sans), system-ui, sans-serif', '--f-font-label': 'var(--font-sans), system-ui, sans-serif',
    '--f-path-style': 'dashed', '--f-path-w': '3px', '--f-blur': '0px', '--f-pattern': 'none', '--f-pattern-size': 'auto',
    '--f-t1-bg': rgb('primary'), '--f-t1-fg': rgb('on-primary'),
    '--f-t2-bg': rgb('accent'), '--f-t2-fg': rgb('on-accent'),
    '--f-t3-bg': rgb('surface-2'), '--f-t3-fg': rgb('fg'),
    '--f-t4-bg': rgb('surface'), '--f-t4-fg': rgb('fg'),
  },
};

export function getMapTheme(id: string | null): MapTheme | null {
  if (!id) return null;
  if (id === 'app') return APP_THEME;
  const t = getFichaTheme(id);
  return t ? { id: t.id, font: t.font, vars: t.vars } : null;
}
