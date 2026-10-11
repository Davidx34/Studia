import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';

// Estos dos tocan Supabase/almacenamiento al montarse: aqui solo interesa el marco.
vi.mock('@/components/LogoutButton', () => ({ LogoutButton: () => h('button', null, 'Cerrar sesión') }));
vi.mock('@/components/SoundToggle', () => ({ SoundToggle: () => h('button', null, 'Sonido') }));

import { StudentShell } from './StudentShell';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { isThemedStudentRoute, THEMED_STUDENT_ROUTES } from '@/lib/design/themedRoutes';

const shell = (pathname: string) => renderToStaticMarkup(h(StudentShell as any, { pathname, user: { email: 'a@b.co', name: 'Kevin' } }, h('p', null, 'contenido')));

describe('rutas con tema claro', () => {
  it('todas las pantallas del estudiante estan migradas', () => {
    expect(THEMED_STUDENT_ROUTES).toEqual(['/dashboard', '/lesson', '/map', '/achievements', '/my-classes', '/repaso']);
    expect(isThemedStudentRoute('/lesson/abc')).toBe(true);
    expect(isThemedStudentRoute('/dashboard')).toBe(true);
    expect(isThemedStudentRoute('/dashboard/algo')).toBe(true);
  });

  it('las pantallas sin migrar NO aceptan el tema claro (su texto blanco quedaria ilegible)', () => {
    for (const r of ['/lessons', '/mapa', '/achievements-x', '/my-classesx', '/repasos', '/dashboardx', '']) expect(isThemedStudentRoute(r)).toBe(false);
  });
});

describe('StudentShell', () => {
  it('en una ruta migrada aplica el tema y muestra el selector', () => {
    const html = shell('/dashboard');
    expect(html).toContain('theme-scope');
    expect(html).toContain('Tema de color');
  });

  it('en una ruta sin migrar NO aplica el tema ni muestra el selector (sigue oscura)', () => {
    const html = shell('/lessons');
    expect(html).not.toContain('theme-scope');
    expect(html).not.toContain('Tema de color');
    expect(html).toContain('bg-slate-950');
  });

  it('la navegacion lleva icono Y texto, marca la pagina actual y existe en pantallas grandes y chicas', () => {
    const html = shell('/map');
    for (const label of ['Inicio', 'Mapa', 'Logros']) expect(html).toContain(label);
    expect(html.match(/aria-current="page"/g)!.length).toBe(2); // una en la barra superior y otra en la inferior
    expect(html.match(/aria-label="Principal"/g)!.length).toBe(2);
    expect(html).toContain('aria-hidden="true"'); // los iconos no se leen
  });

  it('tiene enlace para saltar al contenido y un unico main enfocable', () => {
    const html = shell('/dashboard');
    expect(html).toContain('href="#contenido"');
    expect(html.match(/<main/g)!.length).toBe(1);
    expect(html).toContain('id="contenido"');
  });

  it('la barra inferior respeta el area segura del movil y el contenido deja espacio para ella', () => {
    const html = shell('/dashboard');
    expect(html).toContain('safe-area-inset-bottom');
    expect(html).toContain('pb-28 md:pb-8');
  });

  it('muestra el nombre y el correo del usuario', () => {
    const html = shell('/dashboard');
    expect(html).toContain('Kevin');
    expect(html).toContain('a@b.co');
  });
});

describe('ProgressBar', () => {
  const bar = (value: number) => renderToStaticMarkup(h(ProgressBar, { value, label: 'Avance' }));

  it('tiene semantica de barra de progreso con nombre', () => {
    const html = bar(40);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Avance"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain('width:40%');
  });

  it('acota el valor a 0..100 y tolera basura', () => {
    expect(bar(250)).toContain('aria-valuenow="100"');
    expect(bar(-5)).toContain('aria-valuenow="0"');
    expect(bar(NaN)).toContain('aria-valuenow="0"');
    expect(bar(33.6)).toContain('aria-valuenow="34"');
  });
});

describe('el tablero del estudiante ya no usa colores fijos', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

  it.each(['src/app/(student)/dashboard/DashboardClient.tsx', 'src/app/(student)/dashboard/MyClassesSection.tsx'])('%s usa tokens', (file) => {
    const src = read(file);
    // Un velo blanco encima de la tarjeta principal (bg-primary) es decorativo y funciona en ambos temas; lo que NO
    // debe haber es texto o bordes fijos en blanco.
    expect(src).not.toMatch(/\btext-white\b|\bborder-white\/|\btext-white\//);
    expect(src).not.toMatch(/--premium-gold/);
  });

  it('el texto falso "15 modulos esperandote en 5 categorias" ya no esta', () => {
    const code = read('src/app/(student)/dashboard/DashboardClient.tsx')
      .split('\n')
      .filter((l) => !l.trim().startsWith('{/*') && !l.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/15 módulos esperándote/);
  });

  it('la accion principal ("Continuar") va ANTES de "Mis clases"', () => {
    const src = read('src/app/(student)/dashboard/DashboardClient.tsx');
    expect(src.indexOf('heroHref')).toBeLessThan(src.indexOf('{classesSection}'));
    expect(read('src/app/(student)/dashboard/page.tsx')).toContain('classesSection={<MyClassesSection');
  });

  it('el widget de Toñito no tapa la navegacion inferior del movil', () => {
    expect(read('src/components/tonito/TonitoChatWidget.tsx')).toContain('bottom-20 md:bottom-6');
  });
});

