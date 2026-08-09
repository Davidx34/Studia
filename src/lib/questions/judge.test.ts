// Test de la pieza mas fragil del cambio a evaluacion en lotes
// (judgeQuestionsBatch): reconciliar el array de veredictos que devuelve
// Gemini contra el orden real de las preguntas enviadas. Sin red -- no
// llama a la API, solo prueba el parseo/reconciliacion contra strings de
// respuesta simuladas (incluyendo las formas en que un LLM real puede
// desviarse del formato pedido).

import { describe, it, expect } from 'vitest';
import { parseBatchResponse } from './judge';

describe('parseBatchResponse', () => {
  it('parsea un lote bien formado en orden', () => {
    const text = JSON.stringify({
      verdicts: [
        { index: 1, verdict: 'pass', reason: 'ok' },
        { index: 2, verdict: 'fail', reason: 'inventa un dato' },
        { index: 3, verdict: 'review', reason: 'distractor debil' },
      ],
    });
    const result = parseBatchResponse(text, 3);
    expect(result).toEqual([
      { verdict: 'pass', reason: 'ok' },
      { verdict: 'fail', reason: 'inventa un dato' },
      { verdict: 'review', reason: 'distractor debil' },
    ]);
  });

  it('reordena correctamente si el LLM devuelve los indices fuera de orden', () => {
    const text = JSON.stringify({
      verdicts: [
        { index: 3, verdict: 'review', reason: 'c' },
        { index: 1, verdict: 'pass', reason: 'a' },
        { index: 2, verdict: 'fail', reason: 'b' },
      ],
    });
    const result = parseBatchResponse(text, 3);
    expect(result).toEqual([
      { verdict: 'pass', reason: 'a' },
      { verdict: 'fail', reason: 'b' },
      { verdict: 'review', reason: 'c' },
    ]);
  });

  it('deja null en la posicion sin cubrir si el LLM duplica un indice en vez de usarlos todos (mismo conteo total, pero un hueco real)', () => {
    const text = JSON.stringify({
      verdicts: [
        { index: 1, verdict: 'pass', reason: 'a' },
        { index: 1, verdict: 'review', reason: 'duplicado por error del LLM' }, // repite index 1 en vez de usar 2
        { index: 3, verdict: 'fail', reason: 'c' },
      ],
    });
    // 3 objetos como se pidio, pero solo cubren los indices 1 y 3 -- la
    // posicion 2 queda sin veredicto real y debe ser null, no inventarse.
    const result = parseBatchResponse(text, 3);
    expect(result).toEqual([
      { verdict: 'review', reason: 'duplicado por error del LLM' }, // el segundo objeto con index:1 sobrescribe al primero
      null,
      { verdict: 'fail', reason: 'c' },
    ]);
  });

  it('devuelve null (dispara fallback) si el conteo de veredictos no coincide con lo pedido', () => {
    const text = JSON.stringify({
      verdicts: [
        { index: 1, verdict: 'pass', reason: 'a' },
        { index: 2, verdict: 'fail', reason: 'b' },
      ],
    });
    // Se pidieron 3, el LLM solo devolvio 2 -- todo el lote es sospechoso,
    // no solo el faltante (podria haber fusionado o saltado alguna).
    expect(parseBatchResponse(text, 3)).toBeNull();
  });

  it('devuelve null si la respuesta no es JSON valido', () => {
    expect(parseBatchResponse('esto no es json en absoluto', 3)).toBeNull();
  });

  it('devuelve null si "verdicts" no es un array', () => {
    const text = JSON.stringify({ verdicts: 'pass' });
    expect(parseBatchResponse(text, 1)).toBeNull();
  });

  it('ignora un veredicto con valor invalido (no pass/fail/review) sin romper el resto del lote', () => {
    const text = JSON.stringify({
      verdicts: [
        { index: 1, verdict: 'maybe', reason: 'valor invalido' },
        { index: 2, verdict: 'pass', reason: 'valido' },
      ],
    });
    const result = parseBatchResponse(text, 2);
    expect(result).toEqual([null, { verdict: 'pass', reason: 'valido' }]);
  });

  it('tolera texto envuelto en fences de markdown antes/despues del JSON', () => {
    const text = '```json\n' + JSON.stringify({ verdicts: [{ index: 1, verdict: 'pass', reason: 'ok' }] }) + '\n```';
    expect(parseBatchResponse(text, 1)).toEqual([{ verdict: 'pass', reason: 'ok' }]);
  });

  it('trunca la razon a 500 caracteres', () => {
    const largaRazon = 'x'.repeat(600);
    const text = JSON.stringify({ verdicts: [{ index: 1, verdict: 'fail', reason: largaRazon }] });
    const result = parseBatchResponse(text, 1);
    expect(result![0]!.reason.length).toBe(500);
  });
});
