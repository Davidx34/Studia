// Marca un modulo como "en progreso" cuando se le sirven las preguntas al estudiante. Antes lo hacia el navegador (markInProgress en la pagina de la leccion) escribiendo en
// student_progress con la politica ALL del propio estudiante; para poder dejar esa tabla de solo lectura (migracion 086) lo hace el servidor, que ademas sabe cuando de verdad se sirvieron.
//
//   - Un modulo ya completado NO vuelve a "en progreso" por reintentarlo (eso borraria el hecho de que ya lo termino).
//   - Se conserva la fecha de inicio original.
//   - Nunca lanza ni retrasa la leccion: ante cualquier problema solo se registra.
//   - Sin llave de servicio no escribe (el navegador ya no lo hace): el modulo simplemente no se marca "en progreso".

import { createAdminSupabase, hasServiceRoleKey } from '@/lib/supabase/admin';

export async function markLessonInProgress(userClient: { auth: { getUser: () => PromiseLike<any> } }, moduleId: string, now: () => Date = () => new Date()): Promise<void> {
  try {
    if (!hasServiceRoleKey()) return;
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return;

    const admin: any = createAdminSupabase();
    const { data: existing } = await admin.from('student_progress').select('status, started_at').eq('student_id', user.id).eq('module_id', moduleId).maybeSingle();
    if (existing?.status === 'completed') return;

    const at = now().toISOString();
    const { error } = await admin.from('student_progress').upsert(
      {
        student_id: user.id,
        module_id: moduleId,
        status: 'in_progress',
        completion_percentage: 0,
        started_at: existing?.started_at ?? at,
        last_attempt_at: at,
      },
      { onConflict: 'student_id,module_id' }
    );
    if (error) console.warn('[progress] no se pudo marcar en progreso:', error.message);
  } catch (e) {
    console.warn('[progress] error marcando en progreso:', e instanceof Error ? e.message : e);
  }
}
