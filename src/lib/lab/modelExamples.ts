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

// Quimica: ley de los gases ideales, P·V = n·R·T. El estudiante mueve el volumen y la temperatura y ve como responde la presion (isoterma P·V = constante).
const gases = {
  area: 'quimica',
  concept: 'Cómo se relacionan la presión, el volumen y la temperatura de un gas ideal: la ley P·V = n·R·T.',
  variables: [
    { id: 'V', label: 'Volumen', unit: 'L', min: 1, max: 20, step: 0.5, default: 5, decimals: 1 },
    { id: 'T', label: 'Temperatura', unit: 'K', min: 200, max: 500, step: 5, default: 300, decimals: 0 },
  ],
  constants: [
    { id: 'n', label: 'Cantidad de gas', unit: 'mol', value: 1, min: 0.1, max: 5, decimals: 2 },
    { id: 'R', label: 'Constante de los gases', unit: 'L·atm/mol·K', value: 0.08206, min: 0.082, max: 0.0821, decimals: 5 },
  ],
  derived: [],
  outputs: [
    { id: 'P', label: 'Presión', unit: 'atm', decimals: 3, expr: 'n*R*T/V' },
    { id: 'PV', label: 'Producto P·V', unit: 'atm·L', decimals: 3, expr: 'n*R*T/V * V' },
  ],
  independent: 'V',
  chart: { x: 'V', y: 'P' },
  scene: {
    xLabel: 'Volumen (L)',
    yLabel: 'Presión (atm)',
    curves: [{ kind: 'param', label: 'Isoterma a la T actual', dashed: false, x: 'param', y: 'n*R*T/param', from: '1', to: '20' }],
    points: [{ label: 'Estado actual', x: 'V', y: 'P' }],
  },
  basis: ['Ley de los gases ideales', 'Presión', 'Temperatura'],
};

// Biologia: cinetica enzimatica de Michaelis-Menten, v = Vmax·[S]/(Km + [S]). Km es la concentracion de sustrato a la que la velocidad es la mitad de la maxima.
const enzima = {
  area: 'biologia',
  concept: 'Cómo la velocidad de una reacción enzimática depende de la concentración de sustrato y se satura (Michaelis-Menten).',
  variables: [{ id: 'S', label: 'Concentración de sustrato', unit: 'µM', min: 0.5, max: 300, step: 0.5, default: 25, decimals: 1 }],
  constants: [
    { id: 'Vmax', label: 'Velocidad máxima', unit: 'µM/min', value: 100, min: 20, max: 200, decimals: 0 },
    { id: 'Km', label: 'Constante de Michaelis', unit: 'µM', value: 25, min: 5, max: 100, decimals: 1 },
  ],
  derived: [],
  outputs: [
    { id: 'v', label: 'Velocidad de reacción', unit: 'µM/min', decimals: 2, expr: 'Vmax*S/(Km + S)' },
    { id: 'sat', label: 'Saturación de la enzima', unit: '%', decimals: 1, expr: '100*S/(Km + S)' },
    { id: 'invV', label: 'Inverso de la velocidad (1/v)', unit: 'min/µM', decimals: 4, expr: '(Km + S)/(Vmax*S)' },
  ],
  independent: 'S',
  chart: { x: 'S', y: 'v' },
  scene: {
    xLabel: 'Sustrato [S] (µM)',
    yLabel: 'Velocidad v (µM/min)',
    curves: [
      { kind: 'param', label: 'v = Vmax·[S]/(Km + [S])', dashed: false, x: 'param', y: 'Vmax*param/(Km + param)', from: '0.5', to: '300' },
      { kind: 'param', label: 'Velocidad máxima', dashed: true, x: 'param', y: 'Vmax', from: '0.5', to: '300' },
    ],
    points: [
      { label: 'Ahora', x: 'S', y: 'v' },
      { label: 'Km (mitad de Vmax)', x: 'Km', y: 'Vmax/2' },
    ],
  },
  basis: ['Cinética de Michaelis-Menten', 'Velocidad de reacción', 'Constante de Michaelis'],
};

