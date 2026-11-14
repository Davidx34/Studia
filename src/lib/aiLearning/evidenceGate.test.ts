import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { CLASSIC_TYPES, evidenceColumns, evidenceRequired, gateEvidence, stripEvidence, withEvidenceBlock } from './evidenceGate';
import { EVIDENCE_PROMPT_BLOCK, plainMath, quoteInMaterial, indexForQuotes } from './evidence';

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n');
const ON = { EVIDENCE_REQUIRED: 'on' };
const CONTEXTO = 'Las preferencias tipo Leontief, llamadas también de bienes complementarios, son aquellas en las cuales el consumidor consume dos bienes en una proporción fija. Ellas dependen de los parámetros $p_x, p_y \\ y \\ W$ del problema. Las demandas son $x^* = \\frac{\\alpha K}{p_x}$ para el bien x.';
const mc = (evidence?: string) => ({ type: 'multiple_choice', q: '¿Cuál?', opts: ['a', 'b'], ok: 0, ...(evidence !== undefined ? { evidence } : {}) });

describe('verificacion tolerante a LaTeX', () => {
  it('plainMath quita el formato y nombra los simbolos', () => {
    expect(plainMath('$\\frac{\\alpha K}{p_x}$').replace(/\s+/g, ' ').trim()).toBe('alpha K p x');
    expect(plainMath('≽ y α').replace(/\s+/g, ' ').trim()).toBe('succeq y alpha');
  });
  it('una cita con simbolos Unicode o sin LaTeX se verifica contra material en LaTeX', () => {
    const norm = indexForQuotes([CONTEXTO]);
    expect(quoteInMaterial('Ellas dependen de los parámetros p_x, p_y y W del problema', norm)).toBe(true);
    expect(quoteInMaterial('Las demandas son x* = α K / p_x para el bien x', norm)).toBe(true);
  });
  it('sigue rechazando citas inventadas o parafraseadas', () => {
    const norm = indexForQuotes([CONTEXTO]);
    expect(quoteInMaterial('Las preferencias Leontief son siempre bienes que se consumen en proporciones fijas', norm)).toBe(false);
  });
});

describe('interruptor EVIDENCE_REQUIRED (apagado por defecto)', () => {
  it('apagado: no cambia el prompt, no descarta nada y no escribe columnas', () => {
    expect(evidenceRequired({})).toBe(false);
    expect(withEvidenceBlock('REGLAS', {})).toBe('REGLAS');
    const qs = [mc(), mc('inventada sin sentido que el material no dice en ninguna parte')];
    expect(gateEvidence(qs, CONTEXTO, {}).kept).toHaveLength(2);
    expect(evidenceColumns(qs[1], {})).toEqual({});
  });
  it('encendido: el prompt agrega la regla de evidencia', () => {
    expect(withEvidenceBlock('REGLAS', ON)).toBe(`REGLAS\n\n${EVIDENCE_PROMPT_BLOCK}`);
    expect(withEvidenceBlock('', ON)).toBe(EVIDENCE_PROMPT_BLOCK);
  });
  it('encendido: solo pasan las clasicas con cita literal; descarta sin evidencia y con cita no literal; conserva minijuegos', () => {
    const buena = mc('Las preferencias tipo Leontief, llamadas también de bienes complementarios, son aquellas en las cuales el consumidor');
    const sin = mc();
    const falsa = mc('Una frase inventada que el material nunca dijo en ningún párrafo del documento');
    const juego = { type: 'cuarto_crisis', q: 'x', game_data: {} };
    const r = gateEvidence([buena, sin, falsa, juego], CONTEXTO, ON);
    expect(r.kept).toEqual([buena, juego]);
    expect(r).toMatchObject({ dropped: 2, droppedNoEvidence: 1, droppedNotLiteral: 1 });
    expect(CLASSIC_TYPES.has('cuarto_crisis')).toBe(false);
  });
  it('guarda la cita verificada (recortada a 800) solo encendido, y NUNCA la sirve al estudiante', () => {
    expect(evidenceColumns({ evidence: '  una cita  ' }, ON)).toEqual({ evidence: 'una cita', evidence_status: 'verified' });
    expect(evidenceColumns({ evidence: 'x'.repeat(2000) }, ON).evidence).toHaveLength(800);
    expect(evidenceColumns({}, ON)).toEqual({ evidence: null, evidence_status: null });
    expect(stripEvidence({ id: '1', q: 'p', evidence: 'secreto', evidence_status: 'verified' })).toEqual({ id: '1', q: 'p' });
  });
});

describe('cableado', () => {
  const route = read('src/app/api/generate-questions/route.ts');
  const regen = read('src/lib/questions/regeneratePool.ts');
  it('los dos puntos de generacion aplican la compuerta ANTES de la de calificacion (JEV) y agregan la regla al prompt', () => {
    for (const s of [route, regen]) {
      expect(s).toContain('withEvidenceBlock(playbookBlock)');
      expect(s.indexOf('gateEvidence(structurallyValid, context)')).toBeGreaterThan(-1);
      expect(s.indexOf('gateEvidence(structurallyValid, context)')).toBeLessThan(s.indexOf('gateGenerated(evGate.kept)'));
      expect(s).toContain('...evidenceColumns(q)');
    }
  });
  it('lo que se sirve al estudiante pasa por stripEvidence (la cita contiene la respuesta)', () => {
    expect(route).toContain('validGenerated.map(stripEvidence)');
    expect(route).toContain('...stripEvidence(q), id: inserted[i].id');
  });
  it('la migracion 104 es aditiva, nullable y acotada', () => {
    const sql = read('supabase/migrations/104_evidencia_en_preguntas.sql');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS evidence text');
    expect(sql).toContain('char_length(evidence) <= 800');
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|NOT NULL/);
  });
  it('la pantalla de revision muestra la cita solo si esta verificada', () => {
    const ui = read('src/app/(teacher)/teacher/classrooms/[id]/review/ReviewClient.tsx');
    expect(ui).toContain("q.evidence && q.evidence_status === 'verified'");
  });
});

describe('reglas de redaccion aprendidas del profesor', () => {
  const buena = (ev: string, q = '¿Cuál?') => ({ type: 'multiple_choice', q, opts: ['a', 'b'], ok: 0, evidence: ev });
  const ctx = 'La condición de primer orden exige que el valor del producto marginal sea igual al precio del insumo. Los costos fijos son los generados por factores fijos de producción en el corto plazo.';
  it('descarta fragmentos cortados en dos puntos y citas repetidas del lote', () => {
    const a = buena('La condición de primer orden exige que el valor del producto marginal sea igual al precio del insumo');
    const rep = buena('condición de primer orden exige que el valor del producto marginal sea igual al precio del insumo.');
    const frag = buena('Los costos fijos son los generados por factores fijos de producción en el corto plazo', '¿Qué indica la frase:');
    const r = gateEvidence([a, rep, frag], ctx, ON);
    expect(r.kept).toEqual([a]);
    expect(r).toMatchObject({ droppedDuplicate: 1, droppedFragment: 1 });
  });
  it('el prompt incluye las reglas de redaccion', () => {
    expect(EVIDENCE_PROMPT_BLOCK).toContain('REGLAS DE REDACCION');
  });
});
