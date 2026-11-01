// Acceso al BANCO de preguntas (lesson_questions) desde el servidor, en nombre de un estudiante.
//
// El banco guarda las CLAVES (ok, answers, keywords, game_data) y hoy cualquier estudiante matriculado puede leerlo con la llave publica (politica students_read_lesson_questions) e incluso
// INSERTAR preguntas en el banco de su clase (students_insert_lesson_questions). Para poder cerrar las dos (migracion 086) el servidor lee y escribe el banco con la llave de servicio,
// pero SOLO despues de comprobar el acceso con el cliente del usuario (RLS de content_modules: un estudiante ve los modulos de SUS clases; un profesor, los suyos).
//
// Sin llave de servicio (desarrollo local) se usa el cliente del usuario: funciona mientras las politicas de estudiante sigan abiertas.

import { createAdminSupabase, hasServiceRoleKey } from '@/lib/supabase/admin';

export function questionBank(userClient: any): any {
  return hasServiceRoleKey() ? createAdminSupabase() : userClient;
}
