// Temas visuales de las plantillas de fichas. Un tema es SOLO datos: una paleta, tipografias, formas y un fondo decorativo que se aplican como variables CSS
// (--f-*) al contenedor de la ficha; el CSS (fichaThemes.css) y los componentes de estructura (ThemedLayouts.tsx) leen esas variables y nunca llevan un color propio.
// Asi, cada plantilla = una ESTRUCTURA (layout) + un TEMA, y una estructura sirve para muchos estilos.
//
// Los temas son AUTOCONTENIDOS: traen su propio fondo y su propio texto, asi que se ven igual con la app en modo claro u oscuro (como una hoja de papel o una
// pantalla puesta sobre la pagina). Eso permite una estetica fuerte (papel, plano azul, neon) sin depender del tema de la app. Las plantillas "funcionales" (Clasica,
// Tarjeta visual, Cornell, Compacta) NO usan temas: siguen los colores de la app.
//
// Direcciones de estilo tomadas de la skill ui-ux-pro-max: Claymorphism (infantil: bordes 3-4 px, sombras dobles, radios 16-24 px, Baloo 2), Organic Biophilic (verdes y
// tierras, formas organicas), Neubrutalism (bordes y sombras duras, sin degradados), Glassmorphism (vidrio esmerilado), Retro-Futurism (neon) y tipografia editorial (Playfair).
//
// Cada par texto/fondo se declara en `pairs` y una prueba exige contraste >= 4.5:1 (WCAG AA) a todos.

export type FichaFont = 'baloo' | 'playfair' | null;

export interface Tile {
  bg: string;
  fg: string;
}

export interface FichaThemeTokens {
  bg: string; // fondo del contenedor
  card: string; // fondo de las tarjetas/hoja
  // Color REAL contra el que se mide el texto de la tarjeta. Igual a `card` salvo en temas translucidos (vidrio), donde es el peor caso de la mezcla.
  cardWorst?: string;
  fg: string;
  muted: string;
  line: string;
  accent: string;
  onAccent: string;
  accentText: string; // el acento usado COMO TEXTO sobre la tarjeta
  highlight: string; // fondo de la idea destacada y del marcador
  tiles: [Tile, Tile, Tile, Tile]; // colores que se alternan en mosaicos y chips
  sticky: Tile; // notas adhesivas del cuaderno
  margin: string; // linea de margen del cuaderno
  radius: string;
  radiusSm: string;
  borderW: string;
  shadow: string;
  badgeRadius: string; // forma de los numeros: circulo, hoja, cuadrado...
  headWeight: string;
  headTransform: 'none' | 'uppercase';
  headTracking: string;
  fontHead: string;
  fontBody: string;
  fontLabel: string;
  font: FichaFont; // fuente web que hay que cargar (Baloo 2 o Playfair); null = solo fuentes del sistema
  pathStyle: 'dotted' | 'dashed' | 'solid';
  pathWidth: string;
  blur?: string; // desenfoque del vidrio
  pattern?: string; // fondo decorativo (CSS background-image)
  patternSize?: string;
}

export interface FichaTheme {
  id: string;
  font: FichaFont;
  vars: Record<string, string>;
  // [que se mide, texto, fondo]: todos deben cumplir 4.5:1.
  pairs: [string, string, string][];
}

const SYS_SANS = `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
const SYS_ROUND = `var(--font-baloo), ui-rounded, 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif`;
const SYS_SERIF = `Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif`;
const PLAYFAIR = `var(--font-playfair), 'Playfair Display', Georgia, 'Times New Roman', serif`;
const SYS_MONO = `ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`;

const svg = (body: string, w: number, h: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${body}</svg>`)}")`;

// Rejilla de lineas finas (cuadernos y planos).
const grid = (c: string, size: number) => `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`;

