import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { parseReview } from '@/lib/lab/submission';

// El profesor dueño de la clase califica la entrega de un laboratorio. Se escribe con la SESION DEL PROFESOR (no con la llave de servicio): la politica de la tabla solo le deja tocar
// las entregas de sus clases y el permiso por columna solo le deja cambiar nota, comentario y estado (migracion 082). Si algo de eso no se cumple, no se actualiza ninguna fila.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const attemptId = typeof body?.attemptId === 'string' ? body.attemptId : '';
    if (!UUID_RE.test(attemptId)) return fail(400, 'Petición inválida.');
    const review = parseReview(body);
    if (!review.ok) return fail(400, review.error);

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail(401, 'No autenticado');

    const db: any = supabase;
    const { data, error } = await db
      .from('lab_attempts')
      .update({ score: review.score, teacher_feedback: review.feedback, status: 'reviewed' })
      .eq('id', attemptId)
      .select('id, score, teacher_feedback, status');
    if (error) {
      console.error('[lab/attempt/review] update:', error.message);
      return fail(500, 'No se pudo guardar la revisión.');
    }
    // Sin filas: la entrega no existe o no es de una clase de este profesor (la base no las deja ver ni tocar). Se responde igual en ambos casos.
    if (!data || data.length === 0) return fail(404, 'Entrega no encontrada');
    return NextResponse.json({ ok: true, attempt: data[0] });
  } catch (e) {
    console.error('[lab/attempt/review] error:', e);
    return fail(500, 'Error inesperado.');
  }
}
