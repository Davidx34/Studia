import { describe, expect, it } from 'vitest';
import { EVIDENCE_PROMPT_BLOCK, evidenceStatus, indexForQuotes, normForQuote, quoteInMaterial, rankChunks } from './evidence';
import { validateRevision, type Lot, type Revision } from './externalLoop';

const MATERIAL = ['Las preferencias tipo Leontief, llamadas también de bienes complementarios, son aquellas en las cuales el consumidor consume dos bienes en una proporción fija.', 'El multiplicador de Lagrange es la utilidad marginal del ingreso.'];
const NORM = indexForQuotes(MATERIAL);

describe('citas verificables', () => {
  it('normaliza tildes, mayusculas y puntuacion', () => {
    expect(normForQuote('  Las PREFERENCIAS, «tipo» Leontief… ')).toBe('las preferencias tipo leontief');
  });
  it('una cita literal (≥ 8 palabras) del material se verifica, aunque cambien tildes y puntuacion', () => {
    expect(quoteInMaterial('Las preferencias tipo Leontief llamadas tambien de bienes complementarios son aquellas', NORM)).toBe(true);
  });
  it('una cita parafraseada, inventada o demasiado corta NO se verifica', () => {
    expect(quoteInMaterial('Las preferencias Leontief son las de bienes que se consumen en proporciones fijas siempre', NORM)).toBe(false);
    expect(quoteInMaterial('Leontief proporción fija', NORM)).toBe(false); // < 8 palabras
    expect(quoteInMaterial('', NORM)).toBe(false);
  });
  it('estado de la evidencia de una pregunta: ausente, no verificada o verificada', () => {
    expect(evidenceStatus({ q: 'x' }, NORM)).toBe('sin_evidencia');
    expect(evidenceStatus({ evidence: 'Una frase inventada que el material jamas dijo en ninguna parte' }, NORM)).toBe('no_verificada');
    expect(evidenceStatus({ evidence: 'el consumidor consume dos bienes en una proporción fija' }, NORM)).toBe('verificada');
  });
  it('el bloque de prompt exige cita textual y prohibe calcular o deducir', () => {
    expect(EVIDENCE_PROMPT_BLOCK).toContain('"evidence"');
    expect(EVIDENCE_PROMPT_BLOCK).toContain('TEXTUALMENTE');
    expect(EVIDENCE_PROMPT_BLOCK).toContain('NO generes esa pregunta');
  });
  it('rankChunks ordena por terminos compartidos', () => {
    expect(rankChunks('multiplicador de Lagrange utilidad marginal', MATERIAL, 1)[0]).toContain('Lagrange');
  });
});

describe('validateRevision con exigencia de evidencia (criterio del profesor)', () => {
  const mc = (q: string, opts: string[], ok: number) => ({ type: 'multiple_choice', q, opts, ok, exp: 'Explicacion suficiente de la respuesta', concept_tag: 't' });
  const lot: Lot = { id: 'L', fecha: 'x', generador: 'g', arm: 'base', items: [{ id: 'a', module_id: 'm1', module_title: 'M', question: mc('¿Cómo se llaman las preferencias de bienes complementarios?', ['Lineales', 'Leontief', 'Cobb-Douglas', 'Cuasilineales'], 1) }] };
  const rev = (r: any): Revision => ({ revisor: 'x', fecha: 'y', lote: 'L', items: [r] });
  const opts = { material: (id: string) => (id === 'm1' ? NORM : undefined) };
  const buena = 'las preferencias tipo Leontief llamadas también de bienes complementarios son aquellas en las cuales el consumidor';

  it('«bueno» con cita literal verificable es valido', () => {
    expect(validateRevision(lot, rev({ id: 'a', veredicto: 'bueno', defectos: [], evidencia: buena }), opts)).toEqual([]);
  });
  it('«bueno» sin cita, con cita corta o con cita que NO esta en el material se rechaza', () => {
    expect(validateRevision(lot, rev({ id: 'a', veredicto: 'bueno', defectos: [] }), opts).join('|')).toContain('exige una cita literal');
    expect(validateRevision(lot, rev({ id: 'a', veredicto: 'bueno', defectos: [], evidencia: 'Leontief' }), opts).join('|')).toContain('exige una cita literal');
    expect(validateRevision(lot, rev({ id: 'a', veredicto: 'bueno', defectos: [], evidencia: 'Una frase que el material nunca contuvo en ningún párrafo' }), opts).join('|')).toContain('NO aparece literalmente');
  });
  it('«malo» (p. ej. no_explicito) no necesita cita', () => {
    const d = [{ code: 'no_explicito', severity: 'critico', quote: '¿Cómo se llaman las preferencias de bienes complementarios?', why: 'no esta' }];
    expect(validateRevision(lot, rev({ id: 'a', veredicto: 'malo', defectos: d }), opts)).toEqual([]);
  });
  it('si no se puede cargar el material, no se aprueba a ciegas', () => {
    expect(validateRevision(lot, rev({ id: 'a', veredicto: 'bueno', defectos: [], evidencia: buena }), { material: () => undefined }).join('|')).toContain('no se pudo cargar el material');
  });
  it('sin la opcion de material (lotes antiguos) el comportamiento anterior se conserva', () => {
    expect(validateRevision(lot, rev({ id: 'a', veredicto: 'bueno', defectos: [] }))).toEqual([]);
  });
});
