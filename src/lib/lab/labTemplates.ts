// Catalogo de plantillas de laboratorio. Es la FUENTE UNICA de lo que cada plantilla permite: variables con sus limites, constantes del entorno, lo que se mide y las
// preguntas por defecto. El archivo HTML de cada plantilla (public/labs/<id>.html + models/<id>.js) solo pone el modelo matematico y el dibujo, y el laboratorio se
// construye a partir de esta descripcion: asi los limites que valida la app y los que ve el estudiante son siempre los mismos.
//
// Para agregar una plantilla: ver docs/LABORATORIOS.md.

import type { LabTemplateInfo } from './types';

export const LAB_TEMPLATES: readonly LabTemplateInfo[] = [
  {
    id: 'trayectoria',
    name: 'Lanzamiento de proyectiles',
    area: 'fisica',
    concept: 'Cinemática en dos dimensiones: cómo la velocidad, el ángulo y la gravedad determinan el alcance de un lanzamiento.',
    description: 'Lanza un proyectil y mide su alcance, su altura máxima y su tiempo de vuelo. Cambia una variable a la vez y mantén las demás fijas.',
    bestFor: 'Física: movimiento parabólico, caída libre, comparar la gravedad de la Tierra, la Luna y Marte.',
    variables: [
      { id: 'v0', label: 'Velocidad inicial', unit: 'm/s', min: 1, max: 60, step: 1, default: 20, decimals: 0 },
      { id: 'angulo', label: 'Ángulo de lanzamiento', unit: '°', min: 5, max: 85, step: 1, default: 45, decimals: 0 },
      { id: 'h0', label: 'Altura inicial', unit: 'm', min: 0, max: 50, step: 1, default: 0, decimals: 0 },
    ],
    constants: [{ id: 'g', label: 'Gravedad', unit: 'm/s²', value: 9.81, min: 1, max: 25, decimals: 2 }],
    outputs: [
      { id: 'alcance', label: 'Alcance horizontal', unit: 'm', decimals: 2 },
      { id: 'alturaMax', label: 'Altura máxima', unit: 'm', decimals: 2 },
      { id: 'tiempoVuelo', label: 'Tiempo de vuelo', unit: 's', decimals: 2 },
      { id: 'velImpacto', label: 'Velocidad al caer', unit: 'm/s', decimals: 2 },
    ],
    defaultIndependent: 'angulo',
    defaultChart: { x: 'angulo', y: 'alcance' },
    defaultQuestions: [
      '¿Qué ángulo te dio el mayor alcance? ¿Coincide con lo que predijiste en tu hipótesis?',
      '¿Qué pasa con el alcance cuando el ángulo se acerca a 5° y a 85°? Explica por qué.',
      'Si repitieras el experimento con otra gravedad, ¿qué esperarías que cambie y qué no?',
    ],
  },
  {
    id: 'multiplicador',
    name: 'Multiplicador keynesiano',
    area: 'economia',
    concept: 'Macroeconomía: cómo un cambio del gasto o de los impuestos se multiplica en el ingreso de equilibrio de una economía.',
    description: 'Ajusta el gasto público, la inversión, los impuestos y la propensión a consumir, y observa el ingreso de equilibrio en la cruz keynesiana.',
    bestFor: 'Macroeconomía: política fiscal, multiplicador del gasto, efecto de los impuestos, propensión marginal a consumir.',
    variables: [
      { id: 'G', label: 'Gasto público (G)', unit: 'mil mill.', min: 0, max: 600, step: 10, default: 200, decimals: 0 },
      { id: 'I', label: 'Inversión (I)', unit: 'mil mill.', min: 0, max: 400, step: 10, default: 150, decimals: 0 },
      { id: 'c', label: 'Propensión marginal a consumir (c)', unit: '', min: 0.3, max: 0.95, step: 0.05, default: 0.8, decimals: 2 },
      { id: 't', label: 'Tasa de impuestos (t)', unit: '', min: 0, max: 0.5, step: 0.05, default: 0.2, decimals: 2 },
    ],
    constants: [
      { id: 'C0', label: 'Consumo autónomo (C₀)', unit: 'mil mill.', value: 100, min: 0, max: 400, decimals: 0 },
      { id: 'T0', label: 'Impuestos fijos (T₀)', unit: 'mil mill.', value: 0, min: 0, max: 200, decimals: 0 },
    ],
    outputs: [
      { id: 'Y', label: 'Ingreso de equilibrio (Y)', unit: 'mil mill.', decimals: 1 },
      { id: 'k', label: 'Multiplicador del gasto (k)', unit: '', decimals: 2 },
      { id: 'consumo', label: 'Consumo (C)', unit: 'mil mill.', decimals: 1 },
      { id: 'recaudo', label: 'Recaudo de impuestos (T)', unit: 'mil mill.', decimals: 1 },
    ],
    defaultIndependent: 'G',
    defaultChart: { x: 'G', y: 'Y' },
    defaultQuestions: [
      '¿Cuánto aumentó el ingreso de equilibrio por cada unidad que subió el gasto público? ¿Coincide con el multiplicador k que muestra el laboratorio?',
      '¿Qué le pasa al multiplicador cuando suben los impuestos? Explica con tus datos.',
      '¿Por qué un consumidor que gasta una mayor parte de cada ingreso extra hace que el multiplicador sea más grande?',
    ],
  },
];

export const LAB_TEMPLATE_IDS = LAB_TEMPLATES.map((t) => t.id);

export const getLabTemplate = (id: unknown): LabTemplateInfo | null => (typeof id === 'string' ? LAB_TEMPLATES.find((t) => t.id === id) ?? null : null);
