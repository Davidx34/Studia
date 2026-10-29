// Plantillas para mostrar las fichas de lectura. La IA NO escribe HTML ni estilos: genera DATOS (ver validate.ts) y cada plantilla es un componente de la app
// que los pinta. Asi cambiar de plantilla es instantaneo y no cuesta ninguna llamada a la IA, y todas heredan el modo oscuro, las formulas LaTeX y la accesibilidad.
//
// Este archivo es PURO (sin React): el catalogo, el id por defecto y los datos de ejemplo para las vistas previas. Los componentes estan en
// src/components/study/fichas/. Para agregar una plantilla: ver docs/PLANTILLAS_DE_ESTUDIO.md.

// Una ficha tal como se guarda en study_cards (front = titulo, back = idea principal).
export interface FichaExtra {
  puntos_clave?: string[];
  terminos?: { termino: string; definicion: string }[];
  reflexion?: string;
}

export interface FichaData {
  id: string;
  section: string | null;
  front: string;
  back: string;
  extra: FichaExtra | null;
}

export interface FichaTemplateInfo {
  id: string;
  name: string;
  description: string;
  // Para que tipo de uso queda mejor: ayuda al profesor a elegir.
  bestFor: string;
}

export const FICHA_TEMPLATES = [
  {
    id: 'clasica',
    name: 'Clásica',
    description: 'Lista desplegable: cada ficha se abre para ver su contenido.',
    bestFor: 'Muchas fichas por material; el estudiante abre solo la que necesita.',
  },
  {
    id: 'tarjeta',
    name: 'Tarjeta visual',
    description: 'Cada ficha completa a la vista, con la idea destacada, los puntos numerados y los términos como etiquetas.',
    bestFor: 'Pocas fichas y un estudio más visual, sin tener que abrir nada.',
  },
  {
    id: 'cornell',
    name: 'Cornell',
    description: 'Columna de pistas (términos y pregunta), notas con los puntos clave y un resumen al pie.',
    bestFor: 'Estudio con método: repasar tapando las notas y recordando desde las pistas.',
  },
  {
    id: 'compacta',
    name: 'Compacta',
    description: 'Todo en un bloque denso y fácil de recorrer, pensado para repasar rápido o imprimir.',
    bestFor: 'Repaso antes de una evaluación y material para imprimir.',
  },
] as const satisfies readonly FichaTemplateInfo[];

export type FichaTemplateId = (typeof FICHA_TEMPLATES)[number]['id'];

export const DEFAULT_FICHA_TEMPLATE: FichaTemplateId = 'clasica';

export const isFichaTemplateId = (v: unknown): v is FichaTemplateId => typeof v === 'string' && FICHA_TEMPLATES.some((t) => t.id === v);

// Cualquier valor que no sea una plantilla conocida (columna aun sin migrar, plantilla retirada, dato corrupto) cae en la de siempre: nunca rompe la pantalla.
export const normalizeFichaTemplate = (v: unknown): FichaTemplateId => (isFichaTemplateId(v) ? v : DEFAULT_FICHA_TEMPLATE);

// Datos de ejemplo para las vistas previas cuando el profesor todavia no genero fichas. Una lleva formula para mostrar como se ve el LaTeX.
export const SAMPLE_FICHAS: FichaData[] = [
  {
    id: 'ejemplo-1',
    section: 'Biología celular',
    front: 'La fotosíntesis',
    back: 'Proceso por el cual las plantas transforman la energía de la luz en energía química almacenada en forma de glucosa.',
    extra: {
      puntos_clave: [
        'Ocurre en los cloroplastos, gracias a la clorofila.',
        'Necesita luz solar, agua y dióxido de carbono.',
        'Libera oxígeno como producto secundario.',
      ],
      terminos: [
        { termino: 'Clorofila', definicion: 'Pigmento verde que absorbe la luz.' },
        { termino: 'Cloroplasto', definicion: 'Orgánulo donde se realiza la fotosíntesis.' },
      ],
      reflexion: '¿Qué pasaría con la vida en la Tierra si las plantas dejaran de hacer fotosíntesis?',
    },
  },
  {
    id: 'ejemplo-2',
    section: 'Cálculo',
    front: 'La derivada como razón de cambio',
    back: 'La derivada mide qué tan rápido cambia una función en un punto: es el límite de la razón de cambio promedio.',
    extra: {
      puntos_clave: [
        String.raw`Se define como $f'(x)=\lim_{h\to 0}\frac{f(x+h)-f(x)}{h}$.`,
        'Geométricamente es la pendiente de la recta tangente.',
      ],
      terminos: [{ termino: 'Recta tangente', definicion: 'Recta que toca la curva en un solo punto con su misma pendiente.' }],
      reflexion: '¿Qué significa que la derivada de la posición sea la velocidad?',
    },
  },
];
