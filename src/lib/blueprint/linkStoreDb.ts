// Adaptador de LinkDb sobre el cliente de servicio de Supabase (las tablas nuevas aun no estan en los tipos generados, de ahi el `any`).
// Cada metodo lanza si la base responde con error: la ruta lo convierte en un 500 generico sin filtrar el mensaje.

import type { LinkDb, StoredLink } from './linkStore';

export function supabaseLinkDb(admin: any): LinkDb {
  const check = (error: { message?: string } | null, what: string) => {
    if (error) throw new Error(`${what}: ${error.message ?? 'error'}`);
  };
  return {
    async classModuleIds(classroomId) {
      const { data, error } = await admin.from('content_modules').select('id').eq('classroom_id', classroomId);
      check(error, 'links.classModuleIds');
      return ((data ?? []) as { id: string }[]).map((r) => r.id);
    },
    async listLinks(blueprintId) {
      const { data, error } = await admin.from('blueprint_module_links').select('id, node_id, content_module_id').eq('blueprint_id', blueprintId);
      check(error, 'links.list');
      return ((data ?? []) as { id: string; node_id: string; content_module_id: string }[]).map((r): StoredLink => ({ id: r.id, nodeId: r.node_id, moduleId: r.content_module_id }));
    },
    async deleteLinks(ids) {
      const { error } = await admin.from('blueprint_module_links').delete().in('id', ids);
      check(error, 'links.delete');
    },
    async insertLinks(blueprintId, classroomId, links) {
      const rows = links.map((l) => ({ blueprint_id: blueprintId, classroom_id: classroomId, node_id: l.nodeId, content_module_id: l.moduleId }));
      const { error } = await admin.from('blueprint_module_links').insert(rows);
      check(error, 'links.insert');
    },
  };
}
