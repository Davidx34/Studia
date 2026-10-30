import { describe, it, expect } from 'vitest';
import { aliasKeys, aliasUnions, findDuplicateCandidates } from './duplicates';
import { reclassifyKind } from './kinds';
import { mergeGraphs } from './merge';
import { hasCausalCue, parseExtraction } from './extract';
import { withoutTitleConcept } from './build';
import { normalizeKey } from './text';
import type { Concept, Edge } from './types';

const c = (name: string, over: Partial<Concept> = {}): Concept => ({ key: normalizeKey(name), name, kind: 'concepto', definition: `Def de ${name}.`, formula: '', unit: '', importance: 3, mentions: 1, sources: [{ materialId: 'm1', chunks: [0] }], ...over });
const e = (from: string, to: string, relation: Edge['relation'] = 'parte_de'): Edge => ({ from: normalizeKey(from), to: normalizeKey(to), relation, weight: 1 });
const group = (text: string) => ({ section: null, text, chunkIndexes: [0] });

// ─────────────────────────── 5. reclasificar colectivos ───────────────────────────
describe('reclassifyKind: un colectivo etiquetado "persona" es un "grupo"', () => {
  it('pueblos: gentilicio plural + definicion de colectivo', () => {
    expect(reclassifyKind('persona', 'Sumerios', 'Pueblo de Mesopotamia que fundó las primeras ciudades-estado.')).toBe('grupo');
    expect(reclassifyKind('persona', 'Aztecas', 'Civilización mesoamericana que fundó Tenochtitlan.')).toBe('grupo');
    expect(reclassifyKind('persona', 'Los fenicios', 'Pobladores de la costa del Líbano, grandes comerciantes.')).toBe('grupo');
  });

  it('sustantivo colectivo al inicio: dinastias, senados, legiones, pueblos', () => {
    expect(reclassifyKind('persona', 'Dinastía XVIII', 'Familia gobernante del Imperio Nuevo.')).toBe('grupo');
    expect(reclassifyKind('persona', 'Senado Romano', 'Asamblea de la República.')).toBe('grupo');
    expect(reclassifyKind('persona', 'Legiones Romanas', 'Unidades del ejército.')).toBe('grupo');
    expect(reclassifyKind('concepto', 'Pueblos del Mar', 'Grupo de invasores que atacó el Mediterráneo oriental.')).toBe('grupo');
  });

  it('NUNCA convierte un individuo: tratamiento, cargo o nombre que acaba en "s" no bastan', () => {
    expect(reclassifyKind('persona', 'Rey Sargón', 'Rey de Acad que formó el primer imperio.')).toBe('persona');
    expect(reclassifyKind('persona', 'Ramsés', 'Faraón del Imperio Nuevo, hijo de Seti.')).toBe('persona');
    expect(reclassifyKind('persona', 'Tutmosis', 'Faraón conquistador.')).toBe('persona');
    expect(reclassifyKind('persona', 'Pericles', 'Estadista ateniense; gobernante en la época dorada.')).toBe('persona');
    expect(reclassifyKind('persona', 'Sumerios', 'Rey legendario de un pueblo antiguo.')).toBe('persona'); // la definicion habla de un individuo
    // aunque el nombre sea un plural y la definicion mencione un pueblo, si habla de un rey se respeta lo que dijo el modelo (ante la duda, no se reclasifica)
    expect(reclassifyKind('persona', 'Hammurabi', 'Pueblo?')).toBe('persona');
  });

  it('no toca otros tipos (lugar, evento, obra, formula) ni conceptos de otras materias', () => {
    expect(reclassifyKind('lugar', 'Pueblo Nuevo', 'Ciudad de Egipto.')).toBe('lugar');
    expect(reclassifyKind('periodo', 'Imperio Romano', 'Estado dirigido por emperadores.')).toBe('periodo');
    expect(reclassifyKind('concepto', 'Imperio Romano', 'Estado dirigido por emperadores.')).toBe('concepto');
    expect(reclassifyKind('concepto', 'Movimiento rectilíneo uniforme', 'Movimiento en línea recta con velocidad constante.')).toBe('concepto');
    expect(reclassifyKind('formula', 'Dinastía XVIII', 'x')).toBe('formula');
  });

  it('el extractor narrativo aplica la heuristica, y la fusion tambien (memorias ya guardadas se corrigen sin releer)', () => {
    const resp = JSON.stringify({ conceptos: [{ nombre: 'Sumerios', tipo: 'persona', definicion: 'Pueblo que habitó Mesopotamia.' }] });
    const r = parseExtraction(resp, group('Los Sumerios, un pueblo que habitó Mesopotamia, fundaron ciudades.'), 'm1', 'narrativo')!;
    expect(r.extraction.concepts[0].kind).toBe('grupo');
    const m = mergeGraphs([{ materialId: 'm1', graph: { concepts: [c('Aztecas', { kind: 'persona', definition: 'Pueblo mesoamericano.' })], edges: [] } }]);
    expect(m.graph.concepts[0].kind).toBe('grupo');
  });
});

