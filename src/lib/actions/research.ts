'use server';

// Ruta de investigacion con Gemini + busqueda de Google (fase 5 de «IA que aprende»). Solo el profesor dueno de la clase. Ver src/lib/aiLearning/research.ts para las reglas.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { geminiGenerate, type GeminiFailure } from '@/lib/ai/geminiDirect';
import { annotateCitations, buildResearchPrompt, extractGrounding, resolveSources, sanitizeDisplayText } from '@/lib/aiLearning/research';
import { LEVELS, SUBJECTS } from '@/lib/aiLearning/benchmark';

export interface ResearchActionResult {
  ok: boolean;
  error?: string;
}

// Tope por clase y dia: cada ruta gasta consultas de busqueda (cuota gratuita compartida del proyecto).
const DAILY_LIMIT = 5;

const FAILURE_TEXT: Record<GeminiFailure, string> = {
  no_key: 'La IA no está configurada en el servidor.',
  auth: 'La llave de la IA fue rechazada.',
  quota_daily: 'Se agotó la cuota diaria de la IA. Intenta mañana.',
  rate_limited: 'La IA está saturada en este momento. Intenta de nuevo en un minuto.',
  server: 'La IA no respondió. Intenta de nuevo.',
  timeout: 'La búsqueda tardó demasiado. Intenta de nuevo.',
  bad_request: 'La IA rechazó la petición. Prueba con otro tema.',
  model_unavailable: 'El modelo de IA no está disponible ahora.',
  empty: 'La IA no devolvió resultados. Prueba con otro tema.',
};

export async function generateResearchRoute(classroomId: string, topic: string): Promise<ResearchActionResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const db = supabase as any;
  const { data: own } = await db.from('classrooms').select('id, name').eq('id', classroomId).eq('teacher_id', user.id).maybeSingle();
  if (!own) return { ok: false, error: 'Clase no encontrada.' };
  const cleanTopic = topic.replace(/\s+/g, ' ').trim();
  if (cleanTopic.length < 3 || cleanTopic.length > 120) return { ok: false, error: 'Escribe un tema de 3 a 120 caracteres.' };

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await db.from('research_routes').select('id', { count: 'exact', head: true }).eq('classroom_id', classroomId).gte('created_at', since);
  if ((count ?? 0) >= DAILY_LIMIT) return { ok: false, error: `Llegaste al máximo de ${DAILY_LIMIT} rutas por clase al día. Intenta mañana.` };

  const { data: profile } = await db.from('classroom_benchmark_profile').select('subject, level').eq('classroom_id', classroomId).maybeSingle();
  const prompt = buildResearchPrompt({
    topic: cleanTopic,
    className: own.name,
    subject: profile?.subject ? (SUBJECTS as Record<string, string>)[profile.subject] : undefined,
    level: profile?.level ? (LEVELS as Record<string, string>)[profile.level] : undefined,
  });

  const out = await geminiGenerate({ role: 'research', parts: [{ text: prompt }], tools: [{ google_search: {} }], timeoutMs: 60_000, retries: 1 });
  if (!out.ok) return { ok: false, error: FAILURE_TEXT[out.reason] ?? 'No se pudo generar la ruta.' };

  const grounding = extractGrounding(out.grounding);
  // Sin fuentes no se guarda: nada de lo que dijo la IA estaria respaldado.
  if (grounding.chunks.length === 0) return { ok: false, error: 'La búsqueda no devolvió fuentes para este tema, así que no se guardó nada. Prueba con un tema más específico.' };

  // Primero se anota (los indices de Gemini son bytes del texto ORIGINAL) y despues se limpia para mostrar.
  const { annotated, citedRatio } = annotateCitations(out.text, grounding.supports);
  const sources = await resolveSources(grounding.chunks);

  const { error } = await db.from('research_routes').insert({
    classroom_id: classroomId,
    topic: cleanTopic,
    answer: sanitizeDisplayText(annotated, 12000),
    sources,
    queries: grounding.queries,
    cited_ratio: citedRatio,
    model: out.model,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/teacher/classrooms/${classroomId}/research`);
  return { ok: true };
}

export async function deleteResearchRoute(classroomId: string, routeId: string): Promise<ResearchActionResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { error } = await (supabase as any).from('research_routes').delete().eq('id', routeId).eq('classroom_id', classroomId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/teacher/classrooms/${classroomId}/research`);
  return { ok: true };
}
