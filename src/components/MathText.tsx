'use client';

// Sesion L: soporte de notacion matematica (LaTeX) para materiales/preguntas de cursos con contenido tecnico (ej: Microeconomia). Parsea $...$ (inline) y $$...$$ (bloque) dentro de un string y
// renderiza el resto como texto plano. Si el contenido no tiene ningun $, se comporta igual que <span>.
// La separacion entre texto y formula (y la reparacion de LaTeX corrupto) vive en lesson/latex.ts: «$100 y $20» es dinero, no una formula.

import { InlineMath, BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css';
import { repairLatexControlChars, splitMath } from '@/lib/lesson/latex';

export function MathText({ content, className }: { content: string; className?: string }) {
  if (!content) return null;
  if (!content.includes('$')) return <span className={className}>{repairLatexControlChars(content)}</span>;

  return (
    <span className={className}>
      {splitMath(content).map((seg, idx) => {
        if (seg.kind === 'block') return <BlockMath key={idx} math={seg.value} errorColor="#f87171" renderError={() => <code>{`$$${seg.value}$$`}</code>} />;
        if (seg.kind === 'inline') return <InlineMath key={idx} math={seg.value} errorColor="#f87171" renderError={() => <code>{`$${seg.value}$`}</code>} />;
        return <span key={idx}>{seg.value}</span>;
      })}
    </span>
  );
}
