// Plantillas de las infografias. Igual que las fichas y el mapa: la IA genera DATOS (linea de tiempo, comparativa, proceso o cifras; ver infographics.ts) y la app los pinta.
// Aqui la plantilla es un TEMA (fichaThemes.ts) que se aplica a los cuatro tipos: cada tipo tiene su estructura propia y el tema pone paleta, tipografia, formas y fondo.
// 'clasica' es la de siempre (InfographicView) y sigue los colores de la app en claro y oscuro.
//
// El profesor elige la de su clase; se guarda solo el id en classrooms.infographic_template (migracion 077). Un id desconocido o ausente usa 'clasica'.

import { FICHA_CATEGORY_HINT, FICHA_CATEGORY_LABEL, type FichaCategory } from './fichaTemplates';
import type { Infographic } from './infographics';

export type InfographicCategory = FichaCategory;
export const INFOGRAPHIC_CATEGORY_LABEL = FICHA_CATEGORY_LABEL;
export const INFOGRAPHIC_CATEGORY_HINT = FICHA_CATEGORY_HINT;

export interface InfographicTemplateInfo {
  id: string;
  name: string;
  description: string;
  bestFor: string;
  category: InfographicCategory;
  // Id de un tema de fichaThemes.ts (null = la clasica, que sigue los colores de la app).
  theme: string | null;
}

export const INFOGRAPHIC_TEMPLATES = [
  { id: 'clasica', name: 'Clásica', category: 'funcional', theme: null,
    description: 'Tarjeta sobria con los colores de la app, en claro y oscuro.',
    bestFor: 'Uso general: se lee bien en cualquier pantalla.' },

  // ── Infantiles ──
  { id: 'aventura', name: 'Aventura', category: 'infantil', theme: 'aventura',
    description: 'Bordes gruesos, burbujas de colores y letras redondas; las cifras en bloques grandes.',
    bestFor: 'Primaria: pasos, fechas y cifras con mucho color.' },
  { id: 'arcoiris', name: 'Arcoíris', category: 'infantil', theme: 'arcoiris',
    description: 'Bloques pastel suaves con puntitos de colores de fondo.',
    bestFor: 'Los más pequeños: tranquila, alegre y fácil de recorrer.' },

  // ── Por area ──
  { id: 'naturaleza', name: 'Naturaleza', category: 'area', theme: 'naturaleza',
    description: 'Verdes y tierra, formas orgánicas y números en forma de hoja.',
    bestFor: 'Biología y ciencias naturales: ciclos, procesos y clasificaciones.' },
  { id: 'laboratorio', name: 'Laboratorio', category: 'area', theme: 'laboratorio',
    description: 'Turquesa sobre un fondo de hexágonos, con letra técnica en las etiquetas.',
    bestFor: 'Química y ciencias experimentales: procesos y comparativas.' },
  { id: 'cuadriculado', name: 'Cuaderno cuadriculado', category: 'area', theme: 'cuadriculado',
    description: 'Hoja cuadriculada con trazo de tinta azul y notas amarillas.',
    bestFor: 'Matemáticas: procedimientos paso a paso y cifras.' },
  { id: 'plano', name: 'Plano técnico', category: 'area', theme: 'plano',
    description: 'Azul de plano con rejilla y letra técnica.',
    bestFor: 'Física e ingeniería: procesos, magnitudes y comparativas.' },
  { id: 'archivo', name: 'Archivo histórico', category: 'area', theme: 'archivo',
    description: 'Pergamino sepia con tipografía clásica y sellos de cera.',
    bestFor: 'Ciencias sociales e historia: líneas de tiempo.' },
  { id: 'libro', name: 'Libro', category: 'area', theme: 'libro',
    description: 'Página de libro: serif sobre papel crema, con acentos en burdeos.',
    bestFor: 'Lenguaje y literatura: épocas, autores y comparativas.' },

  // ── Esteticas ──
  { id: 'editorial', name: 'Editorial minimal', category: 'estetica', theme: 'editorial',
    description: 'Blanco y negro de revista: titulares fuertes y líneas finas.',
    bestFor: 'Cualquier materia, con un aire sobrio y elegante.' },
  { id: 'neon', name: 'Neón', category: 'estetica', theme: 'neon',
    description: 'Fondo oscuro con bloques de neón cian, rosa y violeta.',
    bestFor: 'Secundaria y media: un estilo moderno para datos y cifras.' },
  { id: 'brutalista', name: 'Neobrutalista', category: 'estetica', theme: 'brutalista',
    description: 'Bordes negros gruesos, sombras duras y colores planos y vivos.',
    bestFor: 'Cualquier materia, con personalidad fuerte y muy legible.' },
  { id: 'aurora', name: 'Aurora de cristal', category: 'estetica', theme: 'aurora',
    description: 'Tarjetas de vidrio esmerilado sobre una aurora violeta y turquesa.',
    bestFor: 'Cualquier materia, con un aire moderno y suave.' },
] as const satisfies readonly InfographicTemplateInfo[];

