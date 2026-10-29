// Infografias con tema. Reciben los MISMOS datos que la clasica (InfographicView) y los pintan con la paleta, tipografia, formas y fondo del tema, que llegan como variables
// --f-* (fichaThemes.ts + infographicThemes.css). Cada tipo tiene su estructura: linea de tiempo, comparativa (tabla real), proceso y cifras. Ninguna cambia el contenido.
//
// Reglas (las revisa infographics.test.ts): muestran todos los campos, usan tabla/lista/lista de definiciones reales, solo colores del tema (variables), sin scripts.

import { MathText } from '@/components/MathText';
import { getFichaTheme } from '@/lib/study/fichaThemes';
import { INFOGRAPHIC_LABEL, type Infographic } from '@/lib/study/infographics';
import { fontClass } from '@/components/study/fichas/fichaFonts';
import '@/components/study/fichas/fichaThemes.css';
import './infographicThemes.css';

type Of<T extends Infographic['tipo']> = Extract<Infographic, { tipo: T }>;

const tile = (i: number, of = 4) => `fk-tile-${(i % of) + 1}`;

function Timeline({ data }: { data: Of<'timeline'> }) {
  return (
    <ol className="fi-timeline">
      {data.eventos.map((e, i) => (
        <li key={i} className="fi-ev">
          <span aria-hidden="true" className="fi-node" />
          <div className="fk-card fi-ev-card">
            <span className={`fi-date ${tile(i, 3)}`}><MathText content={e.cuando} /></span>
            <p className="fi-ev-title"><MathText content={e.titulo} /></p>
            {e.detalle && <p className="fi-ev-detail"><MathText content={e.detalle} /></p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Comparison({ data, title }: { data: Of<'comparison'>; title: string }) {
  return (
    <div className="fi-table-wrap">
      <table className="fi-table">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr>
            <th scope="col" className="fi-corner">Criterio</th>
            {data.columnas.map((c, i) => (
              <th key={i} scope="col" className={`fi-c${(i % 3) + 1}`}><MathText content={c} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.filas.map((f, r) => (
            <tr key={r}>
              <th scope="row"><MathText content={f.criterio} /></th>
              {f.valores.map((v, i) => (
                <td key={i}><MathText content={v} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Process({ data }: { data: Of<'process'> }) {
  return (
    <ol className="fi-steps">
      {data.pasos.map((p, i) => (
        <li key={i} className="fk-card fi-step">
          <span aria-hidden="true" className="fi-step-num">{i + 1}</span>
          <div>
            <p className="fi-step-title"><span className="sr-only">Paso {i + 1}: </span><MathText content={p.titulo} /></p>
            {p.detalle && <p className="fi-step-detail"><MathText content={p.detalle} /></p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Stats({ data }: { data: Of<'stats'> }) {
  return (
    <dl className="fi-stats">
      {data.cifras.map((c, i) => (
        <div key={i} className={`fi-stat ${tile(i)}`}>
          <dt className="fi-stat-label"><MathText content={c.etiqueta} /></dt>
          <dd className="fi-big"><MathText content={c.valor} /></dd>
          {c.nota && <dd className="fi-stat-note"><MathText content={c.nota} /></dd>}
        </div>
      ))}
    </dl>
  );
}

export function ThemedInfographic({ title, section, data, themeId }: { title: string; section: string | null; data: Infographic; themeId: string }) {
  const theme = getFichaTheme(themeId);
  if (!theme) return null;
  const label = INFOGRAPHIC_LABEL[data.tipo] ?? 'Infografía';
  return (
    <figure className={`fk fi ${fontClass(theme.font)}`} style={theme.vars as React.CSSProperties} data-ficha-theme={themeId} data-infographic-type={data.tipo}>
      <figcaption className="fi-head">
        <div className="fi-kind">
          <span className="fk-chip">{label}</span>
          {section && <span className="fk-label">{section}</span>}
        </div>
        <h3 className="fi-title"><MathText content={title} /></h3>
      </figcaption>
      {data.tipo === 'timeline' && <Timeline data={data} />}
      {data.tipo === 'comparison' && <Comparison data={data} title={title} />}
      {data.tipo === 'process' && <Process data={data} />}
      {data.tipo === 'stats' && <Stats data={data} />}
    </figure>
  );
}
