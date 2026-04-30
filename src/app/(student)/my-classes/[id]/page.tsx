import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase/server';
import ClassroomMap from './ClassroomMap';
import type { ContentModule, StudentProgress } from '@/types/database';

export default async function MyClassroomPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Verificar inscripción
  const { data: enrollment } = await supabase
    .from('class_enrollments')
    .select('id')
    .eq('classroom_id', params.id)
    .eq('student_id', user.id)
    .maybeSingle();
  if (!enrollment) redirect('/dashboard');

  // Cargar classroom + teacher
  const { data: classroom } = await supabase
    .from('classrooms')
    .select('id, name, description, subject_area, grade_level, teacher_id')
    .eq('id', params.id)
    .single();
  if (!classroom) notFound();

  const { data: teacher } = await supabase
    .from('profiles')
    .select('full_name, username')
    .eq('id', classroom.teacher_id)
    .single();

  // Modulos auto-generados de la clase
  const { data: modules } = await supabase
    .from('content_modules')
    .select('*')
    .eq('classroom_id', params.id)
    .eq('auto_generated', true)
    .eq('is_active', true)
    .order('order_index', { ascending: true });

  // Progreso del estudiante en estos módulos
  const moduleIds = (modules ?? []).map((m) => m.id);
  let progressMap = new Map<string, StudentProgress>();
  if (moduleIds.length > 0) {
    const { data: progress } = await supabase
      .from('student_progress')
      .select('*')
      .eq('student_id', user.id)
      .in('module_id', moduleIds);
    for (const p of (progress ?? []) as StudentProgress[]) {
      progressMap.set(p.module_id, p);
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-white"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver
      </Link>

      <header className="rounded-2xl bg-white/10 backdrop-blur border border-white/20 p-6">
        <h1 className="text-2xl font-bold text-white">{classroom.name}</h1>
        {classroom.description && (
          <p className="text-white/80 mt-1">{classroom.description}</p>
        )}
        <div className="flex items-center gap-3 mt-3 text-xs text-white/70 flex-wrap">
          {classroom.subject_area && (
            <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/20">
              {classroom.subject_area}
            </span>
          )}
          {classroom.grade_level && (
            <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/20">
              {classroom.grade_level}
            </span>
          )}
          {teacher && (
            <span>
              Profesor: <strong>{teacher.full_name || teacher.username}</strong>
            </span>
          )}
        </div>
      </header>

      <ClassroomMap
        modules={(modules ?? []) as ContentModule[]}
        progress={Object.fromEntries(progressMap.entries())}
      />
    </div>
  );
}
