import { describe, it, expect } from 'vitest';
import { extractJsonQuestions } from './cohereGeneration';

const q = (n: number) => ({ type: 'multiple_choice', q: `pregunta ${n}`, opts: ['A', 'B'], ok: 0, exp: 'e' });

describe('extractJsonQuestions: la forma que pide el prompt', () => {
  it('{ "questions": [...] }', () => {
    expect(extractJsonQuestions(JSON.stringify({ questions: [q(1), q(2)] }))).toEqual([q(1), q(2)]);
  });

  it('con fences de markdown y texto alrededor', () => {
    const t = 'Aqui van:\n```json\n' + JSON.stringify({ questions: [q(1)] }) + '\n```\nEspero que sirva.';
    expect(extractJsonQuestions(t)).toEqual([q(1)]);
  });

  it('texto antes y despues SIN fences', () => {
    expect(extractJsonQuestions('Claro: ' + JSON.stringify({ questions: [q(1), q(2)] }) + ' listo.')).toHaveLength(2);
  });

  it('{ "preguntas": [...] } (en español)', () => {
    expect(extractJsonQuestions(JSON.stringify({ preguntas: [q(1)] }))).toEqual([q(1)]);
  });
});

// Medido el 2026-10-27 con Gemini 3.5 Flash-Lite: al pedir pocas preguntas NO devuelve { "questions": [...] }. Con 1 devuelve el objeto de la pregunta; con 2 o 3, una lista.
// Antes esto daba null ("respuesta ilegible") y la generacion caia al respaldo (Cohere, de menor calidad).
describe('extractJsonQuestions: las formas que Gemini devuelve al pedir pocas preguntas', () => {
  it('una LISTA suelta de preguntas', () => {
    expect(extractJsonQuestions(JSON.stringify([q(1), q(2), q(3)]))).toEqual([q(1), q(2), q(3)]);
  });

  it('una lista con formato (saltos de linea y sangria), como la devuelve el modelo', () => {
    expect(extractJsonQuestions('[\n  {\n    "type": "multiple_choice",\n    "q": "hola",\n    "ok": 0\n  }\n]')).toHaveLength(1);
  });

  it('UN SOLO objeto de pregunta (pidiendo 1)', () => {
    expect(extractJsonQuestions(JSON.stringify(q(1)))).toEqual([q(1)]);
  });

  it('una lista dentro de fences y con texto alrededor', () => {
    expect(extractJsonQuestions('Aqui:\n```json\n' + JSON.stringify([q(1), q(2)]) + '\n```')).toHaveLength(2);
  });

  it('una lista con texto alrededor y SIN fences', () => {
    expect(extractJsonQuestions('Respuesta: ' + JSON.stringify([q(1), q(2)]) + ' fin')).toHaveLength(2);
  });

  it('las formulas LaTeX con barras simples se protegen tambien en la forma de lista', () => {
    const lista = '[{"type":"fill_blank","q":"La derivada es $\\frac{dy}{dx}$ y vale ___","answers":["2x"]}]';
    const r = extractJsonQuestions(lista);
    expect(r).toHaveLength(1);
    expect(r![0].q).toContain('\\frac{dy}{dx}'); // la barra sobrevive (no se vuelve un salto de pagina)
  });

  it('LaTeX con barras simples en el formato de siempre sigue funcionando', () => {
    const t = '{"questions":[{"type":"fill_blank","q":"Calcula $\\partial F/\\partial x$ ___","answers":["0"]}]}';
    expect(extractJsonQuestions(t)![0].q).toContain('\\partial F');
  });
});

describe('extractJsonQuestions: lo que NO es una respuesta de preguntas', () => {
  it('texto sin JSON -> null', () => {
    expect(extractJsonQuestions('Lo siento, no puedo ayudar con eso.')).toBeNull();
    expect(extractJsonQuestions('')).toBeNull();
  });

  it('JSON roto -> null', () => {
    expect(extractJsonQuestions('{"questions": [ {"type": "x", ')).toBeNull();
    expect(extractJsonQuestions('[{"type":')).toBeNull();
  });

  it('un objeto que no es una pregunta ni trae preguntas -> null', () => {
    expect(extractJsonQuestions('{"foo": 1}')).toBeNull();
    expect(extractJsonQuestions('{"error": "cuota agotada"}')).toBeNull();
    expect(extractJsonQuestions('{"type": "multiple_choice"}')).toBeNull(); // sin "q": no es una pregunta
  });

  it('una lista de cosas que no son objetos -> null', () => {
    expect(extractJsonQuestions('[1, 2, 3]')).toBeNull();
    expect(extractJsonQuestions('["a", "b"]')).toBeNull();
  });

  it('listas o preguntas vacias: [] da lista vacia (quien llama lo trata como fallo)', () => {
    expect(extractJsonQuestions('{"questions": []}')).toEqual([]);
    expect(extractJsonQuestions('[]')).toEqual([]);
  });
});
