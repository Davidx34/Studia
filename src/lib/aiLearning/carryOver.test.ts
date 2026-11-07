import { describe, expect, it } from 'vitest';
import { mergeRules, nextCycleChecklist } from './carryOver';
import type { Suggestion } from './retrospective';

const sug = (id: string, status: Suggestion['status']): Suggestion => ({ id, kind: 'reinforce_concept', text: `Tarea ${id}`, evidence: `dato ${id}`, status });

describe('mergeRules', () => {
  it('las reglas existentes mandan y las importadas se agregan sin duplicar', () => {
    const r = mergeRules(['Incluye el dato numerico'], ['incluye el dato numerico', 'Usa unidades en cada calculo']);
    expect(r.rules.map((x) => x.text)).toEqual(['Incluye el dato numerico', 'Usa unidades en cada calculo']);
    expect(r.added).toBe(1);
    expect(r.skipped).toBe(1);
  });
  it('respeta el tope de 10 y cuenta lo que no entro', () => {
    const existing = Array.from({ length: 8 }, (_, i) => `Regla existente numero ${i}`);
    const incoming = Array.from({ length: 5 }, (_, i) => `Regla importada numero ${i}`);
    const r = mergeRules(existing, incoming);
    expect(r.rules).toHaveLength(10);
    expect(r.added).toBe(2);
    expect(r.skipped).toBe(3);
  });
  it('entradas invalidas no rompen', () => {
    expect(mergeRules(null, undefined)).toEqual({ rules: [], added: 0, skipped: 0 });
  });
});

describe('nextCycleChecklist', () => {
  it('sin retrospectivas no hay tareas', () => {
    expect(nextCycleChecklist([])).toEqual([]);
  });
  it('toma solo la retrospectiva mas reciente, arrastra aceptadas y pospuestas (aceptadas primero) y no las rechazadas ni pendientes', () => {
    const items = nextCycleChecklist([
      { label: '2027-II', suggestions: [sug('1', 'postponed'), sug('2', 'rejected'), sug('3', 'accepted'), sug('4', 'pending')] },
      { label: '2027-I', suggestions: [sug('9', 'accepted')] },
    ]);
    expect(items.map((i) => i.text)).toEqual(['Tarea 3', 'Tarea 1']);
    expect(items.every((i) => i.from === '2027-II')).toBe(true);
  });
});
