import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const code = (src: string) =>
  src
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('{/*'))
    .join('\n');

const GAMES = [
  'src/components/LessonQuestionMatch.tsx',
  'src/components/minigames/AlquimiaConceptualGame.tsx',
  'src/components/minigames/CategoriesGame.tsx',
  'src/components/minigames/CuartoCrisisGame.tsx',
  'src/components/minigames/ElDescifrador.tsx',
  'src/components/minigames/FlashcardGame.tsx',
  'src/components/minigames/ImpostorCognitivoGame.tsx',
  'src/components/minigames/JuicioConocimientoGame.tsx',
  'src/components/minigames/TimelineGame.tsx',
];

// Un color fijo de Tailwind (bg-purple-700, text-white...) no cambia con el tema: en claro quedaria ilegible.
const FIXED = /\b(?:bg|text|border|from|to|via|ring)-(?:white|gray|slate|zinc|purple|violet|fuchsia|pink|rose|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo)(?:-\d{2,3})?(?:\/\d+)?\b/;

describe('los minijuegos usan tokens de diseño', () => {
  it.each(GAMES)('%s no tiene colores fijos de Tailwind', (file) => {
    const m = code(read(file)).match(FIXED);
    expect(m, m ? `color fijo: ${m[0]}` : '').toBeNull();
  });

  it('no usan un trazo SVG con color fijo: el de "conectar conceptos" sigue el tema', () => {
    const src = read('src/components/LessonQuestionMatch.tsx');
    expect(src).toContain("'rgb(var(--c-primary))'");
    expect(src).toContain("'rgb(var(--c-success))'");
    expect(src).toContain("'rgb(var(--c-danger))'");
    expect(src).not.toMatch(/stroke=\{[^}]*#[0-9a-f]{3,6}/i);
  });
});

describe('accesibilidad de los minijuegos', () => {
  it('"conectar conceptos" marca acierto y error con icono y texto, y el termino elegido con aria-pressed', () => {
    const src = read('src/components/LessonQuestionMatch.tsx');
    expect(src).toContain('(conexion correcta)');
    expect(src).toContain('(conexion incorrecta)');
    expect(src).toContain('aria-pressed={selectedTerm === termIdx}');
  });

  it('cada letra de El Descifrador dice si fue acierto o fallo', () => {
    expect(read('src/components/minigames/ElDescifrador.tsx')).toMatch(/aria-label=\{used \? `\$\{letter\}: \$\{isHit \? 'acierto' : 'fallo'\}`/);
  });

  it('el foco de teclado es visible en todo control de una pantalla con tema', () => {
    expect(read('src/app/globals.css')).toMatch(/\.theme-scope :is\(button, a, input, textarea, select, summary, \[tabindex\]\):focus-visible\s*\{\s*outline: 2px solid rgb\(var\(--c-ring\)\)/);
  });
});

describe('el tema claro de la leccion', () => {
  it('/lesson acepta el tema claro (ya no quedan colores fijos en la pagina ni en los minijuegos)', () => {
    expect(read('src/lib/design/themedRoutes.ts')).toContain("'/lesson'");
  });

  it('REGRESION: data-theme NO va en el JSX de <html>: si una hidratacion falla, React reescribiria el atributo y pisaria el tema elegido', () => {
    const layout = code(read('src/app/layout.tsx'));
    expect(layout).not.toMatch(/<html[^>]*data-theme/);
    expect(layout).toContain('THEME_INIT_SCRIPT');
  });
});
