// Memoria de una clase: lo que la IA "sabe" de la materia segun los materiales cargados. Es un GRAFO de conceptos (nodos) y relaciones (aristas), cada concepto con la referencia
// a los fragmentos de donde salio. Sin React ni red, para poder probarlo. La memoria se arma por material (extraccion) y se FUSIONA por clase (merge.ts): borrar un material
// no obliga a volver a llamar a la IA, solo a fusionar de nuevo.

export const CONCEPT_KINDS = ['concepto', 'variable', 'formula', 'ley', 'definicion', 'objetivo', 'ejemplo'] as const;
export type ConceptKind = (typeof CONCEPT_KINDS)[number];

export const KIND_LABEL: Record<ConceptKind, string> = {
  concepto: 'Concepto',
  variable: 'Variable',
  formula: 'Fórmula',
  ley: 'Ley o principio',
  definicion: 'Definición',
  objetivo: 'Objetivo',
  ejemplo: 'Ejemplo',
};

// 'requiere': A requiere B (B es prerrequisito de A). 'se_calcula_con': A se calcula a partir de B. 'parte_de': A es parte de B. 'relacionado': sin direccion clara.
export const RELATIONS = ['requiere', 'se_calcula_con', 'parte_de', 'relacionado'] as const;
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

export const MEMORY_LIMITS = {
  name: 80,
  definition: 320,
  formula: 200,
  unit: 24,
  conceptsPerGroup: 30,
  conceptsPerMaterial: 120,
  conceptsPerClass: 400,
  edgesPerClass: 1200,
  maxGroupsPerMaterial: 12,
  // Dos claves de igual numero de palabras se funden si cada palabra es igual o parecida (Dice sobre bigramas >= esto): tolera un error de tipeo, no un concepto distinto.
  tokenSimilarity: 0.75,
} as const;

export const EMPTY_GRAPH: Graph = { concepts: [], edges: [] };
