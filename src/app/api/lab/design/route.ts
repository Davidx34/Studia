import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey } from '@/lib/supabase/admin';
import { QUOTA_POLICIES, consumeQuota, quotaDeniedBody, type QuotaRpc } from '@/lib/security/rateLimit';
import { callStudyModel, hasStudyProvider } from '@/lib/study/generate';
import { DESIGN_LIMITS, designLab } from '@/lib/lab/design';
import { getCachedClassGraph } from '@/lib/memory/graphCache';

// La IA DISEÑA un laboratorio a partir de la MEMORIA de la clase (lo que sus materiales explican). Primero comprueba si lo cargado alcanza para lo pedido: si no, no crea nada
// a medias y dice que falta. Si el diseño se crea, vuelve YA validado (formulas probadas con numeros en todos sus rangos) y con los conceptos en los que se apoya; el profesor
// lo revisa antes de publicarlo. Solo el profesor DUEÑO de la clase; cualquier otro recibe 404.
export const maxDuration = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const classroomId = typeof body?.classroomId === 'string' ? body.classroomId : '';
    const idea = typeof body?.idea === 'string' ? body.idea.slice(0, DESIGN_LIMITS.idea * 2) : '';
    // "force": el profesor acepta seguir cuando los materiales cubren solo una parte (nunca cuando falta algo esencial).
    const force = body?.force === true;

    if (!UUID_RE.test(classroomId)) return NextResponse.json({ error: 'classroomId invalido' }, { status: 400 });
    if (idea.trim().length < 10) return NextResponse.json({ error: 'Cuéntame qué quieres que investiguen (al menos una frase).' }, { status: 400 });

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: classroom } = await supabase.from('classrooms').select('id').eq('id', classroomId).eq('teacher_id', user.id).maybeSingle();
    if (!classroom) return NextResponse.json({ error: 'Clase no encontrada' }, { status: 404 });

    // La memoria (tabla nueva, aun no esta en los tipos generados). La lee con la sesion del profesor: la politica solo le deja leer la suya.
    // Cache versionado (src/lib/memory/graphCache.ts): primero una consulta ligera (status, version) CON la sesion del profesor; el grafo pesado solo se lee si esa version no esta en cache.
    const db: any = supabase;
    const mem = await getCachedClassGraph({
      classroomId,
      loadMeta: async () => {
        const { data } = await db.from('class_memory').select('status, version').eq('classroom_id', classroomId).maybeSingle();
        return data ? { status: String(data.status), version: Number(data.version) } : null;
      },
      loadRow: async () => {
        const { data } = await db.from('class_memory').select('status, version, graph').eq('classroom_id', classroomId).maybeSingle();
        return data ? { status: String(data.status), version: Number(data.version), graph: data.graph } : null;
      },
    });
    if (mem.kind === 'none' || mem.kind === 'failed') {
      return NextResponse.json({ error: 'Primero construye la memoria de la clase: así la IA conoce tus materiales.', reason: 'noMemory' }, { status: 409 });
    }
    if (mem.kind === 'building') {
      return NextResponse.json({ error: 'La memoria de la clase todavía se está construyendo. Espera a que termine.', reason: 'building' }, { status: 409 });
    }
    const graph = mem.graph;

    if (!hasStudyProvider()) return NextResponse.json({ error: 'No hay un proveedor de IA configurado.' }, { status: 503 });

    // Limite de uso POR PROFESOR (migracion 080): cada diseño hace de 2 a 4 llamadas a la IA. Ya se comprobo que es el dueño de la clase (404 si no) y que la memoria esta lista;
    // se consume justo antes de llamar a la IA, asi las peticiones rechazadas por validacion no gastan cupo. Sin llave de servicio, rateLimit.ts usa su respaldo en memoria.
    const admin: any = hasServiceRoleKey() ? createAdminSupabase() : null;
    const rpc: QuotaRpc = admin ? (fn, args) => admin.rpc(fn, args) : async () => ({ data: null, error: { message: 'sin llave de servicio' } });
    const quota = await consumeQuota(rpc, user.id, QUOTA_POLICIES.labDesign);
    if (!quota.allowed) {
      return NextResponse.json(quotaDeniedBody(quota.retryAfterSeconds, 'diseñar un laboratorio'), { status: 429, headers: { 'Retry-After': String(quota.retryAfterSeconds) } });
    }

    const result = await designLab({ idea, graph, allowPartial: force }, callStudyModel);
    if (result.ok) {
      // El material del que mas se apoya (si es del profesor y de esta clase), para vincularlo al laboratorio.
      const count: Record<string, number> = {};
      result.evidence.forEach((e) => e.sources.forEach((s) => (count[s.materialId] = (count[s.materialId] ?? 0) + s.chunks.length)));
      const top = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
      let sourceMaterialId: string | null = null;
      if (top && UUID_RE.test(top)) {
        const { data: m } = await supabase.from('teaching_materials').select('id').eq('id', top).eq('classroom_id', classroomId).eq('teacher_id', user.id).maybeSingle();
        sourceMaterialId = m ? top : null;
      }
      return NextResponse.json({
        spec: result.spec,
        warnings: result.warnings,
        evidence: result.evidence,
        formulaChecks: result.formulaChecks,
        coverage: { verdict: result.coverage.verdict, weak: result.coverage.weak },
        sourceMaterialId,
      });
    }
    // Falta conocimiento en los materiales, o el tema no se puede modelar: es una respuesta legitima (422), no un fallo del servidor.
    if (result.reason === 'insufficient' || result.reason === 'partial' || result.reason === 'noFit') {
      return NextResponse.json(
        { error: result.message, reason: result.reason, coverage: result.coverage ? { verdict: result.coverage.verdict, missing: result.coverage.missing, weak: result.coverage.weak } : null },
        { status: 422 }
      );
    }
    if (result.reason === 'invalid' && result.message.startsWith('Cuéntame')) return NextResponse.json({ error: result.message }, { status: 400 });
    return NextResponse.json({ error: result.message, reason: result.reason }, { status: 502 });
  } catch (e) {
    console.error('[lab/design] error:', e);
    return NextResponse.json({ error: 'Error inesperado.' }, { status: 500 });
  }
}