const THEME_TOKENS: Record<string, FichaThemeTokens> = {
  // ── Infantiles ──
  aventura: {
    bg: '#EEF2FF', card: '#FFFFFF', fg: '#1E1B4B', muted: '#475569', line: '#C7D2FE', accent: '#4F46E5', onAccent: '#FFFFFF', accentText: '#4338CA', highlight: '#FDE68A',
    tiles: [{ bg: '#4F46E5', fg: '#FFFFFF' }, { bg: '#EA580C', fg: '#000000' }, { bg: '#047857', fg: '#FFFFFF' }, { bg: '#BE185D', fg: '#FFFFFF' }],
    sticky: { bg: '#FEF08A', fg: '#422006' }, margin: '#F87171',
    radius: '26px', radiusSm: '16px', borderW: '3px', shadow: '0 6px 0 #C7D2FE, 0 12px 20px rgba(30,27,75,0.12)', badgeRadius: '9999px',
    headWeight: '700', headTransform: 'none', headTracking: '0', fontHead: SYS_ROUND, fontBody: SYS_SANS, fontLabel: SYS_ROUND, font: 'baloo',
    pathStyle: 'dotted', pathWidth: '5px',
    pattern: svg(`<circle cx='6' cy='6' r='2' fill='#C7D2FE'/><circle cx='26' cy='24' r='1.5' fill='#FDE68A'/>`, 36, 36), patternSize: '36px 36px',
  },
  arcoiris: {
    bg: '#FFF7ED', card: '#FFFFFF', fg: '#2D1B3D', muted: '#5B4B6B', line: '#EBC9B5', accent: '#6D28D9', onAccent: '#FFFFFF', accentText: '#6D28D9', highlight: '#FFE9A8',
    tiles: [{ bg: '#FFD3C7', fg: '#2D1B3D' }, { bg: '#C9E6FF', fg: '#2D1B3D' }, { bg: '#CDF2D6', fg: '#2D1B3D' }, { bg: '#E3D5FF', fg: '#2D1B3D' }],
    sticky: { bg: '#FFE9A8', fg: '#2D1B3D' }, margin: '#F5A3B7',
    radius: '30px', radiusSm: '20px', borderW: '3px', shadow: '0 5px 0 #EBC9B5, inset -3px -3px 8px rgba(45,27,61,0.06)', badgeRadius: '9999px',
    headWeight: '700', headTransform: 'none', headTracking: '0', fontHead: SYS_ROUND, fontBody: SYS_SANS, fontLabel: SYS_ROUND, font: 'baloo',
    pathStyle: 'dotted', pathWidth: '5px',
    pattern: svg(`<circle cx='7' cy='7' r='3' fill='#FFD3C7'/><circle cx='28' cy='22' r='3' fill='#C9E6FF'/><circle cx='14' cy='30' r='2' fill='#CDF2D6'/>`, 40, 40), patternSize: '40px 40px',
  },

  // ── Por area ──
  naturaleza: {
    bg: '#F1F6E8', card: '#FFFFFF', fg: '#1F3D2B', muted: '#4B5E52', line: '#CFE0C3', accent: '#2F6B3F', onAccent: '#FFFFFF', accentText: '#2F6B3F', highlight: '#DDF2C8',
    tiles: [{ bg: '#2F6B3F', fg: '#FFFFFF' }, { bg: '#8A5A2B', fg: '#FFFFFF' }, { bg: '#2A7494', fg: '#FFFFFF' }, { bg: '#DDF2C8', fg: '#1F3D2B' }],
    sticky: { bg: '#DDF2C8', fg: '#1F3D2B' }, margin: '#8A5A2B',
    radius: '34px 12px 34px 12px', radiusSm: '18px 8px 18px 8px', borderW: '2px', shadow: '0 10px 28px rgba(47,107,63,0.15)', badgeRadius: '70% 0 70% 0',
    headWeight: '700', headTransform: 'none', headTracking: '0', fontHead: SYS_SERIF, fontBody: SYS_SANS, fontLabel: SYS_SANS, font: null,
    pathStyle: 'solid', pathWidth: '4px',
    pattern: `radial-gradient(circle at 8% 0%, rgba(47,107,63,0.13), transparent 38%), radial-gradient(circle at 96% 100%, rgba(42,116,148,0.10), transparent 40%)`, patternSize: '100% 100%',
  },
  laboratorio: {
    bg: '#ECFDF9', card: '#FFFFFF', fg: '#0B3B3A', muted: '#3F5F5E', line: '#99E6DA', accent: '#0F766E', onAccent: '#FFFFFF', accentText: '#0F766E', highlight: '#CCFBF1',
    tiles: [{ bg: '#0F766E', fg: '#FFFFFF' }, { bg: '#6D28D9', fg: '#FFFFFF' }, { bg: '#B45309', fg: '#FFFFFF' }, { bg: '#CCFBF1', fg: '#0B3B3A' }],
    sticky: { bg: '#CCFBF1', fg: '#0B3B3A' }, margin: '#0F766E',
    radius: '16px', radiusSm: '10px', borderW: '2px', shadow: '0 3px 0 #99E6DA, 0 10px 22px rgba(15,118,110,0.12)', badgeRadius: '28%',
    headWeight: '800', headTransform: 'none', headTracking: '-0.01em', fontHead: SYS_SANS, fontBody: SYS_SANS, fontLabel: SYS_MONO, font: null,
    pathStyle: 'dashed', pathWidth: '3px',
    pattern: svg(`<path d='M28 2 L52 16 L52 44 L28 58 L4 44 L4 16 Z' fill='none' stroke='#99E6DA' stroke-width='1.2'/>`, 56, 60), patternSize: '56px 60px',
  },
  cuadriculado: {
    bg: '#EAF2FF', card: '#FDFEFF', fg: '#1E3A8A', muted: '#475569', line: '#BFDBFE', accent: '#1D4ED8', onAccent: '#FFFFFF', accentText: '#1D4ED8', highlight: '#FEF08A',
    tiles: [{ bg: '#1D4ED8', fg: '#FFFFFF' }, { bg: '#B91C1C', fg: '#FFFFFF' }, { bg: '#047857', fg: '#FFFFFF' }, { bg: '#FEF08A', fg: '#422006' }],
    sticky: { bg: '#FEF08A', fg: '#422006' }, margin: '#F87171',
    radius: '8px', radiusSm: '4px', borderW: '1px', shadow: '0 1px 0 #BFDBFE, 0 12px 26px rgba(30,58,138,0.12)', badgeRadius: '4px',
    headWeight: '700', headTransform: 'none', headTracking: '0', fontHead: SYS_ROUND, fontBody: SYS_SANS, fontLabel: SYS_MONO, font: null,
    pathStyle: 'solid', pathWidth: '3px',
    pattern: grid('#CFE0FA', 24), patternSize: '24px 24px',
  },
  plano: {
    bg: '#0B2A55', card: '#0E3566', fg: '#E8F1FF', muted: '#B6CDF0', line: '#5E8FD6', accent: '#7DD3FC', onAccent: '#082F49', accentText: '#7DD3FC', highlight: '#17487F',
    tiles: [{ bg: '#7DD3FC', fg: '#082F49' }, { bg: '#FDE68A', fg: '#3B2F05' }, { bg: '#86EFAC', fg: '#052E16' }, { bg: '#0B2A55', fg: '#E8F1FF' }],
    sticky: { bg: '#FDE68A', fg: '#3B2F05' }, margin: '#7DD3FC',
    radius: '4px', radiusSm: '2px', borderW: '1px', shadow: 'none', badgeRadius: '2px',
    headWeight: '700', headTransform: 'uppercase', headTracking: '0.06em', fontHead: SYS_MONO, fontBody: SYS_SANS, fontLabel: SYS_MONO, font: null,
    pathStyle: 'dashed', pathWidth: '2px',
    pattern: grid('#16427F', 20), patternSize: '20px 20px',
  },
  archivo: {
    bg: '#F3E9D2', card: '#FBF5E6', fg: '#3B2A1A', muted: '#5B4636', line: '#CBB68A', accent: '#8B3A2B', onAccent: '#FBF5E6', accentText: '#8B3A2B', highlight: '#EAD9A8',
    tiles: [{ bg: '#8B3A2B', fg: '#FBF5E6' }, { bg: '#7A5C1E', fg: '#FBF5E6' }, { bg: '#3F5B3A', fg: '#FBF5E6' }, { bg: '#EAD9A8', fg: '#3B2A1A' }],
    sticky: { bg: '#EAD9A8', fg: '#3B2A1A' }, margin: '#8B3A2B',
    radius: '6px', radiusSm: '3px', borderW: '1px', shadow: '0 1px 0 #CBB68A, 0 14px 30px rgba(59,42,26,0.16)', badgeRadius: '9999px',
    headWeight: '700', headTransform: 'none', headTracking: '0', fontHead: PLAYFAIR, fontBody: SYS_SERIF, fontLabel: SYS_MONO, font: 'playfair',
    pathStyle: 'solid', pathWidth: '3px',
    pattern: `radial-gradient(ellipse at 50% 0%, rgba(139,58,43,0.08), transparent 60%), radial-gradient(ellipse at 50% 100%, rgba(122,92,30,0.10), transparent 55%)`, patternSize: '100% 100%',
  },
  libro: {
    bg: '#FAF6EF', card: '#FFFDF8', fg: '#231F20', muted: '#5A5252', line: '#E3D8C5', accent: '#9B1C31', onAccent: '#FFFFFF', accentText: '#9B1C31', highlight: '#F6E7C8',
    tiles: [{ bg: '#9B1C31', fg: '#FFFFFF' }, { bg: '#1F4E79', fg: '#FFFFFF' }, { bg: '#4A6741', fg: '#FFFFFF' }, { bg: '#F6E7C8', fg: '#231F20' }],
    sticky: { bg: '#F6E7C8', fg: '#231F20' }, margin: '#9B1C31',
    radius: '4px', radiusSm: '2px', borderW: '1px', shadow: '0 1px 2px rgba(35,31,32,0.10), 0 16px 32px rgba(35,31,32,0.08)', badgeRadius: '9999px',
    headWeight: '700', headTransform: 'none', headTracking: '-0.01em', fontHead: PLAYFAIR, fontBody: SYS_SERIF, fontLabel: SYS_SERIF, font: 'playfair',
    pathStyle: 'solid', pathWidth: '2px',
  },

  // ── Esteticos ──
  editorial: {
    bg: '#FFFFFF', card: '#FFFFFF', fg: '#111111', muted: '#555555', line: '#111111', accent: '#111111', onAccent: '#FFFFFF', accentText: '#111111', highlight: '#F2F2F2',
    tiles: [{ bg: '#111111', fg: '#FFFFFF' }, { bg: '#F2F2F2', fg: '#111111' }, { bg: '#E5E5E5', fg: '#111111' }, { bg: '#FFFFFF', fg: '#111111' }],
    sticky: { bg: '#F2F2F2', fg: '#111111' }, margin: '#111111',
    radius: '0px', radiusSm: '0px', borderW: '1px', shadow: 'none', badgeRadius: '0px',
    headWeight: '900', headTransform: 'none', headTracking: '-0.03em', fontHead: PLAYFAIR, fontBody: SYS_SERIF, fontLabel: SYS_MONO, font: 'playfair',
    pathStyle: 'solid', pathWidth: '1px',
  },
  neon: {
    bg: '#0A0A1A', card: '#14142B', fg: '#F1F5F9', muted: '#A5B4CF', line: '#3B3B7A', accent: '#22D3EE', onAccent: '#04202A', accentText: '#22D3EE', highlight: '#25255A',
    tiles: [{ bg: '#22D3EE', fg: '#04202A' }, { bg: '#F472B6', fg: '#2A0A1A' }, { bg: '#A78BFA', fg: '#140A33' }, { bg: '#14142B', fg: '#F1F5F9' }],
    sticky: { bg: '#25255A', fg: '#F1F5F9' }, margin: '#F472B6',
    radius: '16px', radiusSm: '10px', borderW: '1px', shadow: '0 0 0 1px rgba(34,211,238,0.35), 0 0 28px rgba(34,211,238,0.20)', badgeRadius: '8px',
    headWeight: '800', headTransform: 'none', headTracking: '0.01em', fontHead: SYS_SANS, fontBody: SYS_SANS, fontLabel: SYS_MONO, font: null,
    pathStyle: 'dashed', pathWidth: '2px',
    pattern: svg(`<circle cx='2' cy='2' r='1.2' fill='#2B2B5E'/>`, 22, 22), patternSize: '22px 22px',
  },
  brutalista: {
    bg: '#FFFDF0', card: '#FFFFFF', fg: '#000000', muted: '#2B2B2B', line: '#000000', accent: '#FFE14D', onAccent: '#000000', accentText: '#000000', highlight: '#FFE14D',
    tiles: [{ bg: '#FFE14D', fg: '#000000' }, { bg: '#FF6B6B', fg: '#000000' }, { bg: '#4ECDC4', fg: '#000000' }, { bg: '#B8A1FF', fg: '#000000' }],
    sticky: { bg: '#FFE14D', fg: '#000000' }, margin: '#FF6B6B',
    radius: '0px', radiusSm: '0px', borderW: '3px', shadow: '6px 6px 0 #000000', badgeRadius: '0px',
    headWeight: '900', headTransform: 'uppercase', headTracking: '0', fontHead: `'Arial Black', 'Helvetica Neue', Arial, sans-serif`, fontBody: SYS_SANS, fontLabel: SYS_MONO, font: null,
    pathStyle: 'solid', pathWidth: '4px',
  },
  aurora: {
    bg: '#1E1B4B', card: 'rgba(15, 23, 42, 0.72)', cardWorst: '#525865', fg: '#FFFFFF', muted: '#E2E8F0', line: 'rgba(255, 255, 255, 0.30)', accent: '#5EEAD4', onAccent: '#042F2E', accentText: '#5EEAD4', highlight: 'rgba(94, 234, 212, 0.18)',
    tiles: [{ bg: '#5EEAD4', fg: '#042F2E' }, { bg: '#C4B5FD', fg: '#1E1B4B' }, { bg: '#FDBA74', fg: '#431407' }, { bg: '#312E81', fg: '#FFFFFF' }],
    sticky: { bg: '#312E81', fg: '#FFFFFF' }, margin: '#C4B5FD',
    radius: '24px', radiusSm: '14px', borderW: '1px', shadow: '0 10px 36px rgba(0, 0, 0, 0.35)', badgeRadius: '9999px',
    headWeight: '700', headTransform: 'none', headTracking: '-0.01em', fontHead: SYS_SANS, fontBody: SYS_SANS, fontLabel: SYS_SANS, font: null,
    pathStyle: 'solid', pathWidth: '2px', blur: '14px',
    pattern: `radial-gradient(circle at 12% 8%, rgba(94, 234, 212, 0.55), transparent 38%), radial-gradient(circle at 88% 14%, rgba(167, 139, 250, 0.60), transparent 42%), radial-gradient(circle at 70% 92%, rgba(253, 186, 116, 0.40), transparent 40%)`, patternSize: '100% 100%',
  },
};