export type InfographicTemplateId = (typeof INFOGRAPHIC_TEMPLATES)[number]['id'];

export const DEFAULT_INFOGRAPHIC_TEMPLATE: InfographicTemplateId = 'clasica';

export const isInfographicTemplateId = (v: unknown): v is InfographicTemplateId => typeof v === 'string' && INFOGRAPHIC_TEMPLATES.some((t) => t.id === v);

// Cualquier valor que no sea una plantilla conocida (columna aun sin migrar, plantilla retirada, dato corrupto) cae en la de siempre: nunca rompe la pantalla.
export const normalizeInfographicTemplate = (v: unknown): InfographicTemplateId => (isInfographicTemplateId(v) ? v : DEFAULT_INFOGRAPHIC_TEMPLATE);

export const getInfographicTemplate = (id: string): InfographicTemplateInfo => INFOGRAPHIC_TEMPLATES.find((t) => t.id === normalizeInfographicTemplate(id))!;

// Una infografia lista para pintar (lo que guarda study_cards: front = titulo, extra = los datos).
export interface InfographicItem {
  id: string;
  title: string;
  section: string | null;
  data: Infographic;
}

// Ejemplos para la vista previa cuando el profesor todavia no genero infografias: uno de cada tipo.
export const SAMPLE_INFOGRAPHICS: InfographicItem[] = [
  {
    id: 'ejemplo-tiempo',
    title: 'La Independencia de Colombia',
    section: 'Historia',
    data: {
      tipo: 'timeline',
      titulo: 'La Independencia de Colombia',
      eventos: [
        { cuando: '1810', titulo: 'Grito de Independencia', detalle: 'El 20 de julio estalla la revuelta en Santafé de Bogotá.' },
        { cuando: '1819', titulo: 'Batalla de Boyacá', detalle: 'Las fuerzas de Bolívar derrotan a las realistas.' },
        { cuando: '1821', titulo: 'Congreso de Cúcuta', detalle: 'Se crea la República de Colombia.' },
        { cuando: '1830', titulo: 'Disolución', detalle: 'Se separan Venezuela y Ecuador.' },
      ],
    },
  },
  {
    id: 'ejemplo-comparativa',
    title: 'Células vegetales y animales',
    section: 'Biología',
    data: {
      tipo: 'comparison',
      titulo: 'Células vegetales y animales',
      columnas: ['Vegetal', 'Animal'],
      filas: [
        { criterio: 'Pared celular', valores: ['Presente, de celulosa', 'Ausente'] },
        { criterio: 'Cloroplastos', valores: ['Sí tiene', 'No tiene'] },
        { criterio: 'Vacuola', valores: ['Una grande central', 'Varias pequeñas'] },
      ],
    },
  },
  {
    id: 'ejemplo-proceso',
    title: 'El ciclo del agua',
    section: 'Ciencias',
    data: {
      tipo: 'process',
      titulo: 'El ciclo del agua',
      pasos: [
        { titulo: 'Evaporación', detalle: 'El sol calienta el agua y la convierte en vapor.' },
        { titulo: 'Condensación', detalle: 'El vapor se enfría y forma nubes.' },
        { titulo: 'Precipitación', detalle: 'El agua cae como lluvia o nieve.' },
        { titulo: 'Recolección', detalle: 'El agua vuelve a ríos, lagos y mares.' },
      ],
    },
  },
  {
    id: 'ejemplo-cifras',
    title: 'La Tierra en cifras',
    section: 'Ciencias',
    data: {
      tipo: 'stats',
      titulo: 'La Tierra en cifras',
      cifras: [
        { valor: '71 %', etiqueta: 'de la superficie es agua', nota: 'Casi todo, océanos' },
        { valor: '12 742 km', etiqueta: 'de diámetro', nota: '' },
        { valor: '365', etiqueta: 'días en una vuelta al Sol', nota: 'Más un cuarto de día' },
      ],
    },
  },
];