// ─────────────────────────── 6. duplicados semanticos ───────────────────────────
describe('aliasKeys', () => {
  it('separa "/" y quita parentesis; las siglas cortas no cuentan', () => {
    expect(aliasKeys('Aztecas/Mexicas')).toEqual(['azteca', 'mexica', 'azteca-mexica', 'aztecamexica']);
    expect(aliasKeys('Utilidad Marginal (UM)')).toEqual(['utilidad-marginal', 'utilidad-marginal-um', 'utilidadmarginal', 'utilidadmarginalum']);
    expect(aliasKeys('Ley de Ohm')).toEqual(['ley-ohm', 'leyohm']);
    expect(aliasKeys('UM')).toEqual([]);
  });
});

describe('aliasUnions (confianza ALTA)', () => {
  it('une un nombre con su alias escrito por el propio material', () => {
    const cs = [c('Aztecas', { kind: 'grupo' }), c('Aztecas/Mexicas', { kind: 'grupo' }), c('Incas', { kind: 'grupo' }), c('Incas/Tahuantinsuyo', { kind: 'persona' }), c('Utilidad marginal'), c('Utilidad Marginal (UM)')];
    const pairs = aliasUnions(cs).map(([a, b]) => `${a}~${b}`);
    expect(pairs).toEqual(expect.arrayContaining(['azteca~azteca-mexica', 'inca~inca-tahuantinsuyo', 'utilidad-marginal~utilidad-marginal-um']));
    expect(pairs).toHaveLength(3);
  });

  it('no une tipos incompatibles (un lugar y un pueblo) ni nombres sin alias comun', () => {
    expect(aliasUnions([c('Egipto', { kind: 'lugar' }), c('Egipto/Kemet', { kind: 'grupo' })])).toEqual([]);
    expect(aliasUnions([c('Faraón'), c('Escriba'), c('Mesopotamia', { kind: 'lugar' })])).toEqual([]);
  });

  it('es determinista (no depende del orden) y escala: 6.000 conceptos en menos de un segundo', () => {
    const cs = [c('Aztecas', { kind: 'grupo' }), c('Aztecas/Mexicas', { kind: 'grupo' }), c('Mayas', { kind: 'grupo' })];
    expect(aliasUnions(cs)).toEqual(aliasUnions(cs.slice().reverse()));
    const many = Array.from({ length: 6000 }, (_, i) => c(`concepto numero ${i} qx${i}`));
    const t = Date.now();
    aliasUnions(many);
    expect(Date.now() - t).toBeLessThan(1000);
  });
});