// Estadistica: distribucion muestral de la media. El error estandar es SE = σ/√n: cuadruplicar la muestra reduce el error a la mitad (base del teorema del limite central).
const muestreo = {
  area: 'estadistica',
  concept: 'Cómo el tamaño de la muestra reduce el error estándar de la media y estrecha el intervalo de confianza.',
  variables: [{ id: 'n', label: 'Tamaño de la muestra', unit: 'datos', min: 2, max: 400, step: 1, default: 25, decimals: 0 }],
  constants: [
    { id: 'sigma', label: 'Desviación estándar de la población', unit: '', value: 10, min: 1, max: 30, decimals: 1 },
    { id: 'mu', label: 'Media de la población', unit: '', value: 100, min: 0, max: 200, decimals: 1 },
    { id: 'z', label: 'Valor z de confianza (1.96 = 95 %)', unit: '', value: 1.96, min: 1.28, max: 2.58, decimals: 2 },
  ],
  derived: [{ id: 'SE', expr: 'sigma/sqrt(n)' }],
  outputs: [
    { id: 'error', label: 'Error estándar de la media', unit: '', decimals: 3, expr: 'SE' },
    { id: 'margen', label: 'Margen de error', unit: '', decimals: 3, expr: 'z*SE' },
    { id: 'inf', label: 'Límite inferior del intervalo', unit: '', decimals: 2, expr: 'mu - z*SE' },
    { id: 'sup', label: 'Límite superior del intervalo', unit: '', decimals: 2, expr: 'mu + z*SE' },
    { id: 'relativo', label: 'Error relativo a σ', unit: '%', decimals: 1, expr: '100*SE/sigma' },
  ],
  independent: 'n',
  chart: { x: 'n', y: 'error' },
  scene: {
    xLabel: 'Tamaño de la muestra n',
    yLabel: 'Error estándar',
    curves: [{ kind: 'param', label: 'SE = σ/√n', dashed: false, x: 'param', y: 'sigma/sqrt(param)', from: '2', to: '400' }],
    points: [{ label: 'Tu muestra', x: 'n', y: 'SE' }],
  },
  basis: ['Error estándar', 'Distribución muestral de la media', 'Teorema del límite central'],
};

// Fisica: circuito con una fuente de resistencia interna r que alimenta dos resistencias en paralelo. La potencia en la carga es maxima cuando la carga iguala a r.
const circuito = {
  area: 'fisica',
  concept: 'Cómo se reparte la potencia entre la carga y la resistencia interna de una fuente: ley de Ohm y potencia disipada.',
  variables: [
    { id: 'R1', label: 'Resistencia 1 de la carga', unit: 'Ω', min: 0.5, max: 30, step: 0.5, default: 6, decimals: 1 },
    { id: 'R2', label: 'Resistencia 2 (en paralelo)', unit: 'Ω', min: 0.5, max: 30, step: 0.5, default: 12, decimals: 1 },
  ],
  constants: [
    { id: 'eps', label: 'Fuerza electromotriz', unit: 'V', value: 12, min: 1, max: 24, decimals: 1 },
    { id: 'r', label: 'Resistencia interna', unit: 'Ω', value: 1, min: 0.1, max: 5, decimals: 2 },
  ],
  // Las dos resistencias en paralelo: Rp = R1·R2/(R1 + R2). La corriente total sale de la ley de Ohm: I = ε/(Rp + r).
  derived: [
    { id: 'Rp', expr: 'R1*R2/(R1 + R2)' },
    { id: 'I', expr: 'eps/(Rp + r)' },
  ],
  outputs: [
    { id: 'corriente', label: 'Corriente total', unit: 'A', decimals: 3, expr: 'I' },
    { id: 'Vcarga', label: 'Voltaje en la carga', unit: 'V', decimals: 3, expr: 'I*Rp' },
    { id: 'Pcarga', label: 'Potencia en la carga', unit: 'W', decimals: 3, expr: 'I^2*Rp' },
    { id: 'Pinterna', label: 'Potencia perdida en la fuente', unit: 'W', decimals: 3, expr: 'I^2*r' },
    { id: 'eficiencia', label: 'Eficiencia', unit: '%', decimals: 1, expr: '100*Rp/(Rp + r)' },
  ],
  independent: 'R1',
  chart: { x: 'R1', y: 'Pcarga' },
  scene: {
    xLabel: 'Resistencia de la carga (Ω)',
    yLabel: 'Potencia en la carga (W)',
    curves: [{ kind: 'param', label: 'P(R) con R2 actual', dashed: false, x: 'param', y: 'eps^2*(param*R2/(param + R2))/((param*R2/(param + R2)) + r)^2', from: '0.5', to: '30' }],
    points: [{ label: 'Ahora', x: 'R1', y: 'Pcarga' }],
  },
  basis: ['Ley de Ohm', 'Potencia eléctrica', 'Resistencia interna'],
};

export const MODEL_EXAMPLES: ModelExample[] = [
  { id: 'consumidor', title: 'El consumidor: utilidad máxima con restricción presupuestal', raw: consumidor },
  { id: 'impuesto', title: 'Un impuesto en el mercado: oferta, demanda y recaudo', raw: impuesto },
  { id: 'poblacion', title: 'Crecimiento de una población con recursos limitados', raw: poblacion },
  { id: 'gases', title: 'Gases ideales: presión, volumen y temperatura', raw: gases },
  { id: 'enzima', title: 'Cinética enzimática: velocidad de reacción de Michaelis-Menten', raw: enzima },
  { id: 'muestreo', title: 'Distribución muestral de la media: el error estándar', raw: muestreo },
  { id: 'circuito', title: 'Circuito con resistencia interna: potencia en la carga', raw: circuito },
];

// La ficha lista para editar de un ejemplo (validada: el modelo pasa la prueba numerica). null si el ejemplo no es valido.
export function exampleSpec(e: ModelExample): LabSpec | null {
  const r = validateLabSpec({ template: 'modelo', title: e.title.slice(0, 120), model: e.raw });
  return r.ok ? r.spec : null;
}
