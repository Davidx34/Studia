// Adaptador de BlueprintDb sobre el cliente de servicio de Supabase (las tablas nuevas aun no estan en los tipos generados, de ahi el `any`).
// Cada metodo lanza si la base responde con error: la ruta lo convierte en un 500 generico sin filtrar el mensaje.

import type { BlueprintDb, BlueprintRow } from './store';

export function supabaseBlueprintDb(admin: any): BlueprintDb {
  const check = (error: { message?: string } | null, what: string) => {
    if (error) throw new Error(`${what}: ${error.message ?? 'error'}`);
  };
  return {
    async list(classroomId) {
      const { data, error } = await admin.from('course_blueprints').select('id, version, status, doc').eq('classroom_id', classroomId).order('version', { ascending: true });
      check(error, 'blueprints.list');
      return (data ?? []) as BlueprintRow[];
    },
    async insertDraft(row) {
      const { data, error } = await admin
        .from('course_blueprints')
        .insert({ classroom_id: row.classroomId, teacher_id: row.teacherId, version: row.version, status: 'draft', doc: row.doc })
        .select('id, version, status, doc')
        .single();
      check(error, 'blueprints.insertDraft');
      return data as BlueprintRow;
    },
    async updateDraft(id, doc) {
      const { error } = await admin.from('course_blueprints').update({ doc }).eq('id', id).eq('status', 'draft');
      check(error, 'blueprints.updateDraft');
    },
    async archive(id) {
      const { error } = await admin.from('course_blueprints').update({ status: 'archived' }).eq('id', id).eq('status', 'published');
      check(error, 'blueprints.archive');
    },
    async publish(id) {
      const { error } = await admin.from('course_blueprints').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', id).eq('status', 'draft');
      check(error, 'blueprints.publish');
    },
  };
}
