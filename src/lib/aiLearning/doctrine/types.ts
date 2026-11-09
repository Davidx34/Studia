// Doctrina pedagogica global: tipos. Es conocimiento CURADO (principios, no textos): cada principio tiene enunciado propio, una regla operativa para la IA, sus limites, su nivel de evidencia y fuentes
// con estado de verificacion. No contiene texto de obras protegidas: solo resumenes propios con cita.

/** Fuerza de la evidencia: fuerte = replicada y consistente; moderada = respaldo razonable con matices; limitada = sobre todo teorica o poca investigacion; discutida = hay controversia real (se muestra, NO entra a los prompts). */
export type Evidence = 'fuerte' | 'moderada' | 'limitada' | 'discutida';

/** Tarea de la IA en la que se aplica un principio. */
export type Task = 'generar_pregunta' | 'retroalimentar' | 'interpretar_resultados' | 'investigar' | 'planificar' | 'juzgar';

export type Domain = 'aprendizaje' | 'evaluacion' | 'retroalimentacion' | 'motivacion' | 'creatividad_e_indagacion' | 'datos' | 'mitos';

export interface Source {
  id: string;
  authors: string;
  year: number;
  title: string;
  /** Revista, editorial o institucion. */
  venue: string;
  /** Volumen y paginas cuando se comprobaron (si hay duda, se omiten). */
  detail?: string;
  doi?: string;
  kind: 'articulo' | 'libro' | 'capitulo' | 'informe';
  /** true = se comprobo su existencia y datos bibliograficos por busqueda en linea (fecha en verifiedOn). false = cita de referencia pendiente de verificar. */
  verified: boolean;
  verifiedOn?: string;
  /** Matiz que debe acompanar a la cita (replicacion, controversia, cifra no verificada). */
  caveat?: string;
}

export interface Principle {
  id: string;
  domain: Domain;
  title: string;
  /** Que dice la investigacion, en palabras propias. */
  essence: string;
  /** Regla OPERATIVA para la IA, en imperativo y comprobable. Es lo unico que puede entrar a un prompt. */
  apply: string;
  /** Que NO hacer (opcional). */
  avoid?: string;
  /** Cuando no aplica o donde la evidencia es debil. */
  limits: string;
  evidence: Evidence;
  sources: string[];
  tasks: Task[];
  /** Etiquetas para seleccionar por contexto (tipo de pregunta, nivel, etc.). */
  tags: string[];
  /** true = describe lo que NO hay que creer ni hacer (mito). Nunca entra a un prompt como «aplica». */
  antiPrinciple?: boolean;
}

export const TASK_LABELS: Record<Task, string> = {
  generar_pregunta: 'Generar preguntas',
  retroalimentar: 'Dar retroalimentación',
  interpretar_resultados: 'Interpretar resultados',
  investigar: 'Investigar y recomendar',
  planificar: 'Planificar el curso',
  juzgar: 'Juzgar la calidad de una pregunta',
};

export const DOMAIN_LABELS: Record<Domain, string> = {
  aprendizaje: 'Cómo se aprende',
  evaluacion: 'Evaluación y redacción de preguntas',
  retroalimentacion: 'Retroalimentación',
  motivacion: 'Motivación y emociones',
  creatividad_e_indagacion: 'Creatividad, indagación y conocimiento del profesor',
  datos: 'Interpretación de resultados',
  mitos: 'Lo que NO hay que creer ni hacer',
};

export const EVIDENCE_LABELS: Record<Evidence, string> = { fuerte: 'Evidencia fuerte', moderada: 'Evidencia moderada', limitada: 'Evidencia limitada', discutida: 'Evidencia discutida' };
