import { normalizeKey } from '@/lib/memory/text';
import type { Concept, Edge, Graph } from '@/lib/memory/types';
import type { LabGoldenCase } from '../labDesignEval';

// Conjunto dorado SINTETICO del diseñador de laboratorios: memorias de clase inventadas (microeconomia y quimica) y pedidos del profesor con el veredicto
// de suficiencia que un buen sistema debe dar.

const c = (name: string, over: Partial<Concept> = {}): Concept => ({
  key: normalizeKey(name),
  name,
  kind: 'concepto',
  definition: `Definición de ${name}.`,
  formula: '',
  unit: '',
  importance: 3,
  mentions: 1,
  sources: [{ materialId: 'm1', chunks: [0] }],
  ...over,
});
const e = (from: string, to: string, relation: Edge['relation'] = 'requiere'): Edge => ({ from: normalizeKey(from), to: normalizeKey(to), relation, weight: 1 });

export const ECONOMIA: Graph = {
  concepts: [
    c('Restricción presupuestal', { formula: 'p_x * x + p_y * y = M', importance: 5 }),
    c('Función de utilidad Cobb-Douglas', { kind: 'formula', formula: 'U(x,y) = x^a * y^(1-a)', importance: 5 }),
    c('Utilidad marginal', { importance: 4 }),
    c('Ingreso (M)', { kind: 'variable', importance: 3 }),
    c('Precios', { kind: 'variable', importance: 3 }),
    c('Equilibrio del consumidor', { importance: 4, sources: [{ materialId: 'm2', chunks: [3, 4] }] }),
    // Nombrada pero sin definicion ni formula: un requisito esencial sobre ella da una cobertura PARCIAL.
    c('Curva de indiferencia', { definition: '', formula: '' }),
  ],
  edges: [e('Equilibrio del consumidor', 'Restricción presupuestal'), e('Restricción presupuestal', 'Ingreso (M)'), e('Restricción presupuestal', 'Precios'), e('Equilibrio del consumidor', 'Curva de indiferencia')],
};

export const QUIMICA: Graph = {
  concepts: [
    c('Ley de los gases ideales', { kind: 'ley', formula: 'P * V = n * R * T', importance: 5 }),
    c('Presión', { kind: 'variable', unit: 'atm', importance: 4 }),
    c('Temperatura', { kind: 'variable', unit: 'K', importance: 4 }),
    c('Volumen', { kind: 'variable', unit: 'L', importance: 4 }),
  ],
  edges: [e('Ley de los gases ideales', 'Presión'), e('Ley de los gases ideales', 'Temperatura'), e('Ley de los gases ideales', 'Volumen')],
};

export const LAB_GOLDEN: LabGoldenCase[] = [
  { id: 'consumidor-suficiente', idea: 'Quiero que los estudiantes descubran qué cantidad de X maximiza la utilidad del consumidor con su presupuesto.', graph: ECONOMIA, expected: 'sufficient' },
  { id: 'gases-suficiente', idea: 'Que los estudiantes exploren cómo cambia la presión de un gas cuando varía su volumen a temperatura constante.', graph: QUIMICA, expected: 'sufficient' },
  { id: 'curva-parcial', idea: 'Que los estudiantes relacionen la restricción presupuestal con las curvas de indiferencia para hallar el óptimo.', graph: ECONOMIA, expected: 'partial' },
  { id: 'juegos-insuficiente', idea: 'Un experimento sobre equilibrios de Nash en la teoría de juegos con dos jugadores.', graph: ECONOMIA, expected: 'insufficient' },
  { id: 'fotosintesis-insuficiente', idea: 'Que los estudiantes midan cómo la luz afecta la tasa de fotosíntesis de una planta.', graph: QUIMICA, expected: 'insufficient' },
  { id: 'poema-nofit', idea: 'Que los estudiantes escriban un poema sobre el mercado y lo comparen entre sí.', graph: ECONOMIA, expected: 'noFit' },
];
