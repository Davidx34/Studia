import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { ChoiceQuestion, AnswerFeedback, optionState, choiceResult, correctChoiceText } from './ChoiceQuestion';

const render = (props: Record<string, unknown>) => renderToStaticMarkup(h(ChoiceQuestion as any, { onAnswer: () => {}, ...props }));
const mc = { kind: 'multiple_choice', options: ['A. Oferta', 'B. Demanda', 'C. Precio'], correct: 1 };

describe('optionState', () => {
  it('antes de responder todas son neutras (no se revela la correcta)', () => {
    expect(optionState(false, false, true)).toBe('idle');
    expect(optionState(false, true, false)).toBe('idle');
  });

  it('despues de responder: la elegida equivocada se marca, y la correcta SIEMPRE se revela', () => {
    expect(optionState(true, true, false)).toBe('wrong');
    expect(optionState(true, false, true)).toBe('right');
    expect(optionState(true, true, true)).toBe('right');
    expect(optionState(true, false, false)).toBe('idle');
  });
});

describe('choiceResult / correctChoiceText', () => {
  it('sin responder no hay resultado', () => expect(choiceResult(false, 1, 1)).toBeNull());
  it('acierto y fallo', () => {
    expect(choiceResult(true, 1, 1)).toBe(true);
    expect(choiceResult(true, 0, 1)).toBe(false);
    expect(choiceResult(true, false, true)).toBe(false);
  });
  it('texto de la respuesta correcta', () => {
    expect(correctChoiceText('multiple_choice', ['A', 'B'], 1)).toBe('B');
    expect(correctChoiceText('multiple_choice', ['A', 'B'], undefined)).toBeNull();
    expect(correctChoiceText('true_false', [], true)).toBe('Verdadero');
    expect(correctChoiceText('true_false', [], false)).toBe('Falso');
  });
});

describe('ChoiceQuestion', () => {
  it('opcion multiple: un grupo con una opcion por boton, todas habilitadas antes de responder', () => {
    const html = render({ ...mc, selected: null, answered: false });
    expect(html).toContain('role="group"');
    expect(html.match(/<button/g)!.length).toBe(3);
    expect(html).not.toContain(' disabled=""');
    expect(html).not.toContain('(correcta)');
  });

  it('REGRESION: tras fallar, la elegida lleva icono Y texto "incorrecta" y la correcta se revela con "correcta" (no solo color)', () => {
    const html = render({ ...mc, selected: 0, answered: true });
    expect(html).toContain('(tu respuesta, incorrecta)');
    expect(html).toContain('(correcta)');
    expect(html.match(/<svg/g)!.length).toBe(2);
    expect(html.match(/ disabled=""/g)!.length).toBe(3); // ya no se puede volver a responder
  });

  it('acertando no aparece ninguna marca de error', () => {
    const html = render({ ...mc, selected: 1, answered: true });
    expect(html).toContain('(correcta)');
    expect(html).not.toContain('incorrecta');
  });

  it('verdadero/falso: dos botones con el texto, y el area tactil es amplia', () => {
    const html = render({ kind: 'true_false', options: [], selected: null, answered: false, correct: true });
    expect(html).toContain('Verdadero');
    expect(html).toContain('Falso');
    expect(html).toContain('min-h-[48px]');
  });

  it('las opciones cumplen foco visible y respetan reduced-motion', () => {
    const html = render({ ...mc, selected: null, answered: false });
    expect(html).toContain('focus-visible:ring-2');
    expect(html).toContain('motion-reduce:transition-none');
  });

  it('no usa colores fijos: solo tokens', () => {
    const html = render({ ...mc, selected: 0, answered: true });
    expect(html).not.toMatch(/bg-(green|red|gray|purple)-|text-white/);
  });
});

describe('AnswerFeedback', () => {
  const fb = (p: Record<string, unknown>) => renderToStaticMarkup(h(AnswerFeedback as any, p));

  it('la region viva existe SIEMPRE (aria-live solo anuncia cambios de una region que ya estaba)', () => {
    const html = fb({ result: null, correctText: null });
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('Correcto');
  });

  it('acierto', () => expect(fb({ result: true, correctText: null })).toContain('¡Correcto!'));

  it('fallo: dice cual era la correcta', () => {
    const html = fb({ result: false, correctText: 'B. Demanda' });
    expect(html).toContain('Incorrecto');
    expect(html).toContain('Demanda');
  });
});

describe('la leccion', () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'src/app/(student)/lesson/[id]/page.tsx'), 'utf8').replace(/\r\n/g, '\n');

  it('muestra el XP que otorgo el SERVIDOR, no siempre base_xp_reward (al repetir un modulo el servidor da 0)', () => {
    expect(page).toContain('setXpGranted(Number(granted ?? 0))');
    expect(page).toContain('Ya habías ganado el XP de este módulo.');
    expect(page).not.toMatch(/\+\{mod\.base_xp_reward\} XP ganados/);
  });

  it('el bonus de repaso mostrado es el que el servidor otorgo', () => {
    expect(page).toContain('setRemediationBonusXp(grantedBonus)');
  });

  it('las preguntas clasicas y los estados finales usan tokens, no colores fijos', () => {
    const body = page.slice(page.indexOf('if (loading) return ('));
    expect(body).not.toMatch(/\btext-white\b|\bbg-gray-|\bbg-green-|\bbg-purple-|\btext-gray-|\bbg-red-/);
  });

  it('usa ChoiceQuestion y AnswerFeedback', () => {
    expect(page).toContain('<ChoiceQuestion');
    expect(page).toContain('<AnswerFeedback');
  });
});
