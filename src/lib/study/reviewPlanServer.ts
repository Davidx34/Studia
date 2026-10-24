// Lee de la base lo que necesita buildReviewPlan. Un fallo NUNCA debe impedir abrir el inicio: devuelve null.
// Las politicas RLS ya limitan las tarjetas a las clases del estudiante y el avance a su propio usuario.
// Tope de 1000 filas por consulta (limite de PostgREST): con mas, el conteo es aproximado.

import { buildReviewPlan, type PlanCard, type ReviewPlan } from './reviewPlan';

export interface ReviewPlanForDashboard extends ReviewPlan {
  targetClassroomName: string | null;
}

export async function getReviewPlan(supabase: any, userId: string, classroomIds: string[]): Promise<ReviewPlanForDashboard | null> {
  if (classroomIds.length === 0) return null;
  try {
    const { data: materials } = await supabase
      .from('teaching_materials')
      .select('id, classroom_id')
      .in('classroom_id', classroomIds)
      .eq('processing_status', 'completed');
    const classByMaterial = new Map<string, string>((materials ?? []).map((m: any) => [m.id, m.classroom_id]));
    if (classByMaterial.size === 0) return null;

    const { data: cardRows } = await supabase
      .from('study_cards')
      .select('id, material_id')
      .in('material_id', Array.from(classByMaterial.keys()))
      .eq('kind', 'flashcard')
      .order('material_id')
      .order('position')
      .limit(1000);
    const cards: PlanCard[] = (cardRows ?? []).map((c: any) => ({ id: c.id, materialId: c.material_id, classroomId: classByMaterial.get(c.material_id) as string }));
    if (cards.length === 0) return null;

    const { data: stateRows } = await supabase.from('student_card_state').select('card_id, due_at').eq('student_id', userId).limit(1000);
    const plan = buildReviewPlan(cards, stateRows ?? []);

    let targetClassroomName: string | null = null;
    if (plan.target) {
      const { data: cls } = await supabase.from('classrooms').select('name').eq('id', plan.target.classroomId).maybeSingle();
      targetClassroomName = cls?.name ?? null;
    }
    return { ...plan, targetClassroomName };
  } catch (e) {
    console.warn('[review-plan]', e);
    return null;
  }
}
