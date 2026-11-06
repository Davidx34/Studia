import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

// Hallazgo de la evaluacion del 2026-11-06: en «Completar frase» la oracion con el hueco salia DOS veces (encabezado de la pregunta y un cuadro dentro del bloque).
describe('Completar frase: la oracion se muestra una sola vez', () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'src/app/(student)/lesson/[id]/page.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const block = page.slice(page.indexOf("if (q.type === 'fill_blank') return ("), page.indexOf('aria-label="Palabras que faltan"'));
  it('el bloque de completar no repite el enunciado', () => {
    expect(block.length).toBeGreaterThan(50);
    expect(block).not.toContain('<MathText content={q.q} />');
  });
  it('el encabezado de la pregunta sigue mostrando el enunciado (con formulas)', () => {
    expect(page).toContain('<p className="text-fg font-bold text-lg mb-6"><MathText content={q.q} /></p>');
  });
});
