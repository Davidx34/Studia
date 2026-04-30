// Constantes de UI para clases (subject + grade selectors)
// Fase 11.B · Stud.ia
//
// Ambas listas son strings libres en la DB (TEXT NULL en classrooms).
// Las usamos solo como opciones del UI para consistencia.

export const SUBJECT_AREAS = [
  'Matemáticas',
  'Lengua',
  'Ciencias Naturales',
  'Geografía',
  'Historia',
  'Inglés',
  'Educación Física',
  'Arte',
  'Música',
  'Tecnología',
  'Otra',
] as const;

export type SubjectArea = (typeof SUBJECT_AREAS)[number];

export const GRADE_LEVELS = [
  'Primaria 1°',
  'Primaria 2°',
  'Primaria 3°',
  'Primaria 4°',
  'Primaria 5°',
  'Primaria 6°',
  'Secundaria 1°',
  'Secundaria 2°',
  'Secundaria 3°',
  'Secundaria 4°',
  'Secundaria 5°',
  'Secundaria 6°',
  'Otro',
] as const;

export type GradeLevel = (typeof GRADE_LEVELS)[number];

// Opciones para el textarea de "Invitar estudiantes"
export const INVITE_PLACEHOLDER = `luza@studia.test, juan@gmail.com
maria@hotmail.com
pablo@studia.test`;
