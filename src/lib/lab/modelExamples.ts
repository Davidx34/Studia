// Modelos declarativos de EJEMPLO (los que podria escribir la IA). Sirven para probar el motor y, en el PR de generacion, como ejemplos del formato para la IA. Cada uno esta
// en la forma "cruda" (como la escribiria la IA) y se valida con validateModel antes de usarse; ninguno es una plantilla fija.

import { validateLabSpec } from './labSpec';
import type { LabSpec } from './types';

export interface ModelExample {
  id: string;
  title: string;
  raw: Record<string, unknown>;
}

// Microeconomia: el consumidor con utilidad Cobb-Douglas y restriccion presupuestal. El optimo teorico es x* = a·M/px (lo descubre el estudiante moviendo x).
const consumidor = {
  area: 'economia',
  concept: 'Cómo elige un consumidor la canasta que maximiza su utilidad dado su presupuesto y los precios.',
  variables: [{ id: 'x', label: 'Cantidad del bien X', unit: 'u', min: 0.5, max: 40, step: 0.5, default: 6, decimals: 1 }],
  constants: [
    { id: 'M', label: 'Ingreso', unit: '$', value: 100, min: 50, max: 500, decimals: 0 },
    { id: 'px', label: 'Precio de X', unit: '$', value: 5, min: 1, max: 20, decimals: 1 },
    { id: 'py', label: 'Precio de Y', unit: '$', value: 4, min: 1, max: 20, decimals: 1 },
    { id: 'a', label: 'Preferencia por X', unit: '', value: 0.5, min: 0.1, max: 0.9, decimals: 2 },
  ],
  // Con el presupuesto agotado, lo que sobra se gasta en Y (nunca negativo).
  derived: [{ id: 'cantY', expr: 'max((M - px*x)/py, 0)' }],
  outputs: [
    { id: 'Y', label: 'Cantidad del bien Y', unit: 'u', decimals: 2, expr: 'cantY' },
    { id: 'U', label: 'Utilidad', unit: 'útiles', decimals: 2, expr: 'x^a * cantY^(1-a)' },
    { id: 'TMS', label: 'Tasa marginal de sustitución', unit: '', decimals: 2, expr: 'a/(1-a) * cantY/x' },
  ],
  independent: 'x',
  chart: { x: 'x', y: 'U' },
  scene: {
    xLabel: 'Bien X',
    yLabel: 'Bien Y',
    curves: [
      { kind: 'param', label: 'Restricción presupuestal', dashed: false, x: 'param', y: '(M - px*param)/py', from: '0', to: 'M/px' },
      // La curva de indiferencia que pasa por la canasta actual: x^a · y^(1-a) = U.
      { kind: 'param', label: 'Curva de indiferencia', dashed: true, x: 'param', y: '(U / param^a)^(1/(1-a))', from: '0.05*M/px', to: 'M/px' },
    ],
    points: [{ label: 'Canasta', x: 'x', y: 'cantY' }],
  },
  basis: ['Utilidad marginal', 'Restricción presupuestal', 'Equilibrio del consumidor'],
};

