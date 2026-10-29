// Estructuras (layouts) de las plantillas con tema. Cada una recibe los MISMOS datos (FichaData) y los acomoda a su manera; los colores, tipografias, formas y el fondo
// salen de las variables --f-* del tema (ver fichaThemes.ts y fichaThemes.css), asi un layout sirve para muchos estilos. Ningun layout escribe ni cambia el contenido.
//
// Reglas (las revisa fichas.test.ts): muestran TODOS los campos y todas las fichas; usan encabezados y listas reales; los iconos son decorativos (aria-hidden) y vienen de
// una sola familia (lucide); no llevan scripts ni manejadores de eventos.

import { Check, ChevronRight, Flag, HelpCircle, Quote } from 'lucide-react';
import { MathText } from '@/components/MathText';
import { getFichaTheme } from '@/lib/study/fichaThemes';
import type { FichaData, FichaLayout } from '@/lib/study/fichaTemplates';
import { fontClass } from './fichaFonts';
import './fichaThemes.css';


const puntosDe = (f: FichaData) => f.extra?.puntos_clave ?? [];
const terminosDe = (f: FichaData) => f.extra?.terminos ?? [];

// Primera letra o numero del termino (sin las marcas de formula $), para la inicial grande del mosaico.
export function initialOf(text: string): string {
  const m = text.replace(/\$/g, '').match(/[A-Za-zÀ-ÿ0-9]/); // letras latinas con tilde y numeros
  return m ? m[0].toUpperCase() : '•';
}


function Think({ text }: { text: string }) {
  return (
    <p className="fk-think">
      <HelpCircle aria-hidden="true" className="fk-icon" />
      <span>
        <span className="fk-label fk-label-accent">Para pensar · </span>
        <MathText content={text} />
      </span>
    </p>
  );
}

