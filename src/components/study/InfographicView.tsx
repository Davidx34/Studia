// Dibuja una infografia a partir de sus DATOS (paso 5). Solo HTML + CSS con los tokens del sistema de diseño:
// funciona en tema claro y oscuro, se lee con lector de pantalla (listas, tabla y lista de definiciones reales),
// no pesa en Storage y no necesita JavaScript propio.

import { Card, Badge } from '@/components/ui/Card';
import { MathText } from '@/components/MathText';
import { INFOGRAPHIC_LABEL, type Infographic } from '@/lib/study/infographics';

export function InfographicView({ title, section, data }: { title: string; section: string | null; data: Infographic }) {
  const label = INFOGRAPHIC_LABEL[data.tipo] ?? 'Infografía';
  return (
    <Card className="p-5 sm:p-6">
      <figure>
        <figcaption className="mb-5 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="primary">{label}</Badge>
            {section && <span className="text-xs text-fg-muted">{section}</span>}
          </div>
          <h3 className="text-lg font-bold text-fg text-balance">
            <MathText content={title} />
          </h3>
        </figcaption>
        {data.tipo === 'timeline' && <Timeline data={data} />}
        {data.tipo === 'comparison' && <Comparison data={data} title={title} />}
        {data.tipo === 'process' && <Process data={data} />}
        {data.tipo === 'stats' && <Stats data={data} />}
      </figure>
    </Card>
  );
}

function Timeline({ data }: { data: Extract<Infographic, { tipo: 'timeline' }> }) {
  return (
    <ol className="relative border-l-2 border-line-strong ml-3 space-y-6">
      {data.eventos.map((e, i) => (
        <li key={i} className="pl-6 relative">
          <span aria-hidden="true" className="absolute -left-[9px] top-1 h-4 w-4 rounded-full bg-primary ring-4 ring-surface" />
          <span className="inline-block rounded-md bg-accent/15 text-accent-text border border-accent/30 px-2 py-0.5 text-xs font-bold">{e.cuando}</span>
          <p className="mt-1 font-semibold text-fg"><MathText content={e.titulo} /></p>
          {e.detalle && <p className="text-sm text-fg-muted"><MathText content={e.detalle} /></p>}
        </li>
      ))}
    </ol>
  );
}

function Comparison({ data, title }: { data: Extract<Infographic, { tipo: 'comparison' }>; title: string }) {
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full min-w-[420px] border-separate border-spacing-0 text-sm">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr>
            <th scope="col" className="p-3 text-left text-xs text-fg-muted font-semibold border-b-2 border-line-strong">Criterio</th>
            {data.columnas.map((c, i) => (
              <th key={i} scope="col" className="p-3 text-left font-bold text-primary-text border-b-2 border-line-strong"><MathText content={c} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.filas.map((f, r) => (
            <tr key={r} className={r % 2 === 1 ? 'bg-surface-2/60' : ''}>
              <th scope="row" className="p-3 text-left font-semibold text-fg border-b border-line align-top"><MathText content={f.criterio} /></th>
              {f.valores.map((v, i) => (
                <td key={i} className="p-3 text-fg border-b border-line align-top"><MathText content={v} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Process({ data }: { data: Extract<Infographic, { tipo: 'process' }> }) {
  return (
    <ol className="space-y-0">
      {data.pasos.map((p, i) => (
        <li key={i} className="relative flex gap-4 pb-6 last:pb-0">
          {i < data.pasos.length - 1 && <span aria-hidden="true" className="absolute left-[19px] top-10 bottom-0 w-0.5 bg-line-strong" />}
          <span aria-hidden="true" className="relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary font-bold">
            {i + 1}
          </span>
          <div className="pt-1.5">
            <p className="font-semibold text-fg"><span className="sr-only">Paso {i + 1}: </span><MathText content={p.titulo} /></p>
            {p.detalle && <p className="text-sm text-fg-muted"><MathText content={p.detalle} /></p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Stats({ data }: { data: Extract<Infographic, { tipo: 'stats' }> }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {data.cifras.map((c, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface-2 p-4 flex flex-col">
          <dt className="order-2 mt-1 font-semibold text-fg"><MathText content={c.etiqueta} /></dt>
          <dd className="order-1 text-3xl font-extrabold text-primary-text tabular-nums break-words"><MathText content={c.valor} /></dd>
          {c.nota && <dd className="order-3 text-xs text-fg-muted mt-1"><MathText content={c.nota} /></dd>}
        </div>
      ))}
    </dl>
  );
}
