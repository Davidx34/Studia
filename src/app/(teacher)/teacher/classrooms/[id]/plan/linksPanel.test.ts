import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import PlanClient from './PlanClient';
import LinksPanel from './LinksPanel';
import type { Blueprint } from '@/lib/blueprint/types';

// La pantalla se verifico a mano en un navegador (aplicar sugerencias, mover un modulo, guardar, editar el plan y volver, publicar; escritorio y movil). Aqui quedan fijados sus ESTADOS
// INICIALES (sin jsdom no se simulan clics) y su cableado.
const dir = 'src/app/(teacher)/teacher/classrooms/[id]/plan';
const src = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MODS = [
  { id: u(1), title: 'Elasticidad: concepto' },
  { id: u(2), title: 'Oferta y Demanda' },
];
const plan2 = (): Blueprint => ({
  version: 1,
  outcomes: [{ id: 'o1', statement: 'x' }],
  periods: [
    { id: 'p1', name: 'Primer corte', order: 1, weight: 50, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob1', title: 'Elasticidad', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'Concepto de elasticidad', order: 1 }] }] },
    { id: 'p2', name: 'Segundo corte', order: 2, weight: 50, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob2', title: 'Equilibrio', outcomeIds: ['o1'], modules: [{ id: 'm2', title: 'Oferta y demanda', order: 1 }] }] },
  ],
});
const panel = (over: Partial<Parameters<typeof LinksPanel>[0]> = {}) =>
  renderToStaticMarkup(h(LinksPanel, { classroomId: 'c1', plan: plan2(), modules: MODS, initialLinks: [], target: 'draft', onSaved: () => {}, ...over }));
const stored = (doc: unknown, version = 3) => ({ version, doc, publishedAt: null });
const full = (props: Partial<Parameters<typeof PlanClient>[0]> = {}) =>
  renderToStaticMarkup(h(PlanClient, { classroomId: 'c1', className: 'Micro', draft: null, published: null, tableMissing: false, modules: [], draftLinks: [], publishedLinks: [], ...props }));

describe('LinksPanel: estados iniciales', () => {
  it('lista cada modulo del plan agrupado por corte y objetivo, con un selector etiquetado', () => {
    const html = panel();
    expect(html).toContain('Primer corte');
    expect(html).toContain('Segundo corte');
    expect(html).toMatch(/<label[^>]*for="ln-m1"[^>]*>Concepto de elasticidad<\/label>/);
    expect(html).toMatch(/<label[^>]*for="ln-m2"[^>]*>Oferta y demanda<\/label>/);
    expect(html).toContain('id="ln-m1"');
    expect(html).toContain('Sin enlazar (pendiente de contenido)');
  });
  it('sin enlaces: 0 de 2, y ofrece las sugerencias (una por modulo que se parece)', () => {
    const html = panel();
    expect(html).toContain('0 de 2 modulos del plan tienen contenido enlazado');
    expect(html).toContain('Aplicar 2 sugerencias');
  });
  it('con enlaces guardados: los muestra elegidos y cuenta lo enlazado', () => {
    const html = panel({ initialLinks: [{ nodeId: 'm1', moduleId: u(1) }] });
    expect(html).toContain('1 de 2 modulos del plan tienen contenido enlazado');
    expect(html).toMatch(new RegExp(`<option value="${u(1)}" selected`));
    expect(html).toContain('Aplicar 1 sugerencia');
    expect(html).not.toContain('Aplicar 1 sugerencias');
  });
  it('un enlace a un nodo que el plan ya no tiene se ignora (no cuenta)', () => {
    expect(panel({ initialLinks: [{ nodeId: 'viejo', moduleId: u(1) }] })).toContain('0 de 2 modulos');
  });
  it('un modulo real usado por OTRO modulo del plan se marca como que pasaria a este', () => {
    const html = panel({ initialLinks: [{ nodeId: 'm2', moduleId: u(2) }] });
    expect(html).toContain('pasaria a este');
    expect(html).toContain('ya enlazado a «Oferta y demanda»');
  });
  it('sin modulos en la clase: lo explica y no muestra selectores ni guardar', () => {
    const html = panel({ modules: [] });
    expect(html).toContain('todavia no tiene modulos');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('Guardar enlaces');
  });
  it('dice sobre que version del plan se enlaza', () => {
    expect(panel({ target: 'draft' })).toContain('(borrador)');
    expect(panel({ target: 'published' })).toContain('(publicada)');
  });
  it('aclara que NO crea ni cambia modulos y que no se copia entre versiones', () => {
    const html = panel();
    expect(html).toContain('No crea ni cambia modulos');
    expect(html).toContain('hay que enlazar de nuevo');
  });
  it('sin cambios, no hay nada que guardar', () => {
    expect(panel()).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Enlaces guardados/);
  });
});

describe('PlanClient + LinksPanel: integracion', () => {
  const DOC = () => ({ ...plan2(), version: 3 });
  it('plan guardado y sin cambios: muestra el panel con los enlaces de ESE borrador', () => {
    const html = full({ draft: stored(DOC()), modules: MODS, draftLinks: [{ nodeId: 'm1', moduleId: u(1) }] });
    expect(html).toContain('Enlazar con los modulos de la clase');
    expect(html).toContain('(borrador)');
    expect(html).toContain('1 de 2 modulos');
  });
  it('solo hay un plan publicado: el panel enlaza el PUBLICADO', () => {
    const html = full({ published: stored(DOC(), 2), modules: MODS, publishedLinks: [{ nodeId: 'm2', moduleId: u(2) }] });
    expect(html).toContain('Enlazar con los modulos de la clase');
    expect(html).toContain('(publicada)');
    expect(html).toContain('1 de 2 modulos');
  });
  it('sin ningun plan: no hay panel de enlaces', () => {
    expect(full({ modules: MODS })).not.toContain('Enlazar con los modulos');
  });
  it('los enlaces del borrador no se mezclan con los del publicado', () => {
    const html = full({ draft: stored(DOC(), 4), published: stored(DOC(), 3), modules: MODS, draftLinks: [], publishedLinks: [{ nodeId: 'm1', moduleId: u(1) }, { nodeId: 'm2', moduleId: u(2) }] });
    expect(html).toContain('0 de 2 modulos'); // se enlaza el borrador, que no tiene enlaces
    expect(html).not.toContain('2 de 2 modulos');
  });
});

describe('enlaces: cableado', () => {
  const client = src(`${dir}/PlanClient.tsx`);
  const panelSrc = src(`${dir}/LinksPanel.tsx`);
  const page = src(`${dir}/page.tsx`);
  it('el panel guarda solo por la accion saveLinks y con lo que el profesor ve en pantalla', () => {
    expect(panelSrc).toContain("call({ action: 'saveLinks', classroomId, links })");
  });
  it('aplicar sugerencias NO guarda: solo cambia la lista y marca cambios pendientes', () => {
    const body = /const applyAll = \(\) => \{([\s\S]*?)\n {2}\};/.exec(panelSrc.replace(/\r\n/g, '\n'))![1];
    expect(body).not.toContain('call(');
    expect(body).toContain('setDirty(true)');
    expect(body).toContain('applySuggestions(');
  });
  it('elegir un modulo usa setLink (nunca deja un modulo real repetido) y marca cambios', () => {
    const body = /const change = \(nodeId: string, moduleId: string\) => \{([\s\S]*?)\n {2}\};/.exec(panelSrc.replace(/\r\n/g, '\n'))![1];
    expect(body).toContain('setLink(l, nodeId, moduleId || null)');
    expect(body).toContain('setDirty(true)');
  });
  it('al guardar con exito se avisa al padre (los enlaces no se pierden al editar el plan) y se limpia lo pendiente', () => {
    expect(panelSrc.replace(/\r\n/g, '\n')).toMatch(/setDirty\(false\);\s*onSaved\(links\);/);
  });
  it('al publicar, los enlaces del borrador pasan al publicado (misma fila) y "editar una copia" parte sin enlaces', () => {
    expect(client).toContain('setPublishedLinks(draftLinks);');
    expect(client).toContain('setDraftLinks([]);');
  });
  it('el panel del borrador solo aparece con el plan GUARDADO y sin cambios (los enlaces se validan contra lo guardado)', () => {
    expect(client).toContain('dirty || savedVersion === null ? (');
    expect(client).toContain('target="draft"');
    expect(client).toContain('target="published"');
    expect(client).toContain('key={`draft-${savedVersion}`}');
  });
  it('el panel parte SOLO de enlaces de nodos que el plan tiene (uno obsoleto haria rechazar todo el guardado)', () => {
    expect(panelSrc).toContain('useState<Link[]>(() => relevantLinks(plan, initialLinks))');
  });
  it('el panel del borrador actualiza SUS enlaces al guardar; el del publicado, los suyos', () => {
    expect(client).toContain('onSaved={setDraftLinks}');
    expect(client).toContain('onSaved={setPublishedLinks}');
    expect(client).toContain('initialLinks={draftLinks}');
    expect(client).toContain('initialLinks={publishedLinks}');
  });
  it('"editar una copia" empieza SIN enlaces (el borrador nuevo todavia no existe)', () => {
    const start = client.indexOf('const startFromPublished = () => {');
    expect(start).toBeGreaterThan(-1);
    const body = client.slice(start, client.indexOf('};', start));
    expect(body).toContain('setDraftLinks([]);');
  });
  it('la pagina reparte los enlaces por plan (borrador / publicado) y trae solo modulos de ESTA clase', () => {
    expect(page).toContain('.filter((l) => l.blueprint_id === bp.id)');
    expect(page).toContain(".from('content_modules').select('id, title').eq('classroom_id', params.id)");
  });
  it('la pagina lee modulos y enlaces con la sesion del profesor (RLS), sin llave de servicio', () => {
    expect(page).toContain(".from('content_modules')");
    expect(page).toContain(".from('blueprint_module_links')");
    expect(page).toContain(".eq('classroom_id', params.id)");
    expect(page).not.toMatch(/createAdminSupabase|SERVICE_ROLE/);
  });
});
