import { describe, it, expect } from 'vitest';
import { describeExtraction } from './extractionLabel';

describe('describeExtraction', () => {
  it('materiales sin metodo (anteriores o no PDF): nada que decir', () => {
    expect(describeExtraction(null, null)).toBeNull();
    expect(describeExtraction(undefined, {})).toBeNull();
  });

  it('PDF de texto convertido sin IA', () => {
    const r = describeExtraction('deterministic', { pages: 12, risky_pages: 0, warnings: [] })!;
    expect(r.tone).toBe('ok');
    expect(r.text).toMatch(/sin necesidad de IA/);
    expect(r.text).toContain('12 páginas');
  });

  it('hibrido: cuenta las paginas transcritas y verificadas', () => {
    const r = describeExtraction('hybrid', { pages: 47, risky_pages: 40, ai_pages_accepted: 38, warnings: [] })!;
    expect(r.tone).toBe('ok');
    expect(r.text).toContain('38 de 40');
    expect(r.text).toMatch(/verificaron automáticamente/);
  });

  it('hibrido con paginas que no pasaron la verificacion: aviso', () => {
    const r = describeExtraction('hybrid', { pages: 10, risky_pages: 8, ai_pages_accepted: 6, warnings: ['2 de 8 paginas quedaron como texto simple.'] })!;
    expect(r.tone).toBe('warn');
    expect(r.text).toContain('2 de 8');
  });

  it('deterministic con paginas de riesgo (la IA no pudo): advierte que faltan formulas y graficos', () => {
    const r = describeExtraction('deterministic', { pages: 10, risky_pages: 7, warnings: ['Se agoto la cuota.'] })!;
    expect(r.tone).toBe('warn');
    expect(r.text).toMatch(/7 páginas con fórmulas o gráficos/);
  });

  it('metodos anteriores siguen mostrandose bien', () => {
    expect(describeExtraction('vision_gemini', { pages: 47, warnings: [] })!.tone).toBe('ok');
    expect(describeExtraction('plain_text', { warnings: ['x'] })!.tone).toBe('warn');
  });

  it('un informe ausente o mal formado no rompe la pantalla', () => {
    expect(describeExtraction('hybrid', null)!.tone).toBe('ok');
    expect(describeExtraction('plain_text', 'basura')!.tone).toBe('warn');
    expect(describeExtraction('metodo_desconocido', {})).toBeNull();
  });
});
