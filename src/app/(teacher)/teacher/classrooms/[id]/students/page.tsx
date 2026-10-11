import { redirect } from 'next/navigation';
import { Mail, UserPlus, Users as UsersIcon, Clock, CheckCircle2 } from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase/server';
import InviteStudentsForm from './InviteStudentsForm';
import RemoveEnrollmentButton from './RemoveEnrollmentButton';
import CancelPendingButton from './CancelPendingButton';
import { PENDING_ROW_NOTE } from '@/lib/classrooms/constants';

interface PageProps {
  params: { id: string };
}

export default async function ClassroomStudentsPage({ params }: PageProps) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Inscritos activos
  const { data: enrollments } = await supabase
    .from('class_enrollments')
    .select('id, student_id, enrolled_at')
    .eq('classroom_id', params.id);

  const studentIds = (enrollments ?? []).map((e) => e.student_id);

  const { data: students } =
    studentIds.length > 0
      ? await supabase
          .from('profiles')
          .select('id, full_name, username, email, avatar_url, streak_days')
          .in('id', studentIds)
          .order('full_name', { ascending: true })
      : { data: [] };

  // Pendientes
  const { data: pendings } = await supabase
    .from('pending_enrollments')
    .select('id, email, invited_at')
    .eq('classroom_id', params.id)
    .order('invited_at', { ascending: false });

  return (
    <div className="space-y-8">
      {/* Sección: Inscritos */}
      <section>
        <header className="flex items-center gap-2 mb-3">
          <UsersIcon className="w-5 h-5 text-primary-text" />
          <h2 className="text-lg font-semibold text-fg">
            Inscritos activos
            <span className="ml-2 text-sm font-normal text-fg-muted">
              ({students?.length ?? 0})
            </span>
          </h2>
        </header>

        {students && students.length > 0 ? (
          <div className="rounded-2xl border border-line shadow-card bg-surface backdrop-blur-xl overflow-hidden">
            {students.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 px-4 py-3 border-b border-line-strong last:border-0"
              >
                <div className="w-9 h-9 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-primary-text text-sm font-semibold flex-shrink-0">
                  {(s.full_name || s.username || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-fg truncate">
                    {s.full_name || s.username}
                  </div>
                  <div className="text-xs text-fg-muted truncate">{s.email ?? '—'}</div>
                </div>
                <div className="hidden sm:flex flex-col items-end text-xs text-fg-muted">
                  <span>
                    <strong className="text-primary-text">{s.streak_days ?? 0}</strong> días de racha
                  </span>
                </div>
                <RemoveEnrollmentButton classroomId={params.id} studentId={s.id} />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 rounded-2xl border border-line shadow-card bg-surface backdrop-blur-xl border-dashed">
            <p className="text-sm text-fg-muted">
              Aún no hay estudiantes inscritos. Invita emails abajo (no se envían correos: ver la explicación del formulario).
            </p>
          </div>
        )}
      </section>

      {/* Sección: Pendientes */}
      {pendings && pendings.length > 0 && (
        <section>
          <header className="flex items-center gap-2 mb-3">
            <Clock className="w-5 h-5 text-accent-text" />
            <h2 className="text-lg font-semibold text-fg">
              Invitaciones pendientes
              <span className="ml-2 text-sm font-normal text-fg-muted">
                ({pendings.length})
              </span>
            </h2>
          </header>
          <div className="rounded-2xl bg-accent/5 border border-accent/20 overflow-hidden">
            {pendings.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-accent/10 last:border-0"
              >
                <Mail className="w-4 h-4 text-accent-text flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-fg truncate">{p.email}</div>
                  <div className="text-xs text-fg-muted">
                    {PENDING_ROW_NOTE}
                  </div>
                </div>
                <CancelPendingButton pendingId={p.id} email={p.email} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Sección: Invitar */}
      <section>
        <header className="flex items-center gap-2 mb-3">
          <UserPlus className="w-5 h-5 text-primary-text" />
          <h2 className="text-lg font-semibold text-fg">Invitar estudiantes</h2>
        </header>
        <InviteStudentsForm classroomId={params.id} />
      </section>
    </div>
  );
}
