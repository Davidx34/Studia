import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DEFAULT_FICHA_TEMPLATE, FICHA_TEMPLATES, SAMPLE_FICHAS, isFichaTemplateId, normalizeFichaTemplate } from './fichaTemplates';

// La misma regla que el CHECK de la migracion 075: el id es solo una forma, el catalogo vive en codigo.
const ID_FORMAT = /^[a-z][a-z0-9-]{0,31}$/;

describe('catalogo de plantillas de fichas', () => {
  it('las 4 funcionales van primero (la clasica, la de siempre) y los ids son unicos', () => {
    expect(FICHA_TEMPLATES.slice(0, 4).map((t) => t.id)).toEqual(['clasica', 'tarjeta', 'cornell', 'compacta']);
    expect(new Set(FICHA_TEMPLATES.map((t) => t.id)).size).toBe(FICHA_TEMPLATES.length);
    expect(DEFAULT_FICHA_TEMPLATE).toBe('clasica');
  });

  it('cada plantilla tiene nombre, descripcion y para que sirve, y su id pasa el CHECK de la base', () => {
    for (const t of FICHA_TEMPLATES) {
      expect(t.id).toMatch(ID_FORMAT);
      expect(t.name.length).toBeGreaterThan(2);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.bestFor.length).toBeGreaterThan(10);
    }
  });

  it('la migracion 075 usa la misma regla de id y el mismo valor por defecto que el codigo', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/075_classroom_ficha_template.sql'), 'utf8');
    expect(sql).toContain(String.raw`'^[a-z][a-z0-9-]{0,31}$'`);
    expect(sql).toContain(`DEFAULT '${DEFAULT_FICHA_TEMPLATE}'`);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS ficha_template/);
  });
});

describe('normalizeFichaTemplate: nunca rompe la pantalla', () => {
  it('un id conocido se respeta', () => {
    for (const t of FICHA_TEMPLATES) expect(normalizeFichaTemplate(t.id)).toBe(t.id);
    expect(isFichaTemplateId('cornell')).toBe(true);
  });

  it('lo desconocido o ausente cae en la clasica (columna sin migrar, plantilla retirada, dato corrupto)', () => {
    for (const v of [null, undefined, '', 'desaparecida', 'CORNELL', 42, {}, [], 'clasica ']) {
      expect(normalizeFichaTemplate(v), String(v)).toBe('clasica');
    }
    expect(isFichaTemplateId('desaparecida')).toBe(false);
  });
});

describe('fichas de ejemplo para la vista previa', () => {
  it('hay al menos 2, con todos los campos, y una lleva formula', () => {
    expect(SAMPLE_FICHAS.length).toBeGreaterThanOrEqual(2);
    for (const f of SAMPLE_FICHAS) {
      expect(f.front.length).toBeGreaterThan(3);
      expect(f.back.length).toBeGreaterThan(20);
      expect(f.extra?.puntos_clave?.length).toBeGreaterThanOrEqual(2);
      expect(f.extra?.terminos?.length).toBeGreaterThanOrEqual(1);
      expect(f.extra?.reflexion).toBeTruthy();
    }
    expect(SAMPLE_FICHAS.some((f) => JSON.stringify(f).includes('$'))).toBe(true);
  });

  it('las formulas conservan sus barras (una barra simple en un string de TS se vuelve tabulador o salto de pagina sin avisar)', () => {
    const todo = SAMPLE_FICHAS.flatMap((f) => [f.front, f.back, ...(f.extra?.puntos_clave ?? []), f.extra?.reflexion ?? '']).join('\n');
    expect(todo).not.toMatch(/[\t\f\v\b]/);
    expect(todo).toContain(String.raw`\frac`);
    expect(todo).toContain(String.raw`\lim`);
  });

  it('ids unicos', () => {
    expect(new Set(SAMPLE_FICHAS.map((f) => f.id)).size).toBe(SAMPLE_FICHAS.length);
  });
});
