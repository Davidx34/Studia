import { describe, it, expect } from 'vitest';
import { describeExtraction } from './extractionLabel';

describe('describeExtraction', () => {
  it('materiales sin metodo (anteriores o no PDF): nada que decir', () => {
    expect(describeExtraction(null, null)).toBeNull();
    expect(describeExtraction(undefined, {})).toBeNull();
  });

  it('conversion con IA correcta', () => {
    const r = describeExtraction('vision_gemini', { pages: 47, warnings: [] })!;
    expect(r.tone).toBe('ok');
    expect(r.text).toContain('47 páginas');
    expect(r.text).toMatch(/fórmulas/);
  });

  it('texto simple: advierte y muestra el motivo', () => {
    const r = describeExtraction('plain_text', { warnings: ['Se uso el texto simple: se agoto la cuota diaria gratuita de Gemini.'] })!;
    expect(r.tone).toBe('warn');
    expect(r.text).toMatch(/pueden faltar/);
    expect(r.text).toContain('cuota diaria');
  });

  it('conversion con IA pero con tandas fallidas: aviso, no exito limpio', () => {
    const r = describeExtraction('vision_mixed', { pages: 10, warnings: ['1 de 3 tandas fallaron; revisa que no falten paginas.'] })!;
    expect(r.tone).toBe('warn');
  });

  it('un informe ausente o mal formado no rompe la pantalla', () => {
    expect(describeExtraction('vision_gemini', null)!.tone).toBe('ok');
    expect(describeExtraction('plain_text', 'basura')!.tone).toBe('warn');
  });
});
