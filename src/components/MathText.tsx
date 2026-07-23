'use client';

// Sesion L: soporte de notacion matematica (LaTeX) para materiales/preguntas
// de cursos con contenido tecnico (ej: Microeconomia). Parsea $...$ (inline)
// y $$...$$ (bloque) dentro de un string y renderiza el resto como texto
// plano. Si el contenido no tiene ningun $, se comporta igual que <span>.

import { InlineMath, BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css';

export function MathText({ content, className }: { content: string; className?: string }) {
  if (!content) return null;
  if (!content.includes('$')) return <span className={className}>{content}</span>;

  const parts = content.split(/(\$\$[^$]+\$\$|\$[^$]+\$)/g);

  return (
    <span className={className}>
      {parts.map((part, idx) => {
        if (part.startsWith('$$') && part.endsWith('$$') && part.length > 4) {
          return (
            <BlockMath key={idx} math={part.slice(2, -2)} errorColor="#f87171" renderError={() => <code>{part}</code>} />
          );
        }
        if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
          return (
            <InlineMath key={idx} math={part.slice(1, -1)} errorColor="#f87171" renderError={() => <code>{part}</code>} />
          );
        }
        return <span key={idx}>{part}</span>;
      })}
    </span>
  );
}
