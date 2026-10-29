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

// Estructuras con tema (ThemedLayouts.tsx). Las 4 plantillas "funcionales" no usan layout ni tema: siguen los colores de la app.
export type FichaLayout = 'tarjeta' | 'mosaico' | 'ruta' | 'cuaderno' | 'revista' | 'cornell' | 'acordeon';

export type FichaCategory = 'funcional' | 'infantil' | 'area' | 'estetica';

export const FICHA_CATEGORY_LABEL: Record<FichaCategory, string> = {
  funcional: 'Funcionales',
  infantil: 'Infantiles',
  area: 'Por área',
  estetica: 'Estéticas',
};

export const FICHA_CATEGORY_HINT: Record<FichaCategory, string> = {
  funcional: 'Siguen los colores de la app (claro y oscuro). Sobrias y rápidas de leer.',
  infantil: 'Colores vivos, formas redondas y letras amigables. Para los más pequeños.',
  area: 'Pensadas para el ambiente de cada materia.',
  estetica: 'Un estilo por sí mismo, sin importar la materia.',
};

export interface FichaTemplateInfo {
  id: string;
  name: string;
  description: string;
  // Para que tipo de uso queda mejor: ayuda al profesor a elegir.
  bestFor: string;
  category: FichaCategory;
  layout: FichaLayout | null;
  // Id del tema en fichaThemes.ts (null = sigue los colores de la app).
  theme: string | null;
}

export const FICHA_TEMPLATES = [
  // ── Funcionales ──
  { id: 'clasica', name: 'Clásica', category: 'funcional', layout: null, theme: null,
    description: 'Lista desplegable: cada ficha se abre para ver su contenido.',
    bestFor: 'Muchas fichas por material; el estudiante abre solo la que necesita.' },
  { id: 'tarjeta', name: 'Tarjeta visual', category: 'funcional', layout: null, theme: null,
    description: 'Cada ficha completa a la vista, con la idea destacada, los puntos numerados y los términos como etiquetas.',
    bestFor: 'Pocas fichas y un estudio más visual, sin tener que abrir nada.' },
  { id: 'cornell', name: 'Cornell', category: 'funcional', layout: null, theme: null,
    description: 'Columna de pistas (términos y pregunta), notas con los puntos clave y un resumen al pie.',
    bestFor: 'Estudio con método: repasar tapando las notas y recordando desde las pistas.' },
  { id: 'compacta', name: 'Compacta', category: 'funcional', layout: null, theme: null,
    description: 'Todo en un bloque denso y fácil de recorrer, pensado para repasar rápido o imprimir.',
    bestFor: 'Repaso antes de una evaluación y material para imprimir.' },

  // ── Infantiles ──
  { id: 'aventura', name: 'Aventura', category: 'infantil', layout: 'ruta', theme: 'aventura',
    description: 'Un camino de paradas con burbujas de colores, bordes gruesos y letras redondas.',
    bestFor: 'Primaria: cada punto clave es una parada del camino hasta la meta.' },
  { id: 'arcoiris', name: 'Arcoíris', category: 'infantil', layout: 'mosaico', theme: 'arcoiris',
    description: 'Mosaico de bloques pastel con la inicial de cada palabra bien grande.',
    bestFor: 'Los más pequeños: bloques cortos y coloridos, fáciles de recorrer.' },

  // ── Por area ──
  { id: 'naturaleza', name: 'Naturaleza', category: 'area', layout: 'tarjeta', theme: 'naturaleza',
    description: 'Verdes y tierra, formas orgánicas y números en forma de hoja.',
    bestFor: 'Biología, ciencias naturales y medio ambiente.' },
  { id: 'laboratorio', name: 'Laboratorio', category: 'area', layout: 'mosaico', theme: 'laboratorio',
    description: 'Mosaico turquesa con fondo de hexágonos y los términos como casillas de la tabla periódica.',
    bestFor: 'Química y ciencias experimentales.' },
  { id: 'cuadriculado', name: 'Cuaderno cuadriculado', category: 'area', layout: 'cuaderno', theme: 'cuadriculado',
    description: 'Hoja con renglones y margen, título subrayado con marcador y los términos en notas adhesivas.',
    bestFor: 'Matemáticas y todo lo que lleva fórmulas y procedimientos.' },
  { id: 'plano', name: 'Plano técnico', category: 'area', layout: 'cornell', theme: 'plano',
    description: 'Azul de plano con rejilla y letra técnica, con pistas, notas y resumen como una ficha de ingeniería.',
    bestFor: 'Física, tecnología e ingeniería.' },
  { id: 'archivo', name: 'Archivo histórico', category: 'area', layout: 'ruta', theme: 'archivo',
    description: 'Pergamino sepia y un camino de paradas con sellos, como una línea de tiempo.',
    bestFor: 'Ciencias sociales, historia y geografía.' },
  { id: 'libro', name: 'Libro', category: 'area', layout: 'revista', theme: 'libro',
    description: 'Página de libro: titular en serif, capitular, dos columnas y una cita final.',
    bestFor: 'Lenguaje, literatura y lectura crítica.' },

  // ── Esteticas ──
  { id: 'editorial', name: 'Editorial minimal', category: 'estetica', layout: 'revista', theme: 'editorial',
    description: 'Blanco y negro de revista: titulares enormes, líneas finas y mucho aire.',
    bestFor: 'Cualquier materia, con un aire sobrio y elegante.' },
  { id: 'neon', name: 'Neón', category: 'estetica', layout: 'mosaico', theme: 'neon',
    description: 'Fondo oscuro con bloques de neón cian, rosa y violeta.',
    bestFor: 'Secundaria y media: un estilo moderno para tecnología o ciencias.' },
  { id: 'brutalista', name: 'Neobrutalista', category: 'estetica', layout: 'acordeon', theme: 'brutalista',
    description: 'Bordes negros gruesos, sombras duras y colores planos y vivos, en acordeón.',
    bestFor: 'Cualquier materia, con personalidad fuerte y muy legible.' },
  { id: 'aurora', name: 'Aurora de cristal', category: 'estetica', layout: 'tarjeta', theme: 'aurora',
    description: 'Tarjetas de vidrio esmerilado sobre un fondo de aurora violeta y turquesa.',
    bestFor: 'Cualquier materia, con un aire moderno y suave.' },
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
