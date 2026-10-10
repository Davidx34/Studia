// Preferencia de tema (oscuro / claro / sistema) y como se resuelve.
//
// La app es oscura de origen. El tema claro es una OPCION del estudiante: solo se aplica dentro de
// las pantallas ya migradas a tokens (las que usan la clase .theme-scope); el resto sigue oscuro
// hasta migrarlas. Ver src/app/globals.css.

export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'studia-theme';
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'dark';

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(preference: ThemePreference, systemPrefersLight: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersLight ? 'light' : 'dark';
  return preference;
}

// Script que corre ANTES de pintar (en <head>) para que el tema elegido no parpadee. Es una cadena fija:
// no incluye nada del usuario salvo lo que lee de su propio localStorage, y solo lo compara.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var l=t==='light'||(t==='system'&&window.matchMedia('(prefers-color-scheme: light)').matches);document.documentElement.setAttribute('data-theme',l?'light':'dark');}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;
