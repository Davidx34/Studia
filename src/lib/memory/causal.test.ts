import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { causeBeforeEffect, hasCausalLink, parseExtraction } from './extract';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const group = (text: string) => ({ section: null, text, chunkIndexes: [0] });

// hasCausalLink(texto, causa, efecto): la señal causal debe unir a LOS DOS conceptos.
describe('hasCausalLink: la señal causal une a los dos conceptos', () => {
  it('causa y efecto en la misma frase con la expresion causal', () => {
    expect(hasCausalLink('Debido a las crecidas del Nilo, la agricultura prosperó en Egipto.', 'crecidas del Nilo', 'agricultura')).toBe(true);
    expect(hasCausalLink('La agricultura permitió el crecimiento de la población.', 'agricultura', 'población')).toBe(true);
    expect(hasCausalLink('La población creció porque la agricultura prosperó.', 'agricultura', 'población')).toBe(true);
  });

  it('una frase causal que menciona SOLO UNO de los dos conceptos ya no basta (era la fuente de causas falsas)', () => {
    const t = 'El Nilo dejaba limo fértil en sus orillas. Debido a las crecidas del Nilo, la agricultura prosperó.';
    expect(hasCausalLink(t, 'Nilo', 'limo fértil')).toBe(false);
    expect(hasCausalLink(t, 'limo fértil', 'Nilo')).toBe(false);
    // y la causa real sigue en pie
    expect(hasCausalLink(t, 'crecidas del Nilo', 'agricultura')).toBe(true);
  });

  it('la causa expresada en la frase VECINA de un par que solo se menciona sin causa no cuenta (guerras punicas / Cartago)', () => {
    const t = 'Debido a las guerras púnicas, Roma conquistó Sicilia. Las guerras púnicas enfrentaron a Roma con Cartago.';
    expect(hasCausalLink(t, 'guerras púnicas', 'Cartago')).toBe(false);
    expect(hasCausalLink(t, 'guerras púnicas', 'Sicilia')).toBe(true);
  });

  describe('expresiones que miran hacia atras (por eso, en consecuencia...)', () => {
    it('causa en la frase anterior y efecto en la de la expresion: sí', () => {
      expect(hasCausalLink('Prosperó la agricultura. Por eso creció la población.', 'agricultura', 'población')).toBe(true);
      expect(hasCausalLink('Hubo una sequía. En consecuencia, la cosecha se perdió.', 'sequía', 'cosecha')).toBe(true);
    });
    it('el ORDEN importa: el efecto no puede estar en la frase anterior', () => {
      expect(hasCausalLink('Prosperó la agricultura. Por eso creció la población.', 'población', 'agricultura')).toBe(false);
    });
    it('debe ser la frase INMEDIATAMENTE anterior', () => {
      expect(hasCausalLink('Prosperó la agricultura. Hubo grandes fiestas. Por eso creció la población.', 'agricultura', 'población')).toBe(false);
    });
    it('una expresion que NO mira hacia atras (porque) no toma la causa de la frase anterior', () => {
      expect(hasCausalLink('Prosperó la agricultura. Creció la población porque hubo paz.', 'agricultura', 'población')).toBe(false);
    });
    it('la expresion no puede estar en la primera frase (no hay frase anterior)', () => {
      expect(hasCausalLink('Por eso creció la población. Prosperó la agricultura.', 'agricultura', 'población')).toBe(false);
    });
  });

  describe('el SENTIDO lo marca la expresion causal (la IA a veces invierte la causa y el efecto)', () => {
    it('"debido a" y "porque": la causa viene despues de la expresion', () => {
      const t = 'Debido a las crecidas del Nilo, la agricultura prosperó en Egipto.';
      expect(hasCausalLink(t, 'crecidas del Nilo', 'agricultura')).toBe(true);
      expect(hasCausalLink(t, 'agricultura', 'crecidas del Nilo')).toBe(false);
      const u = 'La población creció porque la agricultura prosperó.';
      expect(hasCausalLink(u, 'agricultura', 'población')).toBe(true);
      expect(hasCausalLink(u, 'población', 'agricultura')).toBe(false);
    });
    it('un verbo causal: la causa va antes y el efecto despues', () => {
      const t = 'La agricultura permitió el crecimiento de la población.';
      expect(hasCausalLink(t, 'agricultura', 'población')).toBe(true);
      expect(hasCausalLink(t, 'población', 'agricultura')).toBe(false);
      expect(hasCausalLink('La sequía provocó la migración.', 'migración', 'sequía')).toBe(false);
    });
    it('"por eso" dentro de la misma frase: la causa va antes', () => {
      const t = 'Cada año el Nilo se desbordaba y dejaba un limo fértil, por eso la agricultura prosperó en Egipto.';
      expect(hasCausalLink(t, 'Nilo', 'agricultura')).toBe(true);
      expect(hasCausalLink(t, 'agricultura', 'Nilo')).toBe(false);
    });
    it('"consecuencia de" fija la causa DESPUES (aunque contenga "consecuencia")', () => {
      const t = 'La hambruna fue consecuencia de la sequía.';
      expect(hasCausalLink(t, 'sequía', 'hambruna')).toBe(true);
      expect(hasCausalLink(t, 'hambruna', 'sequía')).toBe(false);
    });
    it('una expresion ambigua ("el motivo...") no fija sentido: se acepta en cualquier orden, como antes', () => {
      const t = 'El motivo del éxodo fue la sequía.';
      expect(hasCausalLink(t, 'sequía', 'éxodo')).toBe(true);
      expect(hasCausalLink(t, 'éxodo', 'sequía')).toBe(true);
    });
    it('la expresion que aparece PRIMERO decide el sentido', () => {
      const t = 'La población creció porque la agricultura permitió abastecerla.';
      expect(hasCausalLink(t, 'agricultura', 'población')).toBe(true);
      expect(hasCausalLink(t, 'población', 'agricultura')).toBe(false);
    });
    it('un concepto de varias palabras se ubica por su PRIMERA palabra (empieza antes del verbo aunque termine despues)', () => {
      expect(hasCausalLink('La sequía provocó el desborde del Nilo.', 'sequía del Nilo', 'desborde')).toBe(true);
    });
    it('causeBeforeEffect: sin expresion conocida o con un concepto ausente no puede decidir y acepta', () => {
      expect(causeBeforeEffect('La agricultura y la población crecieron.', 'agricultura', 'población')).toBe(true);
      expect(causeBeforeEffect('La sequía provocó la migración.', 'sequía', 'fantasma')).toBe(true);
    });
  });

  it('sin expresion causal, vacio o conceptos ausentes: no', () => {
    expect(hasCausalLink('La agricultura y la población crecieron.', 'agricultura', 'población')).toBe(false);
    expect(hasCausalLink('', 'A', 'B')).toBe(false);
    expect(hasCausalLink('Debido a la lluvia hubo cosecha.', 'sequía', 'hambruna')).toBe(false);
  });

  it('conceptos con varias palabras: basta la mitad de las palabras de cada uno en la frase', () => {
    expect(hasCausalLink('Debido a las crecidas del Nilo, la agricultura prosperó.', 'crecidas del Nilo', 'la agricultura egipcia')).toBe(true);
  });
});

