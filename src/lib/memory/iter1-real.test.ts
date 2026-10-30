import { describe, it, expect } from 'vitest';
import { aliasKeys, aliasUnions, findDuplicateCandidates } from './duplicates';
import { mergeGraphs } from './merge';
import { normalizeKey } from './text';
import type { Concept, ConceptKind } from './types';

// Nombres REALES de la memoria de una clase de historia (5.º grado, 4 materiales; leida el 2026-10-30): los duplicados que el detector tiene que ver.
// Se copian tal cual salieron de la base (nombre y tipo). No hay datos personales: son conceptos de historia.
const REAL: [string, ConceptKind][] = [
  ['Aztecas', 'persona'],
  ['Aztecas/Mexicas', 'persona'],
  ['Incas/Tahuantinsuyo', 'persona'],
  ['Tahuantinsuyo', 'lugar'],
  ['Siddharta Gautama', 'persona'],
  ['Siddharta Gautama (Buda)', 'persona'],
  ["Ma'at", 'concepto'],
  ['Maat', 'concepto'],
  ['Senado', 'concepto'],
  ['Senado Romano', 'concepto'],
  ['Imperio Antiguo', 'periodo'],
  ['Imperio Antiguo de Egipto', 'periodo'],
  ['Reino Antiguo de Egipto', 'periodo'],
  ['Imperio Nuevo', 'periodo'],
  ['Imperio Nuevo de Egipto', 'periodo'],
  ['Imperio Medio', 'periodo'],
  ['Nilo', 'lugar'],
  ['Río Nilo', 'lugar'],
  ['Egipto', 'lugar'],
  ['Egipto ptolemaico', 'concepto'],
  ['Antiguo Egipto', 'periodo'],
  ['Idioma del Antiguo Egipto', 'concepto'],
  ['Idioma egipcio antiguo', 'concepto'],
  ['Código de Hammurabi', 'obra'],
  ['Código de Ur-Nammu', 'obra'],
  ['Primer Periodo Intermedio', 'periodo'],
  ['Segundo Periodo Intermedio', 'periodo'],
  ['Tercer Periodo Intermedio', 'periodo'],
  ['Mesopotamia', 'lugar'],
  ['Faraón', 'persona'],
];

const concepts: Concept[] = REAL.map(([name, kind]) => ({ key: normalizeKey(name), name, kind, definition: `Def ${name}.`, formula: '', unit: '', importance: 3, mentions: 1, sources: [{ materialId: 'm1', chunks: [0] }] }));
const K = (name: string) => normalizeKey(name);
const pair = (a: string, b: string) => [K(a), K(b)].sort().join('~');

describe('detector de duplicados con nombres REALES de una clase de historia', () => {
  const alta = aliasUnions(concepts).map(([a, b]) => [a, b].sort().join('~'));
  const found = findDuplicateCandidates(concepts, []);
  const media = found.filter((p) => p.confidence === 'media').map((p) => [p.a, p.b].sort().join('~'));

  it('ALTA: alias que escribio el propio material (barra, parentesis, apostrofe)', () => {
    expect(alta).toEqual(expect.arrayContaining([pair('Aztecas', 'Aztecas/Mexicas'), pair('Siddharta Gautama', 'Siddharta Gautama (Buda)'), pair("Ma'at", 'Maat')]));
  });

  it('ALTA no se pasa: no une el pueblo inca con el lugar Tahuantinsuyo, ni periodos distintos', () => {
    expect(alta).not.toContain(pair('Incas/Tahuantinsuyo', 'Tahuantinsuyo')); // persona vs lugar: tipos incompatibles
    expect(alta).not.toContain(pair('Imperio Antiguo', 'Imperio Nuevo'));
    expect(alta).not.toContain(pair('Primer Periodo Intermedio', 'Segundo Periodo Intermedio'));
    expect(alta).toHaveLength(3);
  });

  it('MEDIA: sinonimo historico (Reino/Imperio) y contencion de una palabra (Senado / Senado Romano)', () => {
    expect(media).toEqual(expect.arrayContaining([pair('Reino Antiguo de Egipto', 'Imperio Antiguo de Egipto'), pair('Senado', 'Senado Romano'), pair('Imperio Nuevo', 'Imperio Nuevo de Egipto'), pair('Imperio Antiguo', 'Imperio Antiguo de Egipto'), pair('Nilo', 'Río Nilo')]));
  });

  it('MEDIA no propone cosas distintas: ordinales, periodos hermanos ni tipos incompatibles', () => {
    expect(media).not.toContain(pair('Primer Periodo Intermedio', 'Segundo Periodo Intermedio'));
    expect(media).not.toContain(pair('Imperio Antiguo', 'Imperio Nuevo'));
    expect(media).not.toContain(pair('Egipto', 'Egipto ptolemaico')); // lugar vs concepto
    expect(media).not.toContain(pair('Código de Hammurabi', 'Código de Ur-Nammu'));
    // "Antiguo Egipto" (un periodo) no esta CONTENIDO en "Imperio Antiguo de Egipto" (otro periodo): la palabra que sobra es de periodizacion
    expect(media).not.toContain(pair('Antiguo Egipto', 'Imperio Antiguo de Egipto'));
    expect(media).not.toContain(pair('Antiguo Egipto', 'Reino Antiguo de Egipto'));
  });

  it('al fusionar la clase SOLO se aplican los de confianza alta; los de media quedan como candidatos', () => {
    const { graph, stats } = mergeGraphs([{ materialId: 'm1', graph: { concepts, edges: [] } }]);
    expect(stats.duplicatesMerged).toBe(3);
    expect(graph.concepts).toHaveLength(concepts.length - 3);
    expect(stats.duplicateCandidates).toBeGreaterThanOrEqual(5);
    expect(graph.concepts.map((c) => c.key)).toEqual(expect.arrayContaining([K('Senado'), K('Senado Romano'), K('Reino Antiguo de Egipto'), K('Imperio Antiguo de Egipto')]));
  });

  it('aliasKeys con nombres reales', () => {
    expect(aliasKeys("Ma'at")).toEqual(['ma-at', 'maat']);
    expect(aliasKeys('Siddharta Gautama (Buda)')).toEqual(expect.arrayContaining(['siddharta-gautama', 'siddhartagautama']));
  });
});
