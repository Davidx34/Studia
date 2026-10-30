// Memoria de una clase: lo que la IA "sabe" de la materia segun los materiales cargados. Es un GRAFO de conceptos (nodos) y relaciones (aristas), cada concepto con la referencia
// a los fragmentos de donde salio. Sin React ni red, para poder probarlo. La memoria se arma por material (extraccion) y se FUSIONA por clase (merge.ts): borrar un material
// no obliga a volver a llamar a la IA, solo a fusionar de nuevo.

// Los cuatro primeros y 'ejemplo' son de materias cuantitativas; persona/lugar/evento/periodo/obra son de materias narrativas (historia, literatura, geografia...).
export const CONCEPT_KINDS = ['concepto', 'variable', 'formula', 'ley', 'definicion', 'objetivo', 'ejemplo', 'persona', 'grupo', 'lugar', 'evento', 'periodo', 'obra'] as const;
export type ConceptKind = (typeof CONCEPT_KINDS)[number];

export const KIND_LABEL: Record<ConceptKind, string> = {
  concepto: 'Concepto',
  variable: 'Variable',
  formula: 'Fórmula',
  ley: 'Ley o principio',
  definicion: 'Definición',
  objetivo: 'Objetivo',
  ejemplo: 'Ejemplo',
  persona: 'Personaje',
  grupo: 'Pueblo o grupo',
  lugar: 'Lugar',
  evento: 'Evento',
  periodo: 'Periodo',
  obra: 'Obra o documento',
};

// 'requiere': A requiere B (B es prerrequisito de A). 'se_calcula_con': A se calcula a partir de B. 'parte_de': A es parte de B. 'relacionado': sin direccion clara.
// Solo narrativas: 'causa': A provoca u origina B. 'ocurre_en': A sucede en (o pertenece a) el lugar o periodo B.
export const RELATIONS = ['requiere', 'se_calcula_con', 'parte_de', 'relacionado', 'causa', 'ocurre_en'] as const;
export type Relation = (typeof RELATIONS)[number];

export interface SourceRef {
  materialId: string;
  // Indices de los fragmentos (material_chunks.chunk_index) donde aparece.
  chunks: number[];
}

export interface Concept {
  // Clave normalizada (sin tildes ni articulos): dos materiales que hablan del mismo concepto con palabras parecidas caen en la misma clave.
  key: string;
  name: string;
  kind: ConceptKind;
  definition: string;
  // Texto plano de la formula (por ejemplo "U = x^a * y^(1-a)"); vacio si no hay.
  formula: string;
  unit: string;
  // 1 (secundario) a 5 (central).
  importance: number;
  // Cuantas veces se menciono entre materiales y fragmentos: sube la importancia de lo que se repite.
  mentions: number;
  sources: SourceRef[];
}

export interface Edge {
  from: string;
  to: string;
  relation: Relation;
  weight: number;
}

export interface Graph {
  concepts: Concept[];
  edges: Edge[];
}

// Lo que sale de UN material.
export type MaterialExtraction = Graph;

// Que tipo de materia es un material: decide el vocabulario con el que la IA lo lee. 'cuantitativo' (formulas, variables, leyes) o 'narrativo' (hechos, personas, lugares, causas).
export type Profile = 'cuantitativo' | 'narrativo';

export const MEMORY_LIMITS = {
  name: 80,
  definition: 320,
  formula: 200,
  unit: 24,
  conceptsPerGroup: 30,
  // Topes holgados: una clase de historia real (4 materiales) dio 426 conceptos y los topes anteriores (120 por material, 400 por clase) la recortaban. El limite de la base
  // mide el tamaño COMPRIMIDO (la memoria de 400 conceptos pesa ~52 KB frente a un limite de 800 KB), asi que hay margen.
  conceptsPerMaterial: 250,
  conceptsPerClass: 800,
  edgesPerClass: 2400,
  maxGroupsPerMaterial: 12,
  // Desde cuantos conceptos la importancia se reparte por percentiles (con menos, se usa el puntaje absoluto).
  percentileMin: 20,
  // Bloques que se leen a la vez (en paralelo) con la IA.
  concurrency: 3,
  // Dos claves de igual numero de palabras se funden si cada palabra es igual o parecida (Dice sobre bigramas >= esto): tolera un error de tipeo, no un concepto distinto.
  tokenSimilarity: 0.75,
} as const;

export const EMPTY_GRAPH: Graph = { concepts: [], edges: [] };
