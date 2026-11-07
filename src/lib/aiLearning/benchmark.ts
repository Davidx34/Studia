// Fase 7 de «IA que aprende»: memoria global anonima. Taxonomia CERRADA (debe coincidir con los CHECK de la migracion 099) y texto de consentimiento versionado.

export const SUBJECTS = {
  matematicas: 'Matemáticas',
  lenguaje: 'Lenguaje y comunicación',
  ciencias_naturales: 'Ciencias naturales',
  ciencias_sociales: 'Ciencias sociales e historia',
  economia: 'Economía y administración',
  ingles: 'Inglés u otros idiomas',
  tecnologia: 'Tecnología e informática',
  artes: 'Artes',
  educacion_fisica: 'Educación física',
  otra: 'Otra',
} as const;

export const LEVELS = { primaria: 'Primaria', secundaria: 'Secundaria', bachillerato: 'Bachillerato', universitario: 'Universitario', otro: 'Otro' } as const;
export const AGE_BANDS = { '6-8': '6 a 8 años', '9-11': '9 a 11 años', '12-14': '12 a 14 años', '15-17': '15 a 17 años', '18+': '18 años o más' } as const;

export type Subject = keyof typeof SUBJECTS;
export type Level = keyof typeof LEVELS;
export type AgeBand = keyof typeof AGE_BANDS;

export const CONSENT_VERSION = 'v1-2026-11';
export const CONSENT_TEXT =
  'Autorizo que esta clase aporte a la memoria global estadísticas AGREGADAS y anónimas (porcentaje de acierto por tipo de pregunta, número de intentos). Nunca se comparten textos de materiales ni de preguntas, ' +
  'nombres, ni datos de estudiantes. Un dato solo se publica si lo aportan varias clases de varios profesores distintos (hoy, al menos 5 clases de 3 profesores). Puedo revocar esta autorización cuando quiera y mi clase dejará de aportar de inmediato.';

export interface Profile {
  subject: Subject;
  level: Level;
  ageBand: AgeBand;
}

const has = (o: object, k: unknown): boolean => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

export function parseProfile(input: { subject?: unknown; level?: unknown; ageBand?: unknown }): Profile | null {
  if (has(SUBJECTS, input.subject) && has(LEVELS, input.level) && has(AGE_BANDS, input.ageBand)) return { subject: input.subject as Subject, level: input.level as Level, ageBand: input.ageBand as AgeBand };
  return null;
}

export interface BenchmarkRow {
  question_type: string;
  n_classes: number;
  n_teachers: number;
  attempts: number;
  correct_rate: number;
}

export const TYPE_LABELS: Record<string, string> = {
  multiple_choice: 'Opción múltiple',
  true_false: 'Verdadero o falso',
  fill_blank: 'Completar frase',
  short_answer: 'Respuesta corta',
  match: 'Emparejar',
};

export const typeLabel = (t: string): string => TYPE_LABELS[t] ?? t.replace(/_/g, ' ');
