// Plan del curso "hacia atras": el profesor escribe un BORRADOR y la IA lo desarrolla desde el final. La cadena trazable es
//
//   comprension final  ->  evaluacion de corte  ->  objetivo  ->  modulo  ->  (preguntas del modulo)
//
// y la evaluacion final no se guarda aparte: es, por construccion, TODAS las comprensiones finales. Este archivo solo define la forma; las reglas viven en validate.ts, la regeneracion
// en regenerate.ts y las cuentas de avance y notas en progress.ts. Todo es codigo puro (sin base de datos, sin IA, sin reloj).

export const BLUEPRINT_LIMITS = {
  outcomes: 20,
  periods: 12,
  objectivesPerPeriod: 12,
  modulesPerObjective: 12,
  statement: 300, // texto de una comprension final
  title: 120, // nombre de un corte, objetivo o modulo
  idLength: 40,
} as const;

// Una COMPRENSION FINAL: lo que el estudiante debe entender al terminar el curso.
export interface Outcome {
  id: string;
  statement: string;
}

export interface BlueprintModule {
  id: string;
  title: string;
  order: number;
}

export interface BlueprintObjective {
  id: string;
  title: string;
  // Las comprensiones finales a las que este objetivo contribuye (tienen que ser de las que evalua su corte).
  outcomeIds: string[];
  modules: BlueprintModule[];
}

// Un CORTE (periodo) con su ponderacion y la evaluacion que toma el estudiante dentro de la app.
export interface Period {
  id: string;
  name: string;
  order: number;
  // Porcentaje de la nota del curso (la suma de todos los cortes es 100).
  weight: number;
  // Las comprensiones finales que evalua este corte.
  assessesOutcomeIds: string[];
  objectives: BlueprintObjective[];
}

export interface Blueprint {
  // Sube cada vez que se regenera lo de abajo: asi los intentos de los estudiantes siguen apuntando a la version con la que se hicieron.
  version: number;
  outcomes: Outcome[];
  periods: Period[];
}

export type IssueSeverity = 'error' | 'warning';

export type IssueCode =
  | 'weightSum' // los cortes no suman 100
  | 'weightRange' // un corte con ponderacion fuera de (0, 100]
  | 'noPeriods'
  | 'noOutcomes'
  | 'outcomeNotAssessed' // una comprension final que ningun corte evalua
  | 'periodAssessesNothing' // un corte que no evalua ninguna comprension
  | 'unknownOutcome' // un id de comprension que no existe
  | 'objectiveOutsideExam' // un objetivo que apunta a una comprension que su corte no evalua
  | 'objectiveWithoutOutcome'
  | 'assessedWithoutObjective' // un corte evalua una comprension para la que no ensena ningun objetivo
  | 'objectiveWithoutModules'
  | 'periodWithoutObjectives'
  | 'duplicateOrder'
  | 'duplicateOutcome'; // dos comprensiones finales con el mismo texto (aviso)

export interface Issue {
  severity: IssueSeverity;
  code: IssueCode;
  message: string;
  // id del elemento afectado (corte, objetivo, modulo o comprension), si aplica.
  ref?: string;
}

export type ParseResult = { ok: true; blueprint: Blueprint } | { ok: false; errors: string[] };
