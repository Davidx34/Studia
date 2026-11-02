import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import PlanClient from './PlanClient';
import type { Blueprint } from '@/lib/blueprint/types';

// La pantalla se probo a mano en un navegador (flujo generar -> editar -> guardar -> publicar, en escritorio y en movil). Aqui quedan fijados sus ESTADOS INICIALES (sin jsdom no se
// simulan clics) y su cableado: nunca escribe en la base desde el navegador, solo habla con /api/blueprint.
const root = process.cwd();
const src = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const valid = (): Blueprint => ({
  version: 3,
  outcomes: [{ id: 'o1', statement: 'Explica la elasticidad de la demanda' }],
  periods: [{ id: 'p1', name: 'Primer corte', order: 1, weight: 100, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob1', title: 'Entender la elasticidad', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'Concepto', order: 1 }] }] }],
});

const render = (props: Partial<Parameters<typeof PlanClient>[0]> = {}) =>
  renderToStaticMarkup(h(PlanClient, { classroomId: 'c1', className: 'Microeconomia', draft: null, published: null, tableMissing: false, modules: [], draftLinks: [], publishedLinks: [], ...props }));
const stored = (doc: unknown, version = 3) => ({ version, doc, publishedAt: null });

describe('PlanClient: estados iniciales', () => {
  it('sin plan: formulario del borrador, nombre de la clase por defecto y la advertencia de que aun no cambia lo que ven los estudiantes', () => {
    const html = render();
    expect(html).toContain('Desarrollar con IA');
    expect(html).toContain('Empezar en blanco');
    expect(html).toContain('value="Microeconomia"');
    expect(html).toContain('no cambia lo que ven tus estudiantes');
    expect(html).toContain('Todavia no hay un plan publicado.');
    expect(html).not.toContain('Guardar borrador');
  });
  it('la IA no decide cortes ni pesos y el formulario lo dice', () => {
    expect(render()).toContain('La IA no decide cuantos cortes hay ni cuanto pesa cada uno');
  });
  it('sin la migracion 085: lo explica y no muestra el formulario', () => {
    const html = render({ tableMissing: true });
    expect(html).toContain('migracion 085');
    expect(html).not.toContain('Desarrollar con IA');
  });
  it('con un borrador guardado: lo muestra editable, ya guardado, y Publicar disponible si cumple las reglas', () => {
    const html = render({ draft: stored(valid()) });
    expect(html).toContain('Explica la elasticidad de la demanda');
    expect(html).toContain('Borrador guardado: version 3.');
    expect(html).toContain('>Guardado<');
    expect(html).toContain('El plan cumple todas las reglas.');
    expect(html).not.toContain('Desarrollar con IA');
    const publicar = /<button[^>]*>Publicar<\/button>/.exec(html)![0];
    expect(publicar).not.toContain(' disabled=""');
  });
  it('un borrador guardado con reglas incumplidas NO se puede publicar y dice que falta', () => {
    const bad = valid();
    bad.periods[0].objectives[0].modules = [];
    const html = render({ draft: stored(bad) });
    expect(html).toContain('no tiene módulos');
    expect(html).toContain('Falta arreglar (1)');
    expect(/<button[^>]*>Publicar<\/button>/.exec(html)![0]).toContain(' disabled=""');
  });
  it('solo hay un plan publicado: lo informa y ofrece editar una COPIA (no el publicado)', () => {
    const html = render({ published: stored(valid(), 2) });
    expect(html).toContain('Plan publicado: version 2.');
    expect(html).toContain('Editar una copia');
  });
  it('borrador guardado ilegible: avisa en vez de romperse y deja empezar de nuevo', () => {
    const html = render({ draft: stored({ basura: true }) });
    expect(html).toContain('role="alert"');
    expect(html).toContain('no se pudo leer');
    expect(html).toContain('Desarrollar con IA');
  });
  it('las etiquetas de los campos repetidos son unicas (llevan el corte)', () => {
    const two = valid();
    two.periods.push({ ...valid().periods[0], id: 'p2', name: 'Segundo', order: 2, objectives: [{ id: 'ob2', title: 'Otro', outcomeIds: ['o1'], modules: [{ id: 'm2', title: 'Mod', order: 1 }] }] });
    const html = render({ draft: stored(two) });
    const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain('Modulo 1 del objetivo 1 del corte 1');
    expect(labels).toContain('Modulo 1 del objetivo 1 del corte 2');
  });
});

describe('PlanClient: cableado', () => {
  const client = src('src/app/(teacher)/teacher/classrooms/[id]/plan/PlanClient.tsx');
  const page = src('src/app/(teacher)/teacher/classrooms/[id]/plan/page.tsx');

  it('el navegador nunca escribe la base: todo el cliente (pantalla, panel de enlaces y llamada) solo habla con /api/blueprint', () => {
    const dir = 'src/app/(teacher)/teacher/classrooms/[id]/plan';
    const api = src(`${dir}/planApi.ts`);
    const panel = src(`${dir}/LinksPanel.tsx`);
    expect(api).toContain("fetch('/api/blueprint'");
    for (const code of [client, panel, api]) {
      expect(code).not.toMatch(/supabase/i);
      expect(code).not.toMatch(/\.from\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    }
    // la unica llamada de red del cliente esta en planApi.ts
    expect(client + panel).not.toMatch(/fetch\(/);
    expect(client + panel).toContain("from './planApi'");
  });
  it('guardar y publicar piden confirmacion donde duele: publicar tiene un segundo paso y no se habilita con cambios sin guardar', () => {
    expect(client).toContain('confirmPublish');
    expect(client).toContain('disabled={busy !== null || dirty || savedVersion === null || !publishable}');
    expect(client).toContain('disabled={busy !== null || !dirty || blanks.length > 0}');
  });
  it('editar cierra la confirmacion de publicar (no se confirma una version distinta de la revisada)', () => {
    const body = /const edit = \(f: \(b: Blueprint\) => Blueprint\) => \{([\s\S]*?)\s\};\s/.exec(client)![1];
    expect(body).toContain('setConfirmPublish(false);');
    expect(body).toContain('setDirty(true);');
  });
  it('publicar tiene SEGUNDO paso: el primer clic solo pide confirmar, y solo el segundo publica', () => {
    expect(client).toContain('onClick={() => setConfirmPublish(true)}');
    expect(client).toMatch(/loading=\{busy === 'publish'\} disabled=\{busy !== null\} onClick=\{publish\}/);
    expect(client.match(/onClick=\{publish\}/g)).toHaveLength(1);
  });
  it('un texto vacio bloquea publicar y guardar (el servidor lo rechazaria)', () => {
    expect(client).toContain('const publishable = plan !== null && isPublishable(issues) && blanks.length === 0;');
    expect(client).toContain('blankFields(plan)');
  });
  it('guardar con exito deja el borrador como guardado y sin cambios pendientes', () => {
    expect(client).toMatch(/setSavedVersion\(r\.data\.version\);\s*setDirty\(false\);/);
  });
  it('tras publicar, "editar una copia" parte del plan publicado nuevo', () => {
    expect(client).toContain('setPublished({ version: r.data.version, doc: plan,');
  });
  it('la pagina lee con la sesion del profesor (RLS) y comprueba que la clase es SUYA; no usa la llave de servicio', () => {
    expect(page).toContain("createServerSupabase");
    expect(page).toContain(".eq('teacher_id', user.id)");
    expect(page).toContain("redirect('/teacher/classrooms')");
    expect(page).not.toMatch(/createAdminSupabase|SERVICE_ROLE/);
  });
  it('la pestana "Plan del curso" esta en la navegacion de la clase', () => {
    const tabs = src('src/app/(teacher)/teacher/classrooms/[id]/ClassroomTabs.tsx');
    expect(tabs).toContain("label: 'Plan del curso'");
    expect(tabs).toContain('${base}/plan');
  });
});