describe('findDuplicateCandidates (confianza MEDIA: sinonimos)', () => {
  it('Reino/Imperio y Batalla/Combate son candidatos, con el vecindario como pista', () => {
    const cs = [c('Reino Antiguo de Egipto', { kind: 'periodo' }), c('Imperio Antiguo de Egipto', { kind: 'periodo' }), c('Batalla de Accio', { kind: 'evento' }), c('Combate de Accio', { kind: 'evento' }), c('Pirámides', { kind: 'obra' }), c('Faraón', { kind: 'persona' })];
    const es = [e('Pirámides', 'Reino Antiguo de Egipto'), e('Pirámides', 'Imperio Antiguo de Egipto'), e('Faraón', 'Reino Antiguo de Egipto')];
    const found = findDuplicateCandidates(cs, es);
    const reino = found.find((p) => p.a.includes('imperio-antiguo') || p.b.includes('imperio-antiguo'))!;
    expect(reino).toMatchObject({ confidence: 'media', reason: 'sinonimo' });
    expect(reino.score).toBeGreaterThan(0.5); // comparten la piramide
    expect(found.some((p) => p.a.includes('batalla') || p.b.includes('batalla'))).toBe(true);
    const sinVecinos = findDuplicateCandidates([cs[2], cs[3]], []);
    expect(sinVecinos[0].score).toBe(0.5);
  });

  it('palabras distintas no son sinonimos: "Imperio Antiguo" y "Imperio Nuevo" NO son candidatos', () => {
    expect(findDuplicateCandidates([c('Imperio Antiguo', { kind: 'periodo' }), c('Imperio Nuevo', { kind: 'periodo' })], [])).toEqual([]);
  });

  it('un lugar y un periodo con sinonimo no se proponen (tipos incompatibles)', () => {
    expect(findDuplicateCandidates([c('Reino Nuevo', { kind: 'periodo' }), c('Imperio Nuevo', { kind: 'lugar' })], [])).toEqual([]);
  });

  it('los alias salen primero (alta) y luego los sinonimos (media)', () => {
    const found = findDuplicateCandidates([c('Aztecas', { kind: 'grupo' }), c('Aztecas/Mexicas', { kind: 'grupo' }), c('Reino Nuevo', { kind: 'periodo' }), c('Imperio Nuevo', { kind: 'periodo' })], []);
    expect(found.map((p) => p.confidence)).toEqual(['alta', 'media']);
  });
});

describe('mergeGraphs: fusion de alias conservando el historial de fuentes', () => {
  const m1 = { materialId: 'm1', graph: { concepts: [c('Aztecas', { kind: 'grupo', sources: [{ materialId: 'm1', chunks: [1, 2] }], definition: 'Pueblo.' }), c('Tenochtitlan', { kind: 'lugar', sources: [{ materialId: 'm1', chunks: [1] }] })], edges: [e('Tenochtitlan', 'Aztecas', 'parte_de')] } };
  const m2 = { materialId: 'm2', graph: { concepts: [c('Aztecas/Mexicas', { kind: 'grupo', sources: [{ materialId: 'm2', chunks: [7] }], definition: 'Pueblo mesoamericano que dominó el centro de México antes de la conquista.' }), c('Moctezuma', { kind: 'persona', sources: [{ materialId: 'm2', chunks: [7] }] })], edges: [e('Moctezuma', 'Aztecas/Mexicas', 'relacionado')] } };

  it('un solo nodo con las fuentes de AMBOS materiales, la mejor definicion y las relaciones remapeadas', () => {
    const { graph, stats } = mergeGraphs([m1, m2]);
    const az = graph.concepts.filter((x) => x.key.startsWith('azteca'));
    expect(az).toHaveLength(1);
    expect(az[0].sources).toEqual([{ materialId: 'm1', chunks: [1, 2] }, { materialId: 'm2', chunks: [7] }]);
    expect(az[0].mentions).toBe(2);
    expect(az[0].definition).toContain('dominó el centro de México');
    expect(stats.duplicatesMerged).toBe(1);
    expect(graph.edges.every((x) => graph.concepts.some((k) => k.key === x.from) && graph.concepts.some((k) => k.key === x.to))).toBe(true);
    expect(graph.edges).toHaveLength(2);
  });

  it('el orden de los materiales no cambia el resultado', () => {
    expect(JSON.stringify(mergeGraphs([m1, m2]).graph)).toBe(JSON.stringify(mergeGraphs([m2, m1]).graph));
  });

  it('con dedupe:false no se fusiona', () => {
    const { graph, stats } = mergeGraphs([m1, m2], { dedupe: false });
    expect(graph.concepts.filter((x) => x.key.startsWith('azteca'))).toHaveLength(2);
    expect(stats.duplicatesMerged).toBe(0);
  });

  it('los sinonimos NO se fusionan solos ("Reino Romano" no es "Imperio Romano"), pero se cuentan como candidatos', () => {
    const g = { materialId: 'm1', graph: { concepts: [c('Reino Romano', { kind: 'periodo' }), c('Imperio Romano', { kind: 'periodo' })], edges: [] } };
    const { graph, stats } = mergeGraphs([g]);
    expect(graph.concepts).toHaveLength(2);
    expect(stats.duplicatesMerged).toBe(0);
    expect(stats.duplicateCandidates).toBe(1);
  });
});

