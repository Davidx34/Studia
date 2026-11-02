import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { CourseJourney } from './CourseJourney';
import { buildCourseView } from '@/lib/blueprint/studentView';
import type { Blueprint } from '@/lib/blueprint/types';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plan = (): Blueprint => ({
  version: 1,
  outcomes: [{ id: 'o1', statement: 'x' }],
  periods: [
    { id: 'p1', name: 'Primer corte', order: 1, weight: 40, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob1', title: 'Obj 1', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'Uno', order: 1 }, { id: 'm2', title: 'Dos', order: 2 }] }] },
    { id: 'p2', name: 'Segundo corte', order: 2, weight: 60, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob2', title: 'Obj 2', outcomeIds: ['o1'], modules: [{ id: 'm3', title: 'Tres', order: 1 }] }] },
  ],
});
const LINKS = [{ nodeId: 'm1', moduleId: id(1) }, { nodeId: 'm2', moduleId: id(2) }, { nodeId: 'm3', moduleId: id(3) }];
const render = (att: Record<string, number[]> = {}, links = LINKS, scoresAvailable = true) =>
  renderToStaticMarkup(h(CourseJourney, { view: buildCourseView({ plan: plan(), links, moduleAttempts: new Map(Object.entries(att)) }), className: 'Micro', version: 3, scoresAvailable }));

describe('CourseJourney', () => {
  it('estudiante nuevo: el primero "Te toca" con enlace a SU leccion; los demas bloqueados y SIN enlace', () => {
    const html = render();
    expect(html).toContain('Recorrido del curso');
    expect(html).toContain('plan versión 3');
    expect(html).toContain(`href="/lesson/${id(1)}"`);
    expect(html).not.toContain(`href="/lesson/${id(2)}"`);
    expect(html).not.toContain(`href="/lesson/${id(3)}"`);
    expect(html).toContain('Te toca');
    expect(html.match(/Bloqueado/g)).toHaveLength(2);
  });
  it('los estados llevan TEXTO (no solo color)', () => {
    const html = render({ [id(1)]: [100] }, [LINKS[0], LINKS[1]]);
    for (const label of ['Dominado', 'Te toca', 'Pendiente de contenido']) expect(html).toContain(label);
  });
  it('un modulo dominado se puede repasar; uno pendiente de contenido no tiene enlace', () => {
    const html = render({ [id(1)]: [100] }, [LINKS[0], LINKS[1]]);
    expect(html).toContain(`href="/lesson/${id(1)}"`);
    expect(html).toContain('Repasar');
    expect(html).toContain(`href="/lesson/${id(2)}"`); // el que le toca
    expect(html).not.toContain('href="/lesson/null"');
  });
  it('muestra intentos y nota (promedio) del modulo, y "—" cuando aun no hay nada', () => {
    const html = render({ [id(1)]: [80, 100] });
    expect(html).toContain('2 intentos');
    expect(html).toContain('nota 90 %');
    expect(render()).toContain('—');
    expect(render()).not.toContain('intentos ·');
  });
  it('1 intento va en singular', () => {
    expect(render({ [id(1)]: [60] })).toContain('1 intento ·');
  });
  it('la nota "hasta ahora" no es un cero cuando no hay nada, y explica que lo no hecho no cuenta', () => {
    const html = render();
    expect(html).toContain('Tu nota hasta ahora');
    expect(html).toContain('no cuenta como cero');
  });
  it('dice cuanto vale cada corte, la evaluacion del corte (30 %) y la final (medio corte), ', () => {
    const html = render();
    expect(html).toContain('Vale 40 % del curso');
    expect(html).toContain('Vale 60 % del curso');
    expect(html).toContain('vale 30 % del corte');
    expect(html).toContain('Evaluación final');
    expect(html).toContain('vale medio corte (25 % del curso)');
    expect(html).toContain('se desbloquea al terminar todos los cortes');
  });
  it('con los modulos dominados, la evaluacion del corte esta desbloqueada y lleva a su pantalla (si se conoce la clase)', () => {
    const html = render({ [id(1)]: [100], [id(2)]: [100] });
    expect(html).toContain('Desbloqueada');
    expect(html).not.toContain('no está disponible');
    expect(html).not.toContain('/course/exam/');
    const withClass = renderToStaticMarkup(h(CourseJourney, { view: buildCourseView({ plan: plan(), links: LINKS, moduleAttempts: new Map(Object.entries({ [id(1)]: [100], [id(2)]: [100] })) }), className: 'Micro', version: 1, scoresAvailable: true, classroomId: 'CLASE-1' }));
    expect(withClass).toContain('href="/my-classes/CLASE-1/course/exam/p1"');
    expect(withClass).toContain('Presentar la evaluación');
  });
  it('aclara que esta vista no bloquea nada: el mapa de modulos sigue como siempre', () => {
    expect(render()).toContain('puedes seguir usando el mapa de módulos de la clase como siempre');
  });
  it('sin poder leer los intentos: lo avisa', () => {
    expect(render({}, LINKS, false)).toContain('No pudimos leer tus intentos');
    expect(render()).not.toContain('No pudimos leer tus intentos');
  });
  it('el texto de lo siguiente va en una region de estado', () => {
    expect(render()).toMatch(/role="status"[^>]*>Sigue: «Uno»/);
  });
  it('un titulo hostil se muestra como TEXTO (React lo escapa)', () => {
    const p = plan();
    p.periods[0].objectives[0].modules[0].title = '<img src=x onerror=alert(1)>';
    const html = renderToStaticMarkup(h(CourseJourney, { view: buildCourseView({ plan: p, links: LINKS, moduleAttempts: new Map() }), className: 'x', version: 1, scoresAvailable: true }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('cableado de la vista del estudiante', () => {
  const root = process.cwd();
  const src = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
  const page = src('src/app/(student)/my-classes/[id]/course/page.tsx');
  const classPage = src('src/app/(student)/my-classes/[id]/page.tsx');
  it('la pagina exige sesion y matricula ANTES de leer nada del plan', () => {
    expect(page).toContain("if (!user) redirect('/login');");
    expect(page).toContain("if (!enrollment) redirect('/dashboard');");
    expect(page.indexOf("redirect('/dashboard')")).toBeLessThan(page.indexOf('loadCourseData('));
  });
  it('la llave de servicio solo se pasa al cargador (que filtra por el estudiante de la sesion)', () => {
    expect(page).toContain('studentId: user.id');
    expect(page.match(/createAdminSupabase\(\)/g)).toHaveLength(1);
    // la pagina solo lee con la SESION (matricula y nombre de la clase); intentos y plan los lee el cargador
    expect((page.match(/\.from\('([a-z_]+)'\)/g) ?? []).sort()).toEqual([".from('class_enrollments')", ".from('classrooms')"]);
    const code = page.replace(/\/\/[^\r\n]*/g, ' ');
    expect(code).not.toMatch(/admin\.from|lesson_attempts/);
  });
  it('la pagina de la clase ofrece el enlace SOLO si hay un plan publicado', () => {
    // la consulta del plan lleva el filtro de publicado (los laboratorios tambien filtran por publicado: se mira SU llamada)
    const call = classPage.slice(classPage.indexOf(".from('course_blueprints')"));
    expect(call.slice(0, call.indexOf(';'))).toContain(".eq('status', 'published')");
    expect(call.slice(0, call.indexOf(';'))).toContain(".eq('classroom_id', params.id)");
    expect(classPage).toContain('{hasPlan && (');
    expect(classPage).toContain('/my-classes/${params.id}/course');
  });
  it('no usa colores fijos (solo tokens)', () => {
    const FIXED = /(?<![\w-])(?:[a-z0-9-]+:)*(bg|text|border|ring|from|via|to|divide|placeholder)-(white|slate|gray|zinc|violet|purple|fuchsia|amber|yellow|orange|red|rose|emerald|green|teal|cyan|sky|blue|pink|indigo)(-\d{2,3})?(?![\w-])/;
    const comp = src('src/components/student/CourseJourney.tsx');
    expect(comp.split('\n').filter((l) => FIXED.test(l))).toEqual([]);
    expect(page.split('\n').filter((l) => FIXED.test(l))).toEqual([]);
  });
});
