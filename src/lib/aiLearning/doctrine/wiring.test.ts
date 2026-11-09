import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildGenerationPrompt, resolveConfig } from '@/lib/questions/generationConfig';
import { SUGGESTION_PRINCIPLES, type SuggestionKind } from '../retrospective';
import { getPrinciple, principleBasis } from './index';

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('la doctrina en el prompt de generacion', () => {
  const base = { config: resolveConfig(null), moduleTitle: 'Tema', context: 'material', classicCount: 4, minigames: [] as string[] };
  it('APAGADA (por defecto) el prompt es identico al de siempre', () => {
    const sin = buildGenerationPrompt(base).prompt;
    expect(buildGenerationPrompt({ ...base, useDoctrine: false }).prompt).toBe(sin);
    expect(sin).not.toContain('CRITERIOS PEDAGÓGICOS');
  });
  it('ENCENDIDA agrega criterios y conducta, y solo eso (el resto del prompt no cambia)', () => {
    const sin = buildGenerationPrompt(base).prompt;
    const con = buildGenerationPrompt({ ...base, useDoctrine: true }).prompt;
    expect(con).toContain('CRITERIOS PEDAGÓGICOS DE REFERENCIA');
    expect(con).toContain('CONDUCTA ESPERADA');
    // Quitando el bloque agregado se recupera exactamente el prompt base.
    const bloque = con.slice(con.indexOf('CRITERIOS PEDAGÓGICOS'), con.indexOf('\n\n', con.indexOf('CONDUCTA ESPERADA')));
    expect(con.replace(`\n\n${bloque}`, '')).toBe(sin);
  });
  it('con la configuracion por defecto (opcion multiple) los criterios incluyen la redaccion de opcion multiple', () => {
    expect(buildGenerationPrompt({ ...base, useDoctrine: true }).prompt).toContain('En opción múltiple');
  });
  it('convive con el cuaderno del profesor: el cuaderno va primero y la doctrina despues', () => {
    const p = buildGenerationPrompt({ ...base, playbookBlock: 'REGLAS DE ESTILO APRENDIDAS EN ESTA CLASE (x)\n1. Regla del profesor', useDoctrine: true }).prompt;
    expect(p.indexOf('REGLAS DE ESTILO APRENDIDAS')).toBeGreaterThan(-1);
    expect(p.indexOf('REGLAS DE ESTILO APRENDIDAS')).toBeLessThan(p.indexOf('CRITERIOS PEDAGÓGICOS'));
  });
  it('los dos generadores consultan la bandera DOCTRINE (no la fijan a true)', () => {
    for (const f of ['src/app/api/generate-questions/route.ts', 'src/lib/questions/regeneratePool.ts']) {
      expect(read(f)).toContain('useDoctrine: doctrineEnabled()');
      expect(read(f)).not.toMatch(/useDoctrine:\s*true/);
    }
  });
});

describe('fundamento de las sugerencias de la retrospectiva', () => {
  const kinds: SuggestionKind[] = ['reinforce_module', 'reinforce_concept', 'review_question', 'review_judge', 'review_pending', 'collect_more_data'];
  it('todos los tipos de sugerencia tienen principios y todos existen en la doctrina', () => {
    for (const k of kinds) {
      expect(SUGGESTION_PRINCIPLES[k].length, k).toBeGreaterThan(0);
      for (const id of SUGGESTION_PRINCIPLES[k]) expect(getPrinciple(id), `${k} -> ${id}`).toBeDefined();
    }
  });
  it('cada principio de la retrospectiva se puede mostrar con sus citas', () => {
    for (const id of SUGGESTION_PRINCIPLES.reinforce_concept) expect(principleBasis(id)?.cites.length).toBeGreaterThan(0);
  });
  it('la pantalla de ciclos muestra el fundamento calculado al mostrar (no guardado)', () => {
    expect(read('src/app/(teacher)/teacher/classrooms/[id]/cycles/page.tsx')).toContain('SUGGESTION_PRINCIPLES');
    expect(read('src/app/(teacher)/teacher/classrooms/[id]/cycles/CyclesClient.tsx')).toContain('Fundamento:');
  });
});

describe('pantalla de doctrina', () => {
  const page = read('src/app/(teacher)/teacher/classrooms/[id]/doctrina/page.tsx');
  it('dice con claridad si se aplica o no, y muestra fuentes con su verificacion y los limites', () => {
    expect(page).toContain('doctrineEnabled()');
    expect(page).toContain('Todavía NO se aplica');
    expect(page).toContain('fuente verificada');
    expect(page).toContain('Límites');
  });
  it('no inyecta HTML y exige sesion', () => {
    expect(page).not.toContain('dangerouslySetInnerHTML');
    expect(page).toContain("redirect('/login')");
  });
  it('tiene su pestana en la clase', () => {
    expect(read('src/app/(teacher)/teacher/classrooms/[id]/ClassroomTabs.tsx')).toContain('/doctrina');
  });
});
