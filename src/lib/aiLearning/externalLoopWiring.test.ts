import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n');

describe('script del bucle con juez externo (scripts/lote.ts)', () => {
  const s = read('scripts/lote.ts');
  const antesDeAplicar = s.slice(0, s.indexOf('async function aplicar'));
  it('solo `aplicar` escribe en la base, y solo con --db', () => {
    expect(antesDeAplicar).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    const aplicar = s.slice(s.indexOf('async function aplicar'), s.indexOf('(async () => {'));
    expect(aplicar).toContain("process.argv.includes('--db')");
    expect(aplicar.indexOf("if (!enDb) return")).toBeLessThan(aplicar.indexOf('.insert('));
  });
  it('exige una revision VALIDA antes de aplicar', () => {
    const aplicar = s.slice(s.indexOf('async function aplicar'), s.indexOf('(async () => {'));
    expect(aplicar).toContain('validateRevision(lot, rev)');
    expect(aplicar.indexOf('validateRevision(lot, rev)')).toBeLessThan(aplicar.indexOf('.insert('));
  });
  it('regla asimetrica: retirar una mala es siempre posible; aprobar exige que el revisor este VALIDADO', () => {
    const aplicar = s.slice(s.indexOf('async function aplicar'), s.indexOf('(async () => {'));
    expect(aplicar).toContain("review_status: 'rejected'");
    expect(aplicar).toContain("if (estado === 'approved')");
    expect(aplicar).toContain('bankStatusFor(validacion.status)');
    // Sin validacion, lo nuevo entra como estado de bankStatusFor (human_review), nunca como 'approved' fijo.
    expect(aplicar).not.toMatch(/review_status: 'approved'[^}]*insert/);
  });
  it('toda pregunta revisada deja una fila en ai_question_revisions (permite revertir y validar al revisor)', () => {
    expect(s).toContain("from('ai_question_revisions').insert");
    expect(s).toContain("from('ai_quality_rounds').upsert");
  });
  it('--solo-registrar no modifica ninguna pregunta: la rama de escritura del banco queda detras de «else» (validacion prospectiva)', () => {
    const aplicar = s.slice(s.indexOf('async function aplicar'), s.indexOf('(async () => {'));
    const iSolo = aplicar.indexOf('if (soloRegistrar) {');
    expect(iSolo).toBeGreaterThan(-1);
    // Toda escritura a lesson_questions ocurre despues de la rama soloRegistrar y dentro de su cadena else.
    for (const m of aplicar.matchAll(/from('lesson_questions').(update|insert)/g)) expect(m.index!).toBeGreaterThan(iSolo);
    expect(aplicar.slice(iSolo, iSolo + 200)).toContain('} else if (it.bankId)');
  });
  it('la generacion local y la exportacion del banco son de solo lectura', () => {
    const gen = s.slice(s.indexOf('async function generar'), s.indexOf('function load('));
    expect(gen).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });
});

describe('privacidad: el contenido real de las clases no se publica', () => {
  it('.gitignore excluye lotes (preguntas y revisiones) y la muestra ciega con su clave', () => {
    const g = read('.gitignore');
    expect(g).toContain('memoria-calidad/lotes/');
    expect(g).toContain('memoria-calidad/auditorias/*-clave.json');
  });
  it('las rondas guardadas contienen solo numeros y codigos (sin texto de preguntas)', () => {
    const dir = path.join(process.cwd(), 'memoria-calidad', 'rondas');
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const t = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(t).not.toMatch(/"(q|opts|question|exp)":|"pairs":\s*\[/);
    }
  });
});

describe('migracion 103', () => {
  const sql = read('supabase/migrations/103_juez_externo.sql');
  it('es aditiva y deja las tablas nuevas solo para el servidor (RLS sin politicas)', () => {
    expect(sql).toContain('ALTER TABLE public.ai_question_revisions ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE public.ai_quality_rounds ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toContain('CREATE POLICY');
    expect(sql).not.toMatch(/DELETE FROM|DROP TABLE public\.(lesson_questions|ai_feedback_events)/i);
  });
  it('el trigger mapea external_ai a la senal external', () => {
    expect(sql).toContain("WHEN 'external_ai' THEN 'external'");
  });
});
