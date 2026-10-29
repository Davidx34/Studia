// Las plantillas de las fichas de lectura. Cada una recibe LOS MISMOS datos (FichaData) y los pinta a su manera; ninguna escribe ni cambia el contenido.
// Reglas comunes (las revisa fichas.test.ts): muestran TODOS los campos de la ficha, usan solo los colores semanticos del sistema (modo claro y oscuro),
// pasan el texto por MathText (formulas LaTeX), usan encabezados y listas reales para los lectores de pantalla, y no dependen de JavaScript propio.
//
// No lleva 'use client': se puede pintar en el servidor y en el navegador. (La plantilla clasica usa <details>, que funciona sin JavaScript.)

import { Card } from '@/components/ui/Card';
import { MathText } from '@/components/MathText';
import { FICHA_TEMPLATES, normalizeFichaTemplate, type FichaData, type FichaTemplateId } from '@/lib/study/fichaTemplates';
import { ThemedFichas } from './ThemedLayouts';

export interface FichasViewProps {
  fichas: FichaData[];
}

const puntosDe = (f: FichaData) => f.extra?.puntos_clave ?? [];
const terminosDe = (f: FichaData) => f.extra?.terminos ?? [];

// ── Clásica: lista desplegable (la que ya existia) ──
export function ClasicaFichas({ fichas }: FichasViewProps) {
  return (
    <ul className="space-y-3">
      {fichas.map((f, i) => (
        <li key={f.id}>
          <Card className="overflow-hidden">
            <details open={i === 0} className="group">
              <summary className="cursor-pointer list-none p-4 min-h-[44px] flex items-start justify-between gap-3">
                <span>
                  {f.section && <span className="block text-xs text-fg-muted mb-0.5">{f.section}</span>}
                  <span className="font-bold text-fg"><MathText content={f.front} /></span>
                </span>
                <span aria-hidden="true" className="text-fg-muted transition-transform group-open:rotate-90 motion-reduce:transition-none">›</span>
              </summary>
              <div className="px-4 pb-4 space-y-4 border-t border-line pt-4">
                <p className="text-fg"><MathText content={f.back} /></p>
                {puntosDe(f).length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-primary-text mb-1">Puntos clave</h3>
                    <ul className="list-disc pl-5 space-y-1 text-fg text-sm">
                      {puntosDe(f).map((p, k) => (
                        <li key={k}><MathText content={p} /></li>
                      ))}
                    </ul>
                  </div>
                )}
                {terminosDe(f).length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-primary-text mb-1">Términos</h3>
                    <dl className="space-y-1 text-sm">
                      {terminosDe(f).map((t, k) => (
                        <div key={k}>
                          <dt className="inline font-semibold text-fg"><MathText content={t.termino} />: </dt>
                          <dd className="inline text-fg-muted"><MathText content={t.definicion} /></dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
                {f.extra?.reflexion && (
                  <p className="text-sm bg-surface-2 border border-line rounded-xl p-3 text-fg">
                    <span className="font-semibold">Para pensar: </span>
                    <MathText content={f.extra.reflexion} />
                  </p>
                )}
              </div>
            </details>
          </Card>
        </li>
      ))}
    </ul>
  );
}

// ── Tarjeta visual: todo a la vista, con la idea destacada ──
export function TarjetaFichas({ fichas }: FichasViewProps) {
  return (
    <ul className="space-y-5">
      {fichas.map((f) => (
        <li key={f.id}>
          <article className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            <header className="border-b border-line bg-primary/10 px-5 py-4">
              {f.section && <p className="text-xs font-semibold uppercase tracking-wide text-primary-text">{f.section}</p>}
              <h3 className="mt-0.5 text-xl font-bold text-fg text-balance"><MathText content={f.front} /></h3>
            </header>
            <div className="space-y-5 p-5">
              <p className="rounded-xl border-l-4 border-primary bg-surface-2 p-4 text-base leading-relaxed text-fg">
                <MathText content={f.back} />
              </p>
              {puntosDe(f).length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-primary-text">Puntos clave</h4>
                  <ol className="grid gap-3 sm:grid-cols-2">
                    {puntosDe(f).map((p, k) => (
                      <li key={k} className="flex gap-3 rounded-xl border border-line p-3">
                        <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-on-primary">{k + 1}</span>
                        <span className="text-sm text-fg"><MathText content={p} /></span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {terminosDe(f).length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-primary-text">Vocabulario</h4>
                  <dl className="flex flex-wrap gap-2">
                    {terminosDe(f).map((t, k) => (
                      <div key={k} className="max-w-full rounded-xl border border-accent/30 bg-accent/10 px-3 py-2">
                        <dt className="text-sm font-bold text-accent-text"><MathText content={t.termino} /></dt>
                        <dd className="text-xs text-fg-muted"><MathText content={t.definicion} /></dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              {f.extra?.reflexion && (
                <p className="rounded-xl border border-accent/30 bg-accent/10 p-3 text-sm text-fg">
                  <span className="font-semibold">Para pensar: </span>
                  <MathText content={f.extra.reflexion} />
                </p>
              )}
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

// ── Cornell: pistas a la izquierda, notas a la derecha, resumen al pie ──
// Pistas = terminos y la pregunta para pensar; Notas = puntos clave; Resumen = la idea principal. En pantallas angostas las tres partes se apilan.
export function CornellFichas({ fichas }: FichasViewProps) {
  return (
    <ul className="space-y-5">
      {fichas.map((f) => {
        const hayPistas = terminosDe(f).length > 0 || !!f.extra?.reflexion;
        const hayNotas = puntosDe(f).length > 0;
        return (
          <li key={f.id}>
            <article className="overflow-hidden rounded-2xl border-2 border-line-strong bg-surface">
              <header className="border-b-2 border-line-strong px-5 py-3">
                {f.section && <p className="text-xs text-fg-muted">{f.section}</p>}
                <h3 className="text-lg font-bold text-fg text-balance"><MathText content={f.front} /></h3>
              </header>
              {(hayPistas || hayNotas) && (
                <div className={hayPistas && hayNotas ? 'grid md:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)]' : ''}>
                  {hayPistas && (
                    <aside className={`space-y-4 bg-surface-2 p-4 ${hayNotas ? 'border-b border-line-strong md:border-b-0 md:border-r-2' : ''}`}>
                      <h4 className="text-xs font-bold uppercase tracking-wide text-fg-muted">Pistas</h4>
                      {terminosDe(f).length > 0 && (
                        <dl className="space-y-2 text-sm">
                          {terminosDe(f).map((t, k) => (
                            <div key={k}>
                              <dt className="font-semibold text-fg"><MathText content={t.termino} /></dt>
                              <dd className="text-fg-muted"><MathText content={t.definicion} /></dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {f.extra?.reflexion && (
                        <p className="border-t border-line pt-3 text-sm text-fg">
                          <span className="font-semibold">Para pensar: </span>
                          <MathText content={f.extra.reflexion} />
                        </p>
                      )}
                    </aside>
                  )}
                  {hayNotas && (
                    <div className="p-4">
                      <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-fg-muted">Notas</h4>
                      <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg">
                        {puntosDe(f).map((p, k) => (
                          <li key={k}><MathText content={p} /></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              <footer className="border-t-2 border-line-strong bg-primary/10 p-4">
                <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-primary-text">Resumen</h4>
                <p className="text-sm text-fg"><MathText content={f.back} /></p>
              </footer>
            </article>
          </li>
        );
      })}
    </ul>
  );
}

// ── Compacta: bloque denso para repasar rápido o imprimir ──
export function CompactaFichas({ fichas }: FichasViewProps) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {fichas.map((f) => (
        <li key={f.id} className="p-4 print:break-inside-avoid">
          {f.section && <p className="text-xs text-fg-muted">{f.section}</p>}
          <h3 className="font-bold text-fg"><MathText content={f.front} /></h3>
          <p className="mt-1 text-sm text-fg"><MathText content={f.back} /></p>
          {puntosDe(f).length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-fg-muted">
              {puntosDe(f).map((p, k) => (
                <li key={k}><MathText content={p} /></li>
              ))}
            </ul>
          )}
          {terminosDe(f).length > 0 && (
            <p className="mt-2 text-xs text-fg-muted">
              <span className="font-semibold text-fg">Términos: </span>
              {terminosDe(f).map((t, k) => (
                <span key={k}>
                  {k > 0 && '; '}
                  <span className="font-medium text-fg"><MathText content={t.termino} /></span>
                  {' — '}
                  <MathText content={t.definicion} />
                </span>
              ))}
            </p>
          )}
          {f.extra?.reflexion && (
            <p className="mt-2 text-xs text-fg-muted">
              <span className="font-semibold text-fg">Para pensar: </span>
              <MathText content={f.extra.reflexion} />
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

// Las 4 funcionales (siguen los colores de la app). Las demas son estructura + tema (ThemedLayouts.tsx) y salen del catalogo.
const FUNCTIONAL_VIEWS: Partial<Record<FichaTemplateId, (p: FichasViewProps) => JSX.Element>> = {
  clasica: ClasicaFichas,
  tarjeta: TarjetaFichas,
  cornell: CornellFichas,
  compacta: CompactaFichas,
};

// Lo que usa la app: la lista de fichas pintada con la plantilla de la clase (o la de siempre si el id no se conoce).
export function FichaList({ fichas, template }: { fichas: FichaData[]; template?: string | null }) {
  if (fichas.length === 0) return <p className="text-fg-muted">Este material no produjo fichas de lectura.</p>;
  const id = normalizeFichaTemplate(template);
  const info = FICHA_TEMPLATES.find((t) => t.id === id)!;
  if (info.layout && info.theme) return <ThemedFichas fichas={fichas} layout={info.layout} themeId={info.theme} />;
  const View = FUNCTIONAL_VIEWS[id] ?? ClasicaFichas;
  return <View fichas={fichas} />;
}
