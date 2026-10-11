import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Users, FileText, Map, BarChart3 } from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase/server';
import ClassroomTabs from './ClassroomTabs';

export default async function ClassroomLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: classroom } = await supabase
    .from('classrooms')
    .select('id, name, description, subject_area, grade_level, join_code, is_active, teacher_id')
    .eq('id', params.id)
    .eq('teacher_id', user.id)
    .single();

  if (!classroom) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/teacher/classrooms"
        className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg transition"
      >
        <ArrowLeft className="w-4 h-4" />
        Mis clases
      </Link>

      <div className="rounded-2xl border border-line shadow-card bg-surface backdrop-blur-xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-fg">{classroom.name}</h1>
            {classroom.description && (
              <p className="text-sm text-fg-muted mt-1">{classroom.description}</p>
            )}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {classroom.subject_area && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface-2 text-fg-muted border border-line-strong">
                  {classroom.subject_area}
                </span>
              )}
              {classroom.grade_level && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface-2 text-fg-muted border border-line-strong">
                  {classroom.grade_level}
                </span>
              )}
              {!classroom.is_active && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent/15 text-accent-text border border-accent/30">
                  Archivada
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-wider text-fg-muted mb-0.5">
              Código de la clase
            </span>
            <code className="text-base font-mono font-semibold text-primary-text bg-primary/10 px-3 py-1 rounded-lg border border-primary/30">
              {classroom.join_code}
            </code>
          </div>
        </div>
      </div>

      <ClassroomTabs classroomId={classroom.id} />

      <div>{children}</div>
    </div>
  );
}