function Terms({ f, tiles = false }: { f: FichaData; tiles?: boolean }) {
  const ts = terminosDe(f);
  if (ts.length === 0) return null;
  return (
    <div>
      <h4 className="fk-label fk-sub">Vocabulario</h4>
      <dl className="fk-terms">
        {ts.map((t, k) => (
          <div key={k} className={`fk-term ${tiles ? `fk-tile-${(k % 4) + 1}` : 'fk-card'}`}>
            <dt><MathText content={t.termino} /></dt>
            <dd><MathText content={t.definicion} /></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── Tarjeta ──
function TarjetaTema({ fichas }: { fichas: FichaData[] }) {
  return (
    <ul className="fk-list">
      {fichas.map((f) => (
        <li key={f.id}>
          <article className="fk-card fk-tj">
            <header className="fk-tj-head">
              {f.section && <p className="fk-label">{f.section}</p>}
              <h3 className="fk-title"><MathText content={f.front} /></h3>
            </header>
            <div className="fk-tj-body">
              <p className="fk-callout"><MathText content={f.back} /></p>
              {puntosDe(f).length > 0 && (
                <div>
                  <h4 className="fk-label fk-sub">Puntos clave</h4>
                  <ol className="fk-grid-2">
                    {puntosDe(f).map((p, k) => (
                      <li key={k} className="fk-point">
                        <span aria-hidden="true" className="fk-num">{k + 1}</span>
                        <span className="fk-small"><MathText content={p} /></span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <Terms f={f} tiles />
              {f.extra?.reflexion && <Think text={f.extra.reflexion} />}
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

// ── Mosaico (bento) ──
function MosaicoTema({ fichas }: { fichas: FichaData[] }) {
  return (
    <ul className="fk-list">
      {fichas.map((f) => (
        <li key={f.id}>
          <article className="fk-mo">
            <header className="fk-wide fk-mo-hero fk-tile-1 fk-mo-tile">
              {f.section && <p className="fk-label">{f.section}</p>}
              <h3><MathText content={f.front} /></h3>
            </header>
            <p className="fk-wide fk-card fk-mo-tile fk-body"><MathText content={f.back} /></p>
            {puntosDe(f).map((p, k) => (
              <div key={k} className={`fk-mo-tile fk-tile-${((k + 1) % 4) + 1}`}>
                <p className="fk-label">Punto {k + 1}</p>
                <p className="fk-small"><MathText content={p} /></p>
              </div>
            ))}
            {terminosDe(f).length > 0 && (
              <div className="fk-wide">
                <h4 className="fk-label fk-sub">Vocabulario</h4>
                <dl className="fk-mo" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 13rem), 1fr))' }}>
                  {terminosDe(f).map((t, k) => (
                    <div key={k} className={`fk-mo-tile fk-tile-${((k + 2) % 4) + 1}`} style={{ gridColumn: 'auto' }}>
                      <span aria-hidden="true" className="fk-initial">{initialOf(t.termino)}</span>
                      <dt className="fk-small" style={{ fontWeight: 700 }}><MathText content={t.termino} /></dt>
                      <dd className="fk-small"><MathText content={t.definicion} /></dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {f.extra?.reflexion && (
              <div className="fk-wide">
                <Think text={f.extra.reflexion} />
              </div>
            )}
          </article>
        </li>
      ))}
    </ul>
  );
}

// ── Ruta: un camino con paradas (idea -> puntos -> meta) ──
function RutaTema({ fichas }: { fichas: FichaData[] }) {
  return (
    <ul className="fk-list">
      {fichas.map((f) => (
        <li key={f.id}>
          <article className="fk-ruta">
            <header className="fk-card fk-stop">
              <span aria-hidden="true" className="fk-num"><Flag className="fk-icon" /></span>
              {f.section && <p className="fk-label">{f.section}</p>}
              <h3 className="fk-title"><MathText content={f.front} /></h3>
              <p className="fk-body" style={{ marginTop: '0.4rem' }}><MathText content={f.back} /></p>
            </header>
            {puntosDe(f).map((p, k) => (
              <div key={k} className="fk-card fk-stop">
                <span aria-hidden="true" className="fk-num">{k + 1}</span>
                <p className="fk-small"><MathText content={p} /></p>
              </div>
            ))}
            {terminosDe(f).length > 0 && (
              <div className="fk-card fk-stop">
                <span aria-hidden="true" className="fk-num"><Check className="fk-icon" /></span>
                <Terms f={f} tiles />
              </div>
            )}
            {f.extra?.reflexion && (
              <div className="fk-card fk-stop fk-stop-end">
                <span aria-hidden="true" className="fk-num"><HelpCircle className="fk-icon" /></span>
                <Think text={f.extra.reflexion} />
              </div>
            )}
          </article>
        </li>
      ))}
    </ul>
  );
}

// ── Cuaderno: hoja con renglones, margen, marcador y notas adhesivas ──
function CuadernoTema({ fichas }: { fichas: FichaData[] }) {
  return (
    <ul className="fk-list">
      {fichas.map((f) => (
        <li key={f.id}>
          <article className="fk-cuad">
            {f.section && <p className="fk-label">{f.section}</p>}
            <h3 className="fk-title"><span className="fk-mark"><MathText content={f.front} /></span></h3>
            <p className="fk-body"><MathText content={f.back} /></p>
            {puntosDe(f).length > 0 && (
              <ul className="fk-bullets">
                {puntosDe(f).map((p, k) => (
                  <li key={k}>
                    <Check aria-hidden="true" className="fk-icon" />
                    <MathText content={p} />
                  </li>
                ))}
              </ul>
            )}
            {terminosDe(f).length > 0 && (
              <dl className="fk-stickies">
                {terminosDe(f).map((t, k) => (
                  <div key={k} className="fk-sticky">
                    <dt><MathText content={t.termino} /></dt>
                    <dd><MathText content={t.definicion} /></dd>
                  </div>
                ))}
              </dl>
            )}
            {f.extra?.reflexion && (
              <p className="fk-body">
                <span className="fk-mark" style={{ fontWeight: 700 }}>Tarea: </span> <MathText content={f.extra.reflexion} />
              </p>
            )}
          </article>
        </li>
      ))}
    </ul>
  );
}

// ── Revista: titular grande, capitular, dos columnas, glosario y cita ──
function RevistaTema({ fichas }: { fichas: FichaData[] }) {
  return (
    <ul className="fk-list">
      {fichas.map((f) => (
        <li key={f.id}>
          <article className="fk-rev">
            {f.section && <p className="fk-label fk-label-accent">{f.section}</p>}
            <h3 className="fk-rev-title"><MathText content={f.front} /></h3>
            <hr className="fk-rule" />
            <p className="fk-lead"><MathText content={f.back} /></p>
            {puntosDe(f).length > 0 && (
              <>
                <hr className="fk-rule" />
                <ol className="fk-cols">
                  {puntosDe(f).map((p, k) => (
                    <li key={k}>
                      <span aria-hidden="true" className="fk-n">{String(k + 1).padStart(2, '0')}</span>
                      <span className="fk-small"><MathText content={p} /></span>
                    </li>
                  ))}
                </ol>
              </>
            )}
            {terminosDe(f).length > 0 && (
              <>
                <hr className="fk-rule" />
                <h4 className="fk-label fk-sub">Glosario</h4>
                <dl className="fk-gloss">
                  {terminosDe(f).map((t, k) => (
                    <div key={k}>
                      <dt><MathText content={t.termino} /></dt>
                      <dd><MathText content={t.definicion} /></dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            {f.extra?.reflexion && (
              <p className="fk-pull" style={{ marginTop: '1.25rem' }}>
                <Quote aria-hidden="true" className="fk-icon" />
                <MathText content={f.extra.reflexion} />
              </p>
            )}
          </article>
        </li>
      ))}
    </ul>
  );
}

// ── Cornell con tema: ficha tecnica con pistas, notas y resumen ──
function CornellTema({ fichas }: { fichas: FichaData[] }) {
  return (
    <ul className="fk-list">
      {fichas.map((f) => {
        const hayPistas = terminosDe(f).length > 0 || !!f.extra?.reflexion;
        const hayNotas = puntosDe(f).length > 0;
        return (
          <li key={f.id}>
            <article className="fk-card fk-cor">
              <header className="fk-cor-head">
                <h3 className="fk-title"><MathText content={f.front} /></h3>
                {f.section && <p className="fk-label fk-label-accent">{f.section}</p>}
              </header>
              {(hayPistas || hayNotas) && (
                <div className={hayPistas && hayNotas ? 'fk-cor-grid' : ''}>
                  {hayPistas && (
                    <aside className="fk-cor-cues" style={hayNotas ? undefined : { borderRight: 0 }}>
                      <h4 className="fk-label">Pistas</h4>
                      {terminosDe(f).length > 0 && (
                        <dl style={{ display: 'grid', gap: '0.6rem' }}>
                          {terminosDe(f).map((t, k) => (
                            <div key={k}>
                              <dt style={{ fontWeight: 700 }}><MathText content={t.termino} /></dt>
                              <dd className="fk-small fk-muted"><MathText content={t.definicion} /></dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {f.extra?.reflexion && <Think text={f.extra.reflexion} />}
                    </aside>
                  )}
                  {hayNotas && (
                    <div className="fk-cor-notes">
                      <h4 className="fk-label fk-sub">Notas</h4>
                      <ul className="fk-bullets" style={{ display: 'grid', gap: '0.5rem' }}>
                        {puntosDe(f).map((p, k) => (
                          <li key={k} className="fk-small">
                            <Check aria-hidden="true" className="fk-icon" style={{ top: '0.3rem' }} />
                            <MathText content={p} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              <footer className="fk-cor-sum">
                <h4 className="fk-label fk-sub" style={{ color: 'var(--f-accent-text)' }}>Resumen</h4>
                <p className="fk-small"><MathText content={f.back} /></p>
              </footer>
            </article>
          </li>
        );
      })}
    </ul>
  );
}

// ── Acordeon con tema ──
function AcordeonTema({ fichas }: { fichas: FichaData[] }) {
  return (
    <ul className="fk-list">
      {fichas.map((f, i) => (
        <li key={f.id}>
          <details open={i === 0} className="fk-card fk-acc">
            <summary>
              <span>
                {f.section && <span className="fk-label" style={{ display: 'block' }}>{f.section}</span>}
                <h3 className="fk-title"><MathText content={f.front} /></h3>
              </span>
              <span aria-hidden="true" className="fk-chev"><ChevronRight className="fk-icon" /></span>
            </summary>
            <div className="fk-acc-body">
              <p className="fk-callout"><MathText content={f.back} /></p>
              {puntosDe(f).length > 0 && (
                <div>
                  <h4 className="fk-label fk-sub">Puntos clave</h4>
                  <ol className="fk-grid-2">
                    {puntosDe(f).map((p, k) => (
                      <li key={k} className="fk-point">
                        <span aria-hidden="true" className="fk-num">{k + 1}</span>
                        <span className="fk-small"><MathText content={p} /></span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <Terms f={f} tiles />
              {f.extra?.reflexion && <Think text={f.extra.reflexion} />}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

const LAYOUTS: Record<FichaLayout, (p: { fichas: FichaData[] }) => JSX.Element> = {
  tarjeta: TarjetaTema,
  mosaico: MosaicoTema,
  ruta: RutaTema,
  cuaderno: CuadernoTema,
  revista: RevistaTema,
  cornell: CornellTema,
  acordeon: AcordeonTema,
};

// Un layout + un tema = una plantilla. Los colores y la tipografia llegan como variables CSS en el contenedor.
export function ThemedFichas({ fichas, layout, themeId }: { fichas: FichaData[]; layout: FichaLayout; themeId: string }) {
  const theme = getFichaTheme(themeId);
  const Layout = LAYOUTS[layout];
  if (!theme || !Layout) return null;
  return (
    <div className={`fk ${fontClass(theme.font)}`} style={theme.vars as React.CSSProperties} data-ficha-theme={themeId} data-ficha-layout={layout}>
      <Layout fichas={fichas} />
    </div>
  );
}