// ─────────────────────────── 2. desempate del reparto por percentiles ───────────────────────────
describe('percentiles: desempate determinista', () => {
  it('con puntajes empatados, el resultado no depende del orden de entrada', () => {
    const cs = Array.from({ length: 40 }, (_, i) => c(`dato ${i} zq${i}`, { importance: 3 }));
    const a = mergeGraphs([{ materialId: 'm1', graph: { concepts: cs, edges: [] } }]).graph.concepts;
    const b = mergeGraphs([{ materialId: 'm1', graph: { concepts: cs.slice().reverse(), edges: [] } }]).graph.concepts;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.filter((x) => x.importance === 5)).toHaveLength(2);
  });
});

// ─────────────────────────── 3. titulo del documento y encabezados genericos ───────────────────────────
describe('withoutTitleConcept: titulo casi exacto y encabezados genericos', () => {
  it('casi exacto: un error de tipeo del titulo tambien se quita', () => {
    const g = { concepts: [c('Demanda agregda', { mentions: 1 }), c('Oferta')], edges: [] };
    expect(withoutTitleConcept(g, 'Unidad 3 - Demanda agregada.pdf').concepts.map((x) => x.name)).toEqual(['Oferta']);
  });

  it('encabezados genericos (Introduccion, Bibliografia, Indice...) poco mencionados se quitan', () => {
    const g = { concepts: [c('Introducción', { mentions: 1 }), c('Bibliografía'), c('Índice'), c('Mesopotamia')], edges: [e('Mesopotamia', 'Introducción')] };
    const out = withoutTitleConcept(g, 'Doc2_Grecia.docx');
    expect(out.concepts.map((x) => x.name)).toEqual(['Mesopotamia']);
    expect(out.edges).toEqual([]);
  });

  it('pero un "Resumen" que es un concepto real (muy mencionado, o de otro tipo) se conserva', () => {
    const g = { concepts: [c('Resumen', { mentions: 9 }), c('Introducción', { kind: 'obra', mentions: 1 })], edges: [] };
    expect(withoutTitleConcept(g, 'Doc2_Grecia.docx')).toBe(g);
  });
});

// ─────────────────────────── 4. señal causal ampliada ───────────────────────────
describe('hasCausalCue: marcadores causales del español', () => {
  it('reconoce los de la especificacion (ya que, por ende, dio lugar a, como consecuencia, gracias a…)', () => {
    for (const t of ['Prosperó ya que el Nilo inundaba cada año.', 'Hubo hambre; por ende, migraron.', 'Dado que no llovía, fallaron las cosechas.', 'En consecuencia, cayó el imperio.', 'Esto dio origen a las ciudades.', 'La sequía hizo que migraran.', 'La guerra dio lugar a la paz.', 'Todo ocurrió porque faltaba agua.', 'Como consecuencia de la crecida, hubo limo.', 'Se fundó gracias a los canales.']) {
      expect(hasCausalCue(t), t).toBe(true);
    }
  });

  it('una mera mencion o una coordinacion NO es causal', () => {
    for (const t of ['El Nilo y los canales eran importantes.', 'Menes unificó el Alto y el Bajo Egipto.', 'Hammurabi reinó en Babilonia.']) expect(hasCausalCue(t), t).toBe(false);
  });
});
