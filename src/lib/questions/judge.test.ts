// Test de la pieza mas fragil del cambio a evaluacion en lotes
// (judgeQuestionsBatch): reconciliar el array de veredictos que devuelve
// Gemini contra el orden real de las preguntas enviadas. Sin red -- no
// llama a la API, solo prueba el parseo/reconciliacion contra strings de
// respuesta simuladas (incluyendo las formas en que un LLM real puede
// desviarse del formato pedido).

import { describe, it, expect } from 'vitest';
import { parseBatchResponse, questionToText, buildBatches, RUBRIC } from './judge';

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

// Review 360 (2026-09-13), §3.3: questionToText no serializaba game_data, asi
// que el juez era ciego al 100% del contenido de los minijuegos -- veia solo
// el titulo generico ("Resuelve la crisis") y no podia filtrar nada. Efecto
// medido en produccion: 83,3% de rechazo HUMANO en minijuegos contra 26,2% en
// preguntas clasicas. Estos tests fijan el contrato para que no vuelva a
// perderse silenciosamente.
describe('questionToText', () => {
  it('serializa game_data de un minijuego, que es donde vive todo su contenido', () => {
    const texto = questionToText({
      type: 'cuarto_crisis',
      q: 'Resuelve la crisis',
      game_type: 'cuarto_crisis',
      game_data: {
        crisis_scenario: 'El reactor pierde presion',
        telemetry_data: ['temperatura alta', 'flujo bajo', 'vibracion'],
        interventions: [{ action_code: 'ALPHA', is_solution: true }],
      },
      exp: 'post mortem',
    });
    expect(texto).toContain('El reactor pierde presion');
    expect(texto).toContain('temperatura alta');
    expect(texto).toContain('ALPHA');
    expect(texto).toContain('cuarto_crisis');
  });

  it('nombra el game_type en la linea de datos para que el juez sepa que reglas aplicar', () => {
    const texto = questionToText({
      type: 'impostor_cognitivo',
      q: 'Encuentra al impostor',
      game_type: 'impostor_cognitivo',
      game_data: { statements: [{ text: 'afirmacion falsa', is_impostor: true }] },
    });
    expect(texto).toContain('Datos del minijuego (impostor_cognitivo)');
    expect(texto).toContain('afirmacion falsa');
  });

  it('cae al campo type cuando la fila no trae game_type explicito', () => {
    const texto = questionToText({
      type: 'linea_del_tiempo',
      q: 'Ordena',
      game_data: { items: [{ text: 'evento', correct_position: 1 }] },
    });
    expect(texto).toContain('Datos del minijuego (linea_del_tiempo)');
  });

  it('no cambia nada para una pregunta clasica: sin game_data no aparece la linea', () => {
    const texto = questionToText({
      type: 'multiple_choice',
      q: '¿Cual es la capital?',
      opts: ['A. Bogota', 'B. Lima'],
      ok: 0,
      exp: 'Es Bogota',
    });
    expect(texto).not.toContain('Datos del minijuego');
    expect(texto).toBe(
      'Tipo: multiple_choice\nPregunta: ¿Cual es la capital?\nOpciones: ["A. Bogota","B. Lima"]\nRespuesta correcta (indice/bool): 0\nExplicacion: Es Bogota'
    );
  });
});

describe('RUBRIC', () => {
  it('incluye el criterio 6 y las reglas de formato de los 8 minijuegos', () => {
    expect(RUBRIC).toContain('6. ESTRUCTURA DEL MINIJUEGO');
    for (const tipo of [
      'el_descifrador', 'linea_del_tiempo', 'categorias_rapidas', 'flashcard_rapida',
      'impostor_cognitivo', 'alquimia_conceptual', 'cuarto_crisis', 'juicio_conocimiento',
    ]) {
      expect(RUBRIC).toContain(tipo);
    }
  });

  it('un minijuego mal formado es "fail", no "review": no debe llegar al estudiante', () => {
    expect(RUBRIC).toContain('"fail": viola el criterio 1, 2 o 6');
  });
});

// El armado de lotes tiene que respetar dos limites a la vez desde que los
// minijuegos serializan game_data: el conteo (BATCH_SIZE, para no pedirle al
// LLM demasiados veredictos) y el presupuesto de caracteres (para que la
// RESPUESTA no se trunque y caiga al fallback individual, que quema la cuota
// de 20 req/dia a una request por pregunta).
describe('buildBatches', () => {
  const clasica = (i: number) => ({ type: 'multiple_choice', q: `pregunta ${i}`, opts: ['A', 'B'], ok: 0 });
  const minijuego = (i: number) => ({
    type: 'cuarto_crisis',
    q: `crisis ${i}`,
    game_type: 'cuarto_crisis',
    game_data: { relleno: 'x'.repeat(2600) },
  });

  it('mantiene el comportamiento anterior para preguntas clasicas: lotes de 8', () => {
    const batches = buildBatches(Array.from({ length: 20 }, (_, i) => clasica(i)));
    expect(batches.map((b) => b.length)).toEqual([8, 8, 4]);
  });

  it('reduce el lote cuando las preguntas son minijuegos grandes', () => {
    const batches = buildBatches(Array.from({ length: 8 }, (_, i) => minijuego(i)));
    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) expect(b.length).toBeLessThan(8);
  });

  it('nunca descarta una pregunta, ni siquiera si sola excede el presupuesto', () => {
    const gigante = { type: 'cuarto_crisis', q: 'x', game_data: { relleno: 'y'.repeat(20000) } };
    const entrada = [clasica(1), gigante, clasica(2)];
    const batches = buildBatches(entrada);
    expect(batches.flat().length).toBe(3);
    expect(batches.flat()).toEqual(expect.arrayContaining(entrada));
  });

  it('ningun lote de mas de una pregunta supera el presupuesto de caracteres', () => {
    const mezcla = [...Array.from({ length: 6 }, (_, i) => clasica(i)), ...Array.from({ length: 6 }, (_, i) => minijuego(i))];
    for (const b of buildBatches(mezcla)) {
      if (b.length === 1) continue;
      const total = b.reduce((s, q) => s + questionToText(q).length, 0);
      expect(total).toBeLessThanOrEqual(9000);
    }
  });

  it('devuelve lista vacia sin preguntas', () => {
    expect(buildBatches([])).toEqual([]);
  });
});