// Oferta y demanda con un impuesto por unidad pagado por el productor.
const impuesto = {
  area: 'economia',
  concept: 'Cómo un impuesto por unidad cambia el precio, la cantidad y el recaudo de un mercado.',
  variables: [{ id: 't', label: 'Impuesto por unidad', unit: '$', min: 0, max: 10, step: 0.5, default: 0, decimals: 1 }],
  constants: [
    { id: 'a', label: 'Demanda: intercepto', unit: 'u', value: 100, min: 50, max: 200, decimals: 0 },
    { id: 'b', label: 'Demanda: pendiente', unit: '', value: 2, min: 0.5, max: 5, decimals: 1 },
    { id: 'c', label: 'Oferta: intercepto', unit: 'u', value: 10, min: 0, max: 40, decimals: 0 },
    { id: 'd', label: 'Oferta: pendiente', unit: '', value: 1, min: 0.5, max: 5, decimals: 1 },
  ],
  // Demanda Qd = a − b·P. Oferta Qs = c + d·(P − t). Equilibrio: P = (a − c + d·t)/(b + d).
  derived: [
    { id: 'P0', expr: '(a - c)/(b + d)' },
    { id: 'Pe', expr: '(a - c + d*t)/(b + d)' },
  ],
  outputs: [
    { id: 'P', label: 'Precio que paga el consumidor', unit: '$', decimals: 2, expr: 'Pe' },
    { id: 'Q', label: 'Cantidad de equilibrio', unit: 'u', decimals: 2, expr: 'max(a - b*Pe, 0)' },
    { id: 'recibido', label: 'Precio que recibe el productor', unit: '$', decimals: 2, expr: 'Pe - t' },
    { id: 'recaudo', label: 'Recaudo del impuesto', unit: '$', decimals: 2, expr: 't * max(a - b*Pe, 0)' },
    { id: 'perdida', label: 'Pérdida de eficiencia', unit: '$', decimals: 2, expr: '0.5 * t * max(max(a - b*P0, 0) - max(a - b*Pe, 0), 0)' },
  ],
  independent: 't',
  chart: { x: 't', y: 'recaudo' },
  scene: {
    xLabel: 'Cantidad',
    yLabel: 'Precio',
    curves: [
      { kind: 'param', label: 'Demanda', dashed: false, x: 'param', y: '(a - param)/b', from: '0', to: 'a' },
      { kind: 'param', label: 'Oferta (con impuesto)', dashed: false, x: 'param', y: '(param - c)/d + t', from: 'c', to: 'a' },
    ],
    points: [{ label: 'Equilibrio', x: 'max(a - b*Pe, 0)', y: 'Pe' }],
  },
  basis: ['Oferta', 'Demanda', 'Equilibrio de mercado'],
};

// Biologia: crecimiento logistico de una poblacion. N(t) = K / (1 + ((K − N0)/N0)·e^(−r·t)).
const poblacion = {
  area: 'biologia',
  concept: 'Cómo crece una población con recursos limitados: tasa de crecimiento, capacidad de carga y tiempo.',
  variables: [
    { id: 'r', label: 'Tasa de crecimiento', unit: '1/día', min: 0.05, max: 0.5, step: 0.01, default: 0.2, decimals: 2 },
    { id: 'K', label: 'Capacidad de carga', unit: 'ind.', min: 100, max: 1000, step: 10, default: 500, decimals: 0 },
    { id: 'tiempo', label: 'Tiempo', unit: 'días', min: 0, max: 60, step: 1, default: 30, decimals: 0 },
  ],
  constants: [{ id: 'N0', label: 'Población inicial', unit: 'ind.', value: 10, min: 1, max: 50, decimals: 0 }],
  derived: [{ id: 'logi', expr: 'K / (1 + ((K - N0)/N0) * exp(-r*tiempo))' }],
  outputs: [
    { id: 'N', label: 'Población', unit: 'ind.', decimals: 1, expr: 'logi' },
    { id: 'crecimiento', label: 'Crecimiento por día', unit: 'ind./día', decimals: 2, expr: 'r * logi * (1 - logi/K)' },
  ],
  independent: 'r',
  chart: { x: 'tiempo', y: 'N' },
  scene: {
    xLabel: 'Tiempo (días)',
    yLabel: 'Población',
    curves: [
      { kind: 'param', label: 'Población N(t)', dashed: false, x: 'param', y: 'K / (1 + ((K - N0)/N0) * exp(-r*param))', from: '0', to: '60' },
      { kind: 'param', label: 'Capacidad de carga K', dashed: true, x: 'param', y: 'K', from: '0', to: '60' },
    ],
    points: [{ label: 'Ahora', x: 'tiempo', y: 'logi' }],
  },
  basis: ['Crecimiento logístico', 'Capacidad de carga'],
};

export const MODEL_EXAMPLES: ModelExample[] = [
  { id: 'consumidor', title: 'El consumidor: utilidad máxima con restricción presupuestal', raw: consumidor },
  { id: 'impuesto', title: 'Un impuesto en el mercado: oferta, demanda y recaudo', raw: impuesto },
  { id: 'poblacion', title: 'Crecimiento de una población con recursos limitados', raw: poblacion },
];

// La ficha lista para editar de un ejemplo (validada: el modelo pasa la prueba numerica). null si el ejemplo no es valido.
export function exampleSpec(e: ModelExample): LabSpec | null {
  const r = validateLabSpec({ template: 'modelo', title: e.title.slice(0, 120), model: e.raw });
  return r.ok ? r.spec : null;
}
