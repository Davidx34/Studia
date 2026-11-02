// Adaptador de BankDb sobre el cliente de servicio de Supabase (las tablas nuevas aun no estan en los tipos generados, de ahi el `any`). Cada metodo lanza si la base responde con error
// (salvo el enunciado repetido, que se cuenta): la ruta lo convierte en un 500 generico sin filtrar el mensaje.

import type { BankDb, BankRow } from './examBank';

const COLUMNS = 'id, outcome_id, node_id, type, q, opts, ok, answers, keywords, pairs, exp, source_material_id, source_chunk, source_quote, review_status, judge_verdict, judge_problems';

export function supabaseBankDb(admin: any): BankDb {
  return {
    async insertQuestions(blueprintId, classroomId, rows) {
      let inserted = 0;
      let duplicates = 0;
      // De a una: una pregunta que la base rechaza (p. ej. el mismo enunciado) no debe tirar las demas.
      for (const row of rows) {
        const { error } = await admin.from('exam_questions').insert({ ...row, blueprint_id: blueprintId, classroom_id: classroomId });
        if (!error) inserted++;
        else if (error.code === '23505') duplicates++;
        else throw new Error(`bank.insert: ${error.message ?? 'error'}`);
      }
      return { inserted, duplicates };
    },
    async listQuestions(blueprintId) {
      const { data, error } = await admin.from('exam_questions').select(COLUMNS).eq('blueprint_id', blueprintId).order('created_at', { ascending: true });
      if (error) throw new Error(`bank.list: ${error.message ?? 'error'}`);
      return (data ?? []) as BankRow[];
    },
    async setReview({ classroomId, questionId, status, reviewerId, reviewedAt }) {
      const { data, error } = await admin
        .from('exam_questions')
        .update({ review_status: status, reviewed_by: reviewerId, reviewed_at: reviewedAt })
        .eq('id', questionId)
        .eq('classroom_id', classroomId)
        .select('id');
      if (error) throw new Error(`bank.review: ${error.message ?? 'error'}`);
      return Array.isArray(data) && data.length > 0;
    },
  };
}
