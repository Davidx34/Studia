import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { Plus, Users, Clock, BookOpen, ChevronRight, GraduationCap } from 'lucide-react';

export default async function TeacherClassroomsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Clases del profe
  const { data: classrooms } = await supabase
    .from('classrooms')
    .select('id, name, description, subject_area, grade_level, join_code, is_active, created_at')
    .eq('teacher_id', user.id)
    .order('created_at', { ascending: false });

  const classroomIds = (classrooms ?? []).map((c) => c.id);

  // Conteos por clase: inscritos + pendientes (en una sola query cada uno)
  const enrolledMap = new Map<string, number>();
  const pendingMap = new Map<string, number>();

  if (classroomIds.length > 0) {
    const { data: enrollments } = await supabase
      .from('class_enrollments')
      .select('classroom_id')
      .in('classroom_id', classroomIds);
    for (const e of enrollments ?? []) {
      enrolledMap.set(e.classroom_id, (enrolledMap.get(e.classroom_id) ?? 0) + 1);
    }

    const { data: pendings } = await supabase
      .from('pending_enrollments')
      .select('classroom_id')
      .in('classroom_id', classroomIds);
    for (const p of pendings ?? []) {
      pendingMap.set(p.classroom_id, (pendingMap.get(p.classroom_id) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-fg">Mis clases</h1>
          <p className="text-fg-muted mt-1">
            {classrooms?.length ?? 0} {classrooms?.length === 1 ? 'clase' : 'clases'}
          </p>
        </div>
        <Link
          href="/teacher/classrooms/new"
          className="inline-flex items-center gap-2 bg-primary hover:brightness-110 text-on-primary px-4 py-2.5 rounded-xl text-sm font-medium transition"
        >
          <Plus className="w-4 h-4" />
          Nueva clase
        </Link>
      </div>

      {classrooms && classrooms.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {classrooms.map((c) => {
            const enrolled = enrolledMap.get(c.id) ?? 0;
            const pending = pendingMap.get(c.id) ?? 0;
            return (
              <Link
                key={c.id}
                href={`/teacher/classrooms/${c.id}/students`}
                className="group block rounded-2xl border border-line shadow-card bg-surface backdrop-blur-xl hover:border-primary/50 hover:bg-surface p-5 transition"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
                    <GraduationCap className="w-5 h-5 text-primary-text" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-fg-muted group-hover:text-primary-text transition" />
                </div>

                <h3 className="text-base font-semibold text-fg truncate">{c.name}</h3>
                {c.description && (
                  <p className="text-xs text-fg-muted mt-1 line-clamp-2">{c.description}</p>
                )}

                <div className="flex flex-wrap gap-1.5 mt-3">
                  {c.subject_area && (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface-2 text-fg-muted border border-line-strong">
                      {c.subject_area}
                    </span>
                  )}
                  {c.grade_level && (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface-2 text-fg-muted border border-line-strong">
                      {c.grade_level}
                    </span>
                  )}
                  {!c.is_active && (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent/15 text-accent-text border border-accent/30">
                      Archivada
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-line-strong text-xs">
                  <div className="flex items-center gap-1.5 text-fg-muted">
                    <Users className="w-3.5 h-3.5" />
                    <span>
                      <strong className="text-fg">{enrolled}</strong> inscrito
                      {enrolled === 1 ? '' : 's'}
                    </span>
                  </div>
                  {pending > 0 && (
                    <div className="flex items-center gap-1.5 text-accent-text">
                      <Clock className="w-3.5 h-3.5" />
                      <span>
                        <strong>{pending}</strong> pendiente{pending === 1 ? '' : 's'}
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-line-strong flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-fg-muted">
                    Código
                  </span>
                  <code className="text-xs font-mono text-primary-text">{c.join_code}</code>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-20 rounded-2xl border border-line shadow-card bg-surface backdrop-blur-xl">
          <BookOpen className="w-12 h-12 text-fg-muted mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-fg mb-2">
            Aún no tienes clases creadas
          </h2>
          <p className="text-sm text-fg-muted mb-6">
            Crea tu primera clase para empezar a invitar estudiantes y subir material.
          </p>
          <Link
            href="/teacher/classrooms/new"
            className="inline-flex items-center gap-2 bg-primary hover:brightness-110 text-on-primary px-5 py-2.5 rounded-xl text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" />
            Crear primera clase
          </Link>
        </div>
      )}
    </div>
  );
}
