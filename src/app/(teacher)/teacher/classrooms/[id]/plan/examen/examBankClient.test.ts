import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReviewGroup } from '@/lib/blueprint/examReviewView';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
import ExamBankClient from './ExamBankClient';

const item = (over: Partial<ReviewGroup['items'][number]>): ReviewGroup['items'][number] => ({
  id: 'q1', status: 'pending', type: 'multiple_choice', typeLabel: 'Opcion multiple', q: 'Que es la elasticidad?', options: [{ text: 'A. x', correct: false }, { text: 'B. y', correct: true }], key: '',
  exp: 'Porque mide la reaccion de la cantidad al precio.', quote: 'mide cuanto cambia la cantidad', materialName: 'Guia.pdf', chunk: 2, moduleTitle: 'Elasticidad', periodName: 'Corte 1',
  verdictLabel: 'El juez la respalda', attention: false, problems: [], ...over,
});
const group = (items: ReviewGroup['items'], over: Partial<ReviewGroup> = {}): ReviewGroup => ({ outcomeId: 'o1', statement: 'Comprende la elasticidad', approved: 0, pending: items.length, rejected: 0, items, ...over });
const html = (groups: ReviewGroup[], tableMissing = false) => renderToStaticMarkup(createElement(ExamBankClient, { classroomId: 'c', tableMissing, groups, modulesByOutcome: { o1: [{ id: 'm1', title: 'Elasticidad' }] } }));

describe('ExamBankClient (marcado)', () => {
  it('muestra la pregunta con clave, explicacion, material y cita, y los botones solo si esta pendiente', () => {
    const h = html([group([item({}), item({ id: 'q2', status: 'approved', q: 'Otra' })])]);
    expect(h).toContain('Que es la elasticidad?');
    expect(h).toContain('(respuesta correcta)');
    expect(h).toContain('Guia.pdf');
    expect(h).toContain('mide cuanto cambia la cantidad');
    expect((h.match(/Aprobar/g) ?? []).length).toBe(1);
    expect((h.match(/Rechazar/g) ?? []).length).toBe(1);
  });
  it('avisa cuando el juez no respalda y lista sus motivos', () => {
    const h = html([group([item({ attention: true, verdictLabel: 'El juez no pudo decidir: revisala con atencion', problems: ['afirmacion sin respaldo'] })])]);
    expect(h).toContain('revisala con atencion');
    expect(h).toContain('afirmacion sin respaldo');
  });
  it('una comprension sin aprobadas dice que no se puede examinar', () => {
    expect(html([group([])])).toContain('no se puede examinar');
    expect(html([group([item({ status: 'approved' })], { approved: 1, pending: 0 })])).not.toContain('no se puede examinar');
  });
  it('sin tabla, un mensaje en vez de romper', () => {
    expect(html([], true)).toContain('todavia no esta disponible');
  });
});
