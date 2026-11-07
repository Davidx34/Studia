import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');
const mig = read('supabase/migrations/100_research_routes.sql').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const action = read('src/lib/actions/research.ts');
const client = read('src/app/(teacher)/teacher/classrooms/[id]/research/ResearchClient.tsx');

describe('migracion 100', () => {
  it('RLS solo del profesor dueno, sin acceso anonimo, y con limites de tamano', () => {
    expect(mig).toContain('ALTER TABLE public.research_routes ENABLE ROW LEVEL SECURITY;');
    expect((mig.match(/CREATE POLICY/g) ?? []).length).toBe(1);
    expect(mig).toContain('c.teacher_id = (SELECT auth.uid())');
    expect(mig).toContain('REVOKE ALL ON public.research_routes FROM anon;');
    expect(mig).toContain('jsonb_array_length(sources) <= 12');
    expect(mig).toContain('length(answer) BETWEEN 1 AND 12000');
  });
});

describe('accion de ruta de investigacion', () => {
  it('comprueba la propiedad de la clase y el tope diario ANTES de llamar a la IA', () => {
    const iOwn = action.indexOf("eq('teacher_id', user.id)");
    const iLimit = action.indexOf('DAILY_LIMIT) return');
    const iAi = action.indexOf('geminiGenerate({');
    expect(iOwn).toBeGreaterThan(-1);
    expect(iOwn).toBeLessThan(iLimit);
    expect(iLimit).toBeLessThan(iAi);
  });
  it('usa Google Search y NO guarda nada si la busqueda no devolvio fuentes', () => {
    expect(action).toContain('tools: [{ google_search: {} }]');
    expect(action).toContain('grounding.chunks.length === 0');
    expect(action.indexOf('grounding.chunks.length === 0')).toBeLessThan(action.indexOf(".from('research_routes').insert"));
  });
  it('anota las citas sobre el texto ORIGINAL y solo despues lo limpia para mostrar', () => {
    expect(action.indexOf('annotateCitations(out.text')).toBeLessThan(action.indexOf('sanitizeDisplayText(annotated'));
  });
  it('las fuentes no entran al material del curso (RAG): no se toca ninguna tabla de materiales', () => {
    expect(action).not.toMatch(/teaching_materials|material_chunks|class_memory/);
  });
  it('un archivo use server solo exporta funciones async (una constante exportada rompe el build)', () => {
    expect(action).not.toMatch(/^export const /m);
  });
});

describe('pantalla', () => {
  it('muestra los enlaces como externos y no ejecuta el texto de la web (texto plano)', () => {
    expect(client).toContain('rel="noopener noreferrer nofollow"');
    expect(client).not.toContain('dangerouslySetInnerHTML');
  });
  it('avisa cuando poco del texto tiene fuente y que son sugerencias, no material del curso', () => {
    expect(client).toContain('cited_ratio < 0.3');
    expect(client).toContain('no son material del curso');
  });
});