describe('el mapa y los logros ya no usan colores fijos', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

  it.each(['src/app/(student)/map/LearningMap.tsx', 'src/app/(student)/map/page.tsx', 'src/app/(student)/achievements/AchievementsClient.tsx'])('%s usa tokens', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/\btext-white\b|\bbg-white\/|\bborder-white\/|\btext-white\/|\bbg-black\/(10|20|30|40)\b|--premium-/);
    expect(src).not.toMatch(/\b(bg|text|border)-(slate|gray|emerald|purple|yellow|amber)-\d/);
  });

  it('los nodos del mapa dicen su estado con texto (no solo color) y los bloqueados siguen siendo enfocables', () => {
    const src = read('src/app/(student)/map/LearningMap.tsx');
    expect(src).toContain('aria-label={`${node.title}, ${NODE_STATUS_TEXT[node.status]}`}');
    expect(src).toContain('aria-disabled');
    expect(src).not.toMatch(/disabled=\{isLocked\}/);
  });

  it('el dialogo del mapa es accesible: rol, titulo, Escape y foco', () => {
    const src = read('src/app/(student)/map/LearningMap.tsx');
    for (const s of ['role="dialog"', 'aria-modal="true"', 'aria-labelledby="node-title"', "e.key === 'Escape'", 'closeRef.current?.focus()']) expect(src).toContain(s);
  });

  it('respeta reducir movimiento', () => {
    const src = read('src/app/(student)/map/LearningMap.tsx');
    expect(src).toContain('prefers-reduced-motion');
    expect(src).toContain('motion-reduce:animate-none');
  });
});

describe('AchievementsClient', async () => {
  const { AchievementsClient } = await import('@/app/(student)/achievements/AchievementsClient');
  const ach = (id: string, rarity: string, name = id) => ({
    id, name, description: 'desc', icon_name: 'x', color: '#fff', criteria_type: 'modules_completed', criteria_value: 4,
    criteria_category: null, rarity, reward_coins: 5, sort_order: 0,
  });
  const render = () =>
    renderToStaticMarkup(
      h(AchievementsClient as any, {
        allAchievements: [ach('a', 'legendary', 'Leyenda'), ach('b', 'common', 'Primeros Pasos')],
        userAchievements: [{ achievement_id: 'b', earned_at: '2026-01-05T10:00:00Z', seen_by_user: true }],
        progressContext: { streakDays: 0, modulesCompleted: 1, perfectScores: 0, categoryCompleted: {} },
      })
    );

  it('un logro ganado dice "Desbloqueado" y uno pendiente muestra su progreso con semantica', () => {
    const html = render();
    expect(html).toContain('Desbloqueado');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="25"'); // 1 de 4
  });

  it('los filtros son botones con estado y la rareza se dice con texto', () => {
    const html = render();
    expect(html.match(/aria-pressed="/g)!.length).toBe(3);
    expect(html).toContain('Legendario');
    expect(html).toContain('Rareza: Legendario');
  });

  it('con meta 0 no revienta (sin NaN)', () => {
    const html = renderToStaticMarkup(
      h(AchievementsClient as any, {
        allAchievements: [{ ...ach('z', 'rare'), criteria_value: 0 }],
        userAchievements: [],
        progressContext: { streakDays: 0, modulesCompleted: 0, perfectScores: 0, categoryCompleted: {} },
      })
    );
    expect(html).not.toContain('NaN');
  });
});

describe('mis clases, biblioteca y repaso ya no usan colores fijos', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
  const FILES = ['src/app/(student)/my-classes/[id]/page.tsx', 'src/app/(student)/my-classes/[id]/library/LibraryClient.tsx', 'src/app/(student)/repaso/[planId]/page.tsx'];

  it.each(FILES)('%s usa tokens', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/\btext-white\b|\b(bg|text|border)-(slate|gray|blue|violet|purple|emerald|green|red|amber)-\d/);
  });

  it('la clase no anida botones dentro de enlaces y dice el estado con texto', () => {
    const src = read('src/app/(student)/my-classes/[id]/page.tsx');
    expect(src).not.toMatch(/<Link[^>]*>\s*<button/);
    for (const t of ['Completado', 'En curso', 'Bloqueado']) expect(src).toContain(t);
  });

  it('el repaso reusa las preguntas accesibles de la leccion', () => {
    const src = read('src/app/(student)/repaso/[planId]/page.tsx');
    expect(src).toContain('<ChoiceQuestion');
    expect(src).toContain('<AnswerFeedback');
  });

  it('la biblioteca: buscador y notas con nombre accesible, materiales con estado y controles de 44 px', () => {
    const src = read('src/app/(student)/my-classes/[id]/library/LibraryClient.tsx');
    expect(src).toContain('aria-label="Buscar en materiales"');
    expect(src).toContain('aria-label="Mis notas de este material"');
    expect(src).toContain('aria-pressed={selected?.id === m.id}');
    expect(src).not.toContain('w-7 h-7');
  });

  it('el codigo muerto ClassroomMap ya no esta', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'src/app/(student)/my-classes/[id]/ClassroomMap.tsx'))).toBe(false);
  });
});
