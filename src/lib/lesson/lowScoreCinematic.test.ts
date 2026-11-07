import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

// Reporte del dueño (2026-11-07): «la animacion de cuando sale un mal puntaje no esta». Causa: con puntaje bajo y conceptos debiles, finishModule ofrecia el repaso y hacia `return` sin
// poner en cola la escena del resultado (module_complete_low).
describe('animacion de puntaje bajo', () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'src/app/(student)/lesson/[id]/page.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const finish = page.slice(page.indexOf('const finishModule = async () => {'), page.indexOf('const handleRemediationSkip'));
  it('el camino que ofrece el repaso TAMBIEN pone en cola la escena del resultado, antes de ofrecerlo', () => {
    const offered = finish.indexOf("setRemediationPhase('offered')");
    expect(offered).toBeGreaterThan(-1);
    const queued = finish.lastIndexOf('setCinematicQueue(queue);', offered);
    expect(queued).toBeGreaterThan(-1);
    expect(queued).toBeLessThan(offered);
  });
  it('la cola es module_complete_low por debajo de 70 % y good desde 70 %', () => {
    expect(finish).toContain("[scorePercent >= 70 ? 'module_complete_good' : 'module_complete_low']");
  });
  it('en el render la escena va ANTES del ofrecimiento del repaso', () => {
    expect(page.indexOf('if (cinematicQueue.length > 0) return (')).toBeLessThan(page.indexOf("if (remediationPhase === 'offered') return ("));
  });
  it('la escena de puntaje bajo existe y tiene clip publicado por codigo o por base (SCENES + CINEMATIC_TYPES)', () => {
    const scene = fs.readFileSync(path.join(process.cwd(), 'src/components/cinematics/CinematicScene.tsx'), 'utf8');
    expect(scene).toContain('module_complete_low: {');
    const types = fs.readFileSync(path.join(process.cwd(), 'src/lib/tonito/scenes.ts'), 'utf8');
    expect(types).toContain("'module_complete_low'");
  });
});
