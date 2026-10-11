import { AlertTriangle, Check } from 'lucide-react';
import { buildAnswerView } from '@/lib/questions/reviewView';

// Muestra, en la tarjeta de revision, el contenido que el profesor necesita para
// juzgar una pregunta clasica: la respuesta correcta y no solo el enunciado.
// Ver src/lib/questions/reviewView.ts para el por que.
//
// La respuesta correcta se marca con texto y simbolo, no solo con color: quien
// no distingue verde de gris tiene que poder decidir igual.

const WARNING_CLASS = 'text-xs mt-1.5 flex items-center gap-1.5 text-accent-text';

export default function RespuestaCorrecta({ q }: { q: Parameters<typeof buildAnswerView>[0] }) {
  const view = buildAnswerView(q);

  switch (view.kind) {
    case 'options':
      return (
        <div className="mt-1.5">
          <ul className="text-xs space-y-1">
            {view.options.map((o, i) => (
              <li
                key={i}
                className={
                  o.correct
                    ? 'flex items-start gap-1.5 rounded-md px-2 py-1 bg-success/10 border border-success/25 text-success'
                    : 'flex items-start gap-1.5 px-2 py-1 text-fg-muted'
                }
              >
                {o.correct && <Check className="w-3.5 h-3.5 mt-px flex-shrink-0" aria-hidden="true" />}
                <span>
                  {o.text}
                  {o.correct && <span className="ml-1.5 font-medium">(correcta)</span>}
                </span>
              </li>
            ))}
          </ul>
          {!view.hasCorrect && (
            <p className={WARNING_CLASS}>
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
              Ninguna opción está marcada como correcta.
            </p>
          )}
        </div>
      );

    case 'true_false':
      return (
        <p className="text-xs mt-1.5 text-fg-muted">
          Marcada como:{' '}
          <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium bg-success/10 border border-success/25 text-success">
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            {view.value ? 'Verdadero' : 'Falso'}
          </span>
        </p>
      );

    case 'pairs':
      return (
        <ul className="mt-1.5 space-y-1 text-xs">
          {view.pairs.map((p, i) => (
            <li key={i} className="grid grid-cols-[minmax(0,2fr)_auto_minmax(0,3fr)] items-baseline gap-2 rounded-md px-2 py-1 bg-surface-2">
              <span className="text-fg font-medium">{p.term}</span>
              <span className="text-fg-muted" aria-label="se conecta con">
                →
              </span>
              <span className="text-fg-muted">{p.def}</span>
            </li>
          ))}
        </ul>
      );

    case 'keywords':
      return (
        <p className="text-xs mt-1.5 text-fg-muted">
          Debe mencionar:{' '}
          {view.keywords.map((k, i) => (
            <span key={i} className="inline-block mr-1.5 mb-1 rounded-md px-2 py-0.5 bg-surface-2 text-fg">
              {k}
            </span>
          ))}
        </p>
      );

    case 'blank':
      return <p className="text-xs mt-1.5 text-fg-muted">Respuesta esperada: {view.answers.join(', ')}</p>;

    case 'missing':
      return (
        <p className={WARNING_CLASS}>
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
          Faltan los datos de la respuesta correcta: ya es motivo para rechazarla.
        </p>
      );

    case 'none':
      return null;
  }
}
