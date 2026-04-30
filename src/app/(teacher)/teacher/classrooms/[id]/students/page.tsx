import { redirect } from 'next/navigation';
import { Mail, UserPlus, Users as UsersIcon, Clock, CheckCircle2 } from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase/server';
import InviteStudentsForm from './InviteStudentsForm';
import RemoveEnrollmentButton from './RemoveEnrollmentButton';
import CancelPendingButton from './CancelPendingButton';

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
          .select('id, full_name, username, email, avatar_url, total_xp, current_level')
          .in('id', studentIds)
          .order('total_xp', { ascending: false })
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
          <UsersIcon className="w-5 h-5 text-violet-300" />
          <h2 className="text-lg font-semibold text-white">
            Inscritos activos
            <span className="ml-2 text-sm font-normal text-slate-500">
              ({students?.length ?? 0})
            </span>
          </h2>
        </header>

        {students && students.length > 0 ? (
          <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
            {students.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 last:border-0"
              >
                <div className="w-9 h-9 rounded-full bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-300 text-sm font-semibold flex-shrink-0">
                  {(s.full_name || s.username || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">
                    {s.full_name || s.username}
                  </div>
                  <div className="text-xs text-slate-500 truncate">{s.email ?? '—'}</div>
                </div>
                <div className="hidden sm:flex flex-col items-end text-xs text-slate-400">
                  <span>
                    <strong className="text-violet-300">{s.total_xp ?? 0}</strong> XP
                  </span>
                  <span className="text-slate-500">Nivel {s.current_level ?? 1}</span>
                </div>
                <RemoveEnrollmentButton classroomId={params.id} studentId={s.id} />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 rounded-2xl bg-slate-900 border border-slate-800 border-dashed">
            <p className="text-sm text-slate-500">
              Aún no hay estudiantes inscritos. Invita emails abajo.
            </p>
          </div>
        )}
      </section>

      {/* Sección: Pendientes */}
      {pendings && pendings.length > 0 && (
        <section>
          <header className="flex items-center gap-2 mb-3">
            <Clock className="w-5 h-5 text-amber-300" />
            <h2 className="text-lg font-semibold text-white">
              Pendientes de signup
              <span className="ml-2 text-sm font-normal text-slate-500">
                ({pendings.length})
              </span>
            </h2>
          </header>
          <div className="rounded-2xl bg-amber-500/5 border border-amber-500/20 overflow-hidden">
            {pendings.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-amber-500/10 last:border-0"
              >
                <Mail className="w-4 h-4 text-amber-300 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{p.email}</div>
                  <div className="text-xs text-slate-500">
                    Se inscribirá automáticamente al registrarse
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
          <UserPlus className="w-5 h-5 text-violet-300" />
          <h2 className="text-lg font-semibold text-white">Invitar estudiantes</h2>
        </header>
        <InviteStudentsForm classroomId={params.id} />
      </section>
    </div>
  );
}
