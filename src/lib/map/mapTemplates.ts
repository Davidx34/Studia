// Plantillas del mapa de aprendizaje. Igual que las de las fichas (src/lib/study/fichaTemplates.ts): plantilla = ESTRUCTURA (layout) + TEMA. El tema es el mismo
// catalogo de fichaThemes.ts (paleta, tipografia, formas, fondo), mas uno adaptable ('app') que sigue los colores de la app en claro y oscuro.
//
// El profesor elige la de su clase; se guarda solo el id en classrooms.map_template (migracion 076). Un id desconocido o ausente usa 'islas', el mapa de siempre.

export type MapLayout = 'islas' | 'camino' | 'metro' | 'tablero';

export type MapCategory = 'funcional' | 'infantil' | 'area' | 'estetica';

export const MAP_CATEGORY_LABEL: Record<MapCategory, string> = {
  funcional: 'Funcionales',
  infantil: 'Infantiles',
  area: 'Por área',
  estetica: 'Estéticas',
};

export const MAP_CATEGORY_HINT: Record<MapCategory, string> = {
  funcional: 'Siguen los colores de la app (claro y oscuro).',
  infantil: 'Caminos de colores vivos y formas redondas, para los más pequeños.',
  area: 'Pensadas para el ambiente de cada materia.',
  estetica: 'Un estilo por sí mismo, sin importar la materia.',
};

export interface MapTemplateInfo {
  id: string;
  name: string;
  description: string;
  bestFor: string;
  category: MapCategory;
  layout: MapLayout;
  // Id de un tema de fichaThemes.ts, o 'app' (sigue los colores de la app). null solo en 'islas', que conserva su propio dibujo.
  theme: string | null;
}

export const MAP_TEMPLATES = [
  // ── Funcionales ──
  { id: 'islas', name: 'Mapa de islas', category: 'funcional', layout: 'islas', theme: null,
    description: 'El mapa de siempre: un lienzo con una isla por tema y caminos que unen los módulos.',
    bestFor: 'Una visión general de todo el recorrido, con los módulos donde los ubicó la IA.' },
  { id: 'tablero', name: 'Tablero', category: 'funcional', layout: 'tablero', theme: 'app',
    description: 'Tarjetas agrupadas por tema, cada una con su estado, dificultad y mejor puntaje.',
    bestFor: 'Clases con muchos módulos: se ve todo de un vistazo y se llega rápido a cada uno.' },

  // ── Infantiles ──
  { id: 'camino-aventura', name: 'Camino de aventura', category: 'infantil', layout: 'camino', theme: 'aventura',
    description: 'Un camino que serpentea con paradas numeradas y bordes gruesos de colores.',
    bestFor: 'Primaria: cada módulo es una parada del camino.' },
  { id: 'camino-arcoiris', name: 'Camino arcoíris', category: 'infantil', layout: 'camino', theme: 'arcoiris',
    description: 'El camino serpenteante en tonos pastel, suave y alegre.',
    bestFor: 'Los más pequeños.' },

  // ── Por area ──
  { id: 'bosque', name: 'Sendero del bosque', category: 'area', layout: 'camino', theme: 'naturaleza',
    description: 'Un sendero entre verdes y tierra, con paradas en forma de hoja.',
    bestFor: 'Biología, ciencias naturales y medio ambiente.' },
  { id: 'laboratorio', name: 'Laboratorio', category: 'area', layout: 'tablero', theme: 'laboratorio',
    description: 'Tablero turquesa sobre un fondo de hexágonos, con los módulos como casillas.',
    bestFor: 'Química y ciencias experimentales.' },
  { id: 'cuadricula', name: 'Cuaderno cuadriculado', category: 'area', layout: 'tablero', theme: 'cuadriculado',
    description: 'Tablero sobre hoja cuadriculada, con trazo de tinta azul.',
    bestFor: 'Matemáticas y lógica.' },
  { id: 'linea-tecnica', name: 'Línea técnica', category: 'area', layout: 'metro', theme: 'plano',
    description: 'Líneas de metro sobre azul de plano: una línea por tema y una estación por módulo.',
    bestFor: 'Física, tecnología e ingeniería.' },
  { id: 'ruta-tiempo', name: 'Ruta del tiempo', category: 'area', layout: 'camino', theme: 'archivo',
    description: 'Un camino sobre pergamino sepia, con paradas como sellos de cera.',
    bestFor: 'Ciencias sociales, historia y geografía.' },
  { id: 'biblioteca', name: 'Biblioteca', category: 'area', layout: 'metro', theme: 'libro',
    description: 'Estaciones como un índice de libro: una línea por tema, en serif sobre papel crema.',
    bestFor: 'Lenguaje, literatura y lectura.' },

  // ── Esteticas ──
  { id: 'neon', name: 'Metro neón', category: 'estetica', layout: 'metro', theme: 'neon',
    description: 'Líneas de metro de neón sobre fondo oscuro.',
    bestFor: 'Secundaria y media, con un estilo moderno.' },
  { id: 'brutalista', name: 'Tablero neobrutalista', category: 'estetica', layout: 'tablero', theme: 'brutalista',
    description: 'Bordes negros gruesos, sombras duras y colores planos.',
    bestFor: 'Cualquier materia, con personalidad fuerte y muy legible.' },
  { id: 'aurora', name: 'Camino de aurora', category: 'estetica', layout: 'camino', theme: 'aurora',
    description: 'El camino sobre una aurora violeta y turquesa, con paradas de vidrio.',
    bestFor: 'Cualquier materia, con un aire moderno y suave.' },
  { id: 'editorial', name: 'Metro editorial', category: 'estetica', layout: 'metro', theme: 'editorial',
    description: 'Blanco y negro de revista: líneas finas, estaciones numeradas y mucho aire.',
    bestFor: 'Cualquier materia, con un aire sobrio y elegante.' },
] as const satisfies readonly MapTemplateInfo[];

export type MapTemplateId = (typeof MAP_TEMPLATES)[number]['id'];

export const DEFAULT_MAP_TEMPLATE: MapTemplateId = 'islas';

export const isMapTemplateId = (v: unknown): v is MapTemplateId => typeof v === 'string' && MAP_TEMPLATES.some((t) => t.id === v);

// Cualquier valor que no sea una plantilla conocida (columna aun sin migrar, plantilla retirada, dato corrupto) cae en el mapa de siempre: nunca rompe la pantalla.
export const normalizeMapTemplate = (v: unknown): MapTemplateId => (isMapTemplateId(v) ? v : DEFAULT_MAP_TEMPLATE);

export const getMapTemplate = (id: string): MapTemplateInfo => MAP_TEMPLATES.find((t) => t.id === normalizeMapTemplate(id))!;
