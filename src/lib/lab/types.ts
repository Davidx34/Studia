// Laboratorios de la app: un experimento en un AMBIENTE CONTROLADO que el estudiante explora cambiando variables y midiendo resultados. Sin React ni red, para poder probarlo.
//
// El modelo de seguridad (decision de diseño): la IA NUNCA escribe codigo. Una plantilla de laboratorio es un archivo HTML nuestro (public/labs/*.html) con su modelo
// matematico ya revisado; lo unico que genera la IA o el profesor es la FICHA DEL EXPERIMENTO (LabSpec): titulo, objetivo, que variable se mueve, rangos, constantes y
// preguntas. Esa ficha se valida y se recorta a los limites de la plantilla (labSpec.ts) antes de llegar a un estudiante, y el laboratorio corre en un iframe aislado.

export type LabArea = 'fisica' | 'quimica' | 'biologia' | 'economia' | 'matematicas' | 'estadistica';

export const LAB_AREA_LABEL: Record<LabArea, string> = {
  fisica: 'Física',
  quimica: 'Química',
  biologia: 'Biología',
  economia: 'Economía',
  matematicas: 'Matemáticas',
  estadistica: 'Estadística',
};

// Una variable que el estudiante puede mover (dentro de [min, max]).
export interface LabVariableDef {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
  decimals: number;
}

// Un valor del entorno que normalmente queda fijo (por ejemplo la gravedad). El profesor puede cambiarlo dentro de [min, max] (la Luna, otro mercado...).
export interface LabConstantDef {
  id: string;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  decimals: number;
}

// Algo que el experimento calcula a partir de las variables y las constantes.
export interface LabOutputDef {
  id: string;
  label: string;
  unit: string;
  decimals: number;
}

export interface LabTemplateInfo {
  id: string;
  name: string;
  area: LabArea;
  // Que concepto se explora (una frase) y para que materias sirve.
  concept: string;
  description: string;
  bestFor: string;
  variables: LabVariableDef[];
  constants: LabConstantDef[];
  outputs: LabOutputDef[];
  // La variable independiente por defecto (la unica que se mueve en modo controlado) y la grafica inicial.
  defaultIndependent: string;
  defaultChart: { x: string; y: string };
  defaultQuestions: string[];
}

// La ficha del experimento: lo unico que cambia entre un laboratorio y otro de la misma plantilla.
export type LabMode = 'controlado' | 'libre';

export interface LabVariableOverride {
  min?: number;
  max?: number;
  default?: number;
}

export interface LabSpec {
  template: string;
  title: string;
  objective: string;
  // Contexto breve del escenario (opcional).
  context: string;
  hypothesisPrompt: string;
  independent: string;
  // 'controlado': solo la variable independiente se mueve y las demas quedan fijas (lo que hace a un experimento valido). 'libre': se mueven todas.
  mode: LabMode;
  variables: Record<string, LabVariableOverride>;
  constants: Record<string, number>;
  minTrials: number;
  // Si se dibuja la curva teorica del modelo en la grafica (por defecto no: el estudiante la descubre con sus datos).
  showModelCurve: boolean;
  questions: string[];
}

// Lo que recibe el laboratorio (el iframe): la plantilla ya combinada con la ficha, todo recortado a los limites de la plantilla.
export interface ResolvedVariable extends LabVariableDef {
  role: 'independiente' | 'controlada';
  // Bloqueada: el estudiante no puede moverla (modo controlado y no es la independiente).
  locked: boolean;
}

export interface ResolvedLab {
  template: string;
  title: string;
  objective: string;
  context: string;
  hypothesisPrompt: string;
  mode: LabMode;
  independent: string;
  minTrials: number;
  showModelCurve: boolean;
  questions: { id: string; text: string }[];
  variables: ResolvedVariable[];
  constants: { id: string; label: string; unit: string; value: number; decimals: number }[];
  outputs: LabOutputDef[];
  chart: { x: string; y: string };
}

// Un ensayo registrado por el estudiante.
export interface LabTrial {
  n: number;
  // Ensayo de control: la linea base contra la que se compara.
  control: boolean;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
}

// Todo lo que el estudiante produce en un laboratorio (lo que se guarda).
export interface LabAttemptState {
  hypothesis: string;
  trials: LabTrial[];
  answers: string[];
  conclusion: string;
}

export const EMPTY_ATTEMPT: LabAttemptState = { hypothesis: '', trials: [], answers: [], conclusion: '' };
