import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { callStudyModel, hasStudyProvider } from '@/lib/study/generate';
import { getLabTemplate } from '@/lib/lab/labTemplates';
import { PROPOSAL_LIMITS, materialExcerpt, proposeLab } from '@/lib/lab/propose';

// La IA propone la ficha de un laboratorio (solo DATOS, nunca codigo) a partir de una idea o de un material de la clase. Solo el profesor DUEÑO de la clase (y del material, si
// se usa uno): cualquier otro recibe 404, como si no existiera. La ficha vuelve ya validada y recortada a los limites de la plantilla; el profesor la revisa antes de publicarla.
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CHUNKS = 40;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const classroomId = typeof body?.classroomId === 'string' ? body.classroomId : '';
    const materialId = typeof body?.materialId === 'string' && body.materialId ? body.materialId : null;
    const idea = typeof body?.idea === 'string' ? body.idea.slice(0, PROPOSAL_LIMITS.idea * 2) : '';
    // 'auto' o ausente: la IA elige la plantilla. Una plantilla desconocida es un error del que llama.
    const wanted = typeof body?.template === 'string' && body.template && body.template !== 'auto' ? body.template : null;

    if (!UUID_RE.test(classroomId)) return NextResponse.json({ error: 'classroomId invalido' }, { status: 400 });
    if (materialId && !UUID_RE.test(materialId)) return NextResponse.json({ error: 'materialId invalido' }, { status: 400 });
    if (wanted && !getLabTemplate(wanted)) return NextResponse.json({ error: 'La plantilla elegida no existe.' }, { status: 400 });
    if (!idea.trim() && !materialId) return NextResponse.json({ error: 'Escribe una idea o elige un material para que la IA proponga el experimento.' }, { status: 400 });

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    // Solo el profesor dueño de la clase.
    const { data: classroom } = await supabase.from('classrooms').select('id').eq('id', classroomId).eq('teacher_id', user.id).maybeSingle();
    if (!classroom) return NextResponse.json({ error: 'Clase no encontrada' }, { status: 404 });

    let materialText = '';
    if (materialId) {
      // El material debe ser del profesor Y de esta clase.
      const { data: material } = await supabase
        .from('teaching_materials')
        .select('id')
        .eq('id', materialId)
        .eq('classroom_id', classroomId)
        .eq('teacher_id', user.id)
        .maybeSingle();
      if (!material) return NextResponse.json({ error: 'Material no encontrado' }, { status: 404 });
      const { data: chunks } = await supabase.from('material_chunks').select('chunk_index, content').eq('material_id', materialId).order('chunk_index').limit(MAX_CHUNKS);
      materialText = materialExcerpt(chunks ?? []);
    }

    if (!hasStudyProvider()) return NextResponse.json({ error: 'No hay un proveedor de IA configurado.' }, { status: 503 });

    const result = await proposeLab({ idea, materialText, template: wanted }, callStudyModel);
    if (result.ok) return NextResponse.json({ spec: result.spec, warnings: result.warnings, sourceMaterialId: materialId });
    // "No se presta" es una respuesta legitima (el tema no encaja con ninguna plantilla), no un fallo del servidor.
    if (result.reason === 'noFit') return NextResponse.json({ error: result.message, reason: result.reason }, { status: 422 });
    return NextResponse.json({ error: result.message, reason: result.reason }, { status: 502 });
  } catch (e) {
    console.error('[lab/propose] error:', e);
    return NextResponse.json({ error: 'Error inesperado.' }, { status: 500 });
  }
}
