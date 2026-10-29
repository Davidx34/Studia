import { describe, it, expect } from 'vitest';
import { equationsIn, findEquation } from './equations';
import { parseExtraction } from './extract';

describe('equationsIn', () => {
  it('toma el tramo de simbolos alrededor del igual, sin la prosa', () => {
    expect(equationsIn('Si el ingreso es M y los precios son p_x y p_y, la restricción es p_x * x + p_y * y = M.')).toEqual(['p_x * x + p_y * y = M']);
    expect(equationsIn('su pendiente es la tasa marginal de sustitución, TMS = UMg_x / UMg_y.')).toEqual(['TMS = UMg_x / UMg_y']);
    expect(equationsIn('Una función usual es la Cobb-Douglas: U(x,y) = x^a * y^(1-a), donde a es la preferencia por x.')).toEqual(['U(x,y) = x^a * y^(1-a)']);
    expect(equationsIn('La ley dice que F = m * a y nada más.')).toEqual(['F = m * a']);
  });
  it('varias ecuaciones en una frase, y ninguna si no hay igual o falta un lado', () => {
    expect(equationsIn('Se cumple A = B + C; además D = 2 * E.').length).toBe(2);
    expect(equationsIn('No hay ninguna ecuación aquí.')).toEqual([]);
    expect(equationsIn('Valores = ')).toEqual([]);
  });
  it('no inventa: lo devuelto es siempre un fragmento literal de la frase', () => {
    const s = 'Entonces la utilidad es U = x * y cuando consumimos.';
    for (const eq of equationsIn(s)) expect(s).toContain(eq);
  });
});

describe('findEquation', () => {
  const text = 'La utilidad marginal es la satisfacción adicional de una unidad más. El consumidor no puede comprar todo: está limitado por su restricción presupuestal. Si el ingreso es M y los precios son p_x y p_y, la restricción es p_x * x + p_y * y = M. La pendiente de la recta es -p_x/p_y. Un impuesto t eleva el precio: P_c = P + t.';
  it('asocia la ecuacion al concepto de SU frase', () => {
    expect(findEquation(text, 'Restricción Presupuestal')).toBe('p_x * x + p_y * y = M');
    expect(findEquation(text, 'Impuesto')).toBe('P_c = P + t');
  });
  it('NO le pasa la ecuacion de la frase vecina a otro concepto (una formula equivocada es peor que ninguna)', () => {
    expect(findEquation(text, 'Recta presupuestal')).toBeNull();
    expect(findEquation(text, 'Pendiente de la recta')).toBeNull();
  });
  it('un concepto sin ecuacion cerca da null', () => {
    expect(findEquation(text, 'Utilidad marginal')).toBeNull();
    expect(findEquation(text, 'Elasticidad cruzada')).toBeNull();
    expect(findEquation(text, '')).toBeNull();
  });
});

describe('extraccion: la red de seguridad de ecuaciones', () => {
  const group = {
    section: null,
    text: 'El consumidor está limitado por su restricción presupuestal. Si el ingreso es M y los precios son p_x y p_y, la restricción es p_x * x + p_y * y = M. La utilidad marginal es la satisfacción adicional.',
    chunkIndexes: [0],
  };
  const answer = (formula: string) => JSON.stringify({ conceptos: [{ nombre: 'Restricción presupuestal', tipo: 'concepto', definicion: 'Limita el gasto.', formula, importancia: 5 }, { nombre: 'Utilidad marginal', tipo: 'concepto', definicion: 'Satisfacción adicional.', formula: '', importancia: 4 }] });

  it('si la IA olvido la formula pero el texto la trae, se completa con el fragmento literal', () => {
    const r = parseExtraction(answer(''), group, 'm1')!;
    expect(r.extraction.concepts[0].formula).toBe('p_x * x + p_y * y = M');
    expect(r.extraction.concepts[1].formula).toBe('');
  });
  it('si la IA si la copio, se respeta la suya', () => {
    expect(parseExtraction(answer('M = p_x*x + p_y*y'), group, 'm1')!.extraction.concepts[0].formula).toBe('M = p_x*x + p_y*y');
  });
});