function build(id: string, t: FichaThemeTokens): FichaTheme {
  const worst = t.cardWorst ?? t.card;
  const vars: Record<string, string> = {
    '--f-bg': t.bg, '--f-card': t.card, '--f-fg': t.fg, '--f-muted': t.muted, '--f-line': t.line,
    '--f-accent': t.accent, '--f-on-accent': t.onAccent, '--f-accent-text': t.accentText, '--f-highlight': t.highlight,
    '--f-sticky-bg': t.sticky.bg, '--f-sticky-fg': t.sticky.fg, '--f-margin': t.margin,
    '--f-radius': t.radius, '--f-radius-sm': t.radiusSm, '--f-border-w': t.borderW, '--f-shadow': t.shadow, '--f-badge-radius': t.badgeRadius,
    '--f-head-weight': t.headWeight, '--f-head-transform': t.headTransform, '--f-head-tracking': t.headTracking,
    '--f-font-head': t.fontHead, '--f-font-body': t.fontBody, '--f-font-label': t.fontLabel,
    '--f-path-style': t.pathStyle, '--f-path-w': t.pathWidth, '--f-blur': t.blur ?? '0px',
    '--f-pattern': t.pattern ?? 'none', '--f-pattern-size': t.patternSize ?? 'auto',
  };
  t.tiles.forEach((tile, i) => {
    vars[`--f-t${i + 1}-bg`] = tile.bg;
    vars[`--f-t${i + 1}-fg`] = tile.fg;
  });
  const pairs: [string, string, string][] = [
    ['texto sobre la tarjeta', t.fg, worst],
    ['texto secundario sobre la tarjeta', t.muted, worst],
    ['acento como texto sobre la tarjeta', t.accentText, worst],
    ['texto sobre la idea destacada', t.fg, t.highlight.startsWith('rgba') ? worst : t.highlight],
    // Los modulos bloqueados del mapa dibujan su icono y su texto secundario sobre este fondo.
    ['texto secundario sobre la idea destacada', t.muted, t.highlight.startsWith('rgba') ? worst : t.highlight],
    ['texto sobre el acento', t.onAccent, t.accent],
    ['texto sobre el fondo', t.fg, t.bg],
    ['nota adhesiva', t.sticky.fg, t.sticky.bg],
    ...t.tiles.map((tile, i): [string, string, string] => [`mosaico ${i + 1}`, tile.fg, tile.bg]),
  ];
  return { id, font: t.font, vars, pairs };
}

export const FICHA_THEMES: Record<string, FichaTheme> = Object.fromEntries(Object.entries(THEME_TOKENS).map(([id, t]) => [id, build(id, t)]));

export const FICHA_THEME_IDS = Object.keys(FICHA_THEMES);

export const getFichaTheme = (id: string): FichaTheme | null => FICHA_THEMES[id] ?? null;

// ── Contraste (WCAG 2.x) ──
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