describe('parseExtraction aplica el criterio mas estricto', () => {
  const TEXT = 'El Nilo se desbordaba cada año y dejaba limo fértil en sus orillas. Debido a las crecidas del Nilo, la agricultura prosperó en Egipto. Los faraones gobernaban Egipto.';
  const resp = (rel: { de: string; a: string }[]) =>
    JSON.stringify({
      conceptos: ['Nilo', 'limo fértil', 'crecidas del Nilo', 'agricultura', 'faraones', 'Egipto'].map((nombre) => ({ nombre, tipo: 'concepto', definicion: `${nombre}.`, importancia: 3 })),
      relaciones: rel.map((r) => ({ ...r, tipo: 'causa' })),
    });
  const edge = (de: string, a: string) => {
    const r = parseExtraction(resp([{ de, a }]), group(TEXT), 'm1', 'narrativo')!;
    return r.extraction.edges[0]?.relation;
  };

  it('"Nilo -> limo fértil" (la frase causal nombra solo el Nilo) pasa a conexion neutra', () => {
    expect(edge('Nilo', 'limo fértil')).toBe('relacionado');
  });
  it('"crecidas del Nilo -> agricultura" sigue siendo causa', () => {
    expect(edge('crecidas del Nilo', 'agricultura')).toBe('causa');
  });
  it('un par sin ninguna expresion causal sigue siendo neutro', () => {
    expect(edge('faraones', 'Egipto')).toBe('relacionado');
  });
  it('si la IA INVIERTE la causa y el efecto ("agricultura -> crecidas del Nilo") pasa a conexion neutra', () => {
    expect(edge('agricultura', 'crecidas del Nilo')).toBe('relacionado');
  });
});

describe('cableado', () => {
  it('extract.ts usa hasCausalLink con la causa en `de` y el efecto en `a` (el orden importa)', () => {
    expect(read('src/lib/memory/extract.ts')).toMatch(/hasCausalLink\(win, byKey\[from\]\.name, byKey\[to\]\.name\)/);
  });
});
