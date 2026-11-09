import { describe, expect, it } from 'vitest';
import { CATEGORIES } from './errorTaxonomy';
import { RULE_SETS, ruleSetNames, toPlaybookRules } from './experimentRules';
import { MAX_RULES, MAX_RULE_CHARS, sanitizeRules } from './playbook';

describe('conjuntos de reglas candidatas', () => {
  it('cada regla cabe en un cuaderno: texto valido, sin duplicados y dentro del tope', () => {
    for (const name of ruleSetNames()) {
      const set = RULE_SETS[name];
      expect(set.length).toBeLessThanOrEqual(MAX_RULES);
      for (const r of set) expect(r.text.length).toBeLessThanOrEqual(MAX_RULE_CHARS);
      // sanitizeRules no debe descartar ni modificar ninguna: lo que se mide es lo que se activaria.
      expect(sanitizeRules(set.map(({ text }) => ({ text }))).map((r) => r.text)).toEqual(set.map((r) => r.text));
    }
  });
  it('cada regla apunta a una categoria de error ATRIBUIBLE AL GENERADOR y tiene fundamento', () => {
    for (const r of Object.values(RULE_SETS).flat()) {
      expect(CATEGORIES[r.targets].origin).toBe('generador');
      expect(r.basis.length).toBeGreaterThan(20);
    }
  });
  it('toPlaybookRules entrega solo el texto y rechaza nombres desconocidos', () => {
    expect(toPlaybookRules('item_writing_v1')[0]).toEqual({ text: RULE_SETS.item_writing_v1[0].text });
    expect(() => toPlaybookRules('no_existe')).toThrow();
  });
  it('item_writing_v1 cubre los cinco errores mas frecuentes del generador en la linea base', () => {
    const targets = new Set(RULE_SETS.item_writing_v1.map((r) => r.targets));
    for (const c of ['error_conceptual_o_calculo', 'anclaje_material', 'ambiguedad_respuesta_unica', 'no_autocontenida', 'respuesta_no_evaluable'] as const) expect(targets.has(c)).toBe(true);
  });
});
