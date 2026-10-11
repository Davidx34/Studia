import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';

vi.mock('@/components/LogoutButton', () => ({ LogoutButton: () => h('button', null, 'Cerrar sesión') }));

import { TeacherShell } from './TeacherShell';

const shell = (pathname: string) => renderToStaticMarkup(h(TeacherShell as any, { pathname, user: { email: 'p@u.co', name: 'Profe' } }, h('p', null, 'contenido')));

describe('TeacherShell', () => {
  it('aplica el tema (claro/oscuro/sistema) y muestra el selector', () => {
    const html = shell('/teacher/classrooms');
    expect(html).toContain('theme-scope');
    expect(html).toContain('Tema de color');
  });

  it('la navegacion lleva icono Y texto, marca la pagina actual (barra lateral y barra movil) y apunta a rutas del profesor', () => {
    const html = shell('/teacher/classrooms/abc/materials');
    for (const label of ['Inicio', 'Mis clases', 'Estudiantes']) expect(html).toContain(label);
    expect(html.match(/aria-current="page"/g)!.length).toBe(2);
    expect(html.match(/aria-label="Principal"/g)!.length).toBe(2);
    expect(html).toContain('href="/teacher/dashboard"');
    expect(html).not.toContain('href="/dashboard"'); // antes "Dashboard" llevaba al tablero del ESTUDIANTE
  });

  it('tiene enlace para saltar al contenido y un unico main enfocable', () => {
    const html = shell('/teacher/dashboard');
    expect(html).toContain('href="#contenido"');
    expect(html.match(/<main/g)!.length).toBe(1);
    expect(html).toContain('id="contenido"');
  });

  it('en el movil hay barra superior (la barra lateral fija ya no se come la pantalla)', () => {
    const html = shell('/teacher/dashboard');
    expect(html).toContain('md:hidden');
    expect(html).toMatch(/hidden md:(sticky|flex)/);
  });

  it('muestra el nombre y el correo', () => {
    const html = shell('/teacher/dashboard');
    expect(html).toContain('Profe');
    expect(html).toContain('p@u.co');
  });
});

describe('las pantallas del profesor ya no usan colores fijos', () => {
  const root = process.cwd();
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(root, 'src/app/(teacher)'));
  files.push(path.join(root, 'src/components/AIBrainConfig.tsx'), path.join(root, 'src/components/teacher/TeacherShell.tsx'));

  const FIXED = /(?<![\w-])(?:[a-z0-9-]+:)*(bg|text|border|ring|from|via|to|divide|placeholder)-(white|slate|gray|zinc|violet|purple|fuchsia|amber|yellow|orange|red|rose|emerald|green|teal|cyan|sky|blue|pink|indigo)(-\d{2,3})?(?![\w-])/;

  it.each(files.map((f) => [path.relative(root, f).replace(/\\/g, '/'), f]))('%s usa tokens', (_name, file) => {
    const src = fs.readFileSync(file as string, 'utf8');
    const bad = src.split('\n').filter((l) => FIXED.test(l) && !l.trim().startsWith('//'));
    expect(bad).toEqual([]);
    expect(src).not.toMatch(/premium-(card|focus)|var\(--premium/);
  });

  it('cada boton de solo icono con title tiene tambien aria-label', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      const re = /(<button[^>]*?\btitle=(?:"[^"]*"|\{[^}]*\})[^>]*>)([\s\S]*?)<\/button>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        // Solo cuenta si el boton NO tiene texto visible (solo iconos): ahi title no basta para un lector de pantalla.
        const visibleText = m[2].replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').replace(/\s+/g, '');
        if (visibleText.length === 0 && !/aria-label=/.test(m[1])) offenders.push(`${path.relative(root, f)}: ${m[1].slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
