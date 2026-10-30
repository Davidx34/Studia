import { redirect } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, BrainCircuit, CheckCircle2, Dumbbell, FlaskConical, Lock, Play } from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, Badge } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { loadModuleAttempts } from '@/lib/mastery/load';
import { moduleMastery, type ModuleMastery } from '@/lib/mastery/mastery';
import { MasteryBadge } from '@/components/student/MasteryBadge';
import { MasterySummary } from '@/components/student/MasterySummary';

const linkBase =
  'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl font-semibold text-sm transition-[filter,background-color] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export default async function StudentClassPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Verificar que el estudiante esté inscrito en esta clase
  const { data: enrollment } = await supabase
    .from('class_enrollments')
    .select('*')
    .eq('classroom_id', params.id)
    .eq('student_id', user.id)
    .single();
  if (!enrollment) redirect('/dashboard');

  // Cargar clase
  const { data: classroom } = await supabase
    .from('classrooms')
    .select('*, profiles!teacher_id(full_name, username)')
    .eq('id', params.id)
    .single();
  if (!classroom) redirect('/dashboard');

  // Cargar módulos auto-generados de esta clase
  const { data: modules } = await supabase
    .from('content_modules')
    .select('*')
    .eq('classroom_id', params.id)
    .eq('auto_generated', true)
    .eq('is_active', true)
    .order('order_index');

  // Cargar progress del estudiante en estos módulos
  const moduleIds = (modules || []).map((m: any) => m.id);
  const progressMap = new Map();
  if (moduleIds.length > 0) {
    const { data: progress } = await supabase
      .from('student_progress')
      .select('*')
      .eq('student_id', user.id)
      .in('module_id', moduleIds);
    for (const p of progress || []) {
      progressMap.set((p as any).module_id, p);
    }
  }

  // Dominio por modulo (evidencia acumulada) y por objetivo. Un fallo aqui NUNCA debe impedir abrir la clase.
  const masteryByModule = new Map<string, ModuleMastery>();
  let objectives: { id: string; title: string }[] = [];
  try {
    const attempts = await loadModuleAttempts(supabase, { studentId: user.id, classroomId: params.id });
    for (const id of moduleIds) masteryByModule.set(id, moduleMastery(attempts.get(id) ?? []));
    const { data: objs } = await supabase.from('classroom_learning_objectives').select('id, title').eq('classroom_id', params.id).order('created_at');
    objectives = (objs ?? []).map((o: any) => ({ id: o.id, title: o.title }));
  } catch (e) {
    console.warn('[mastery]', e instanceof Error ? e.message : e);
  }

  // Modo practica: solo se ofrece si ya respondio alguna pregunta de esta clase (la practica usa lo que ya respondio).
  const { count: practiceable } = await supabase
    .from('question_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', user.id)
    .eq('classroom_id', params.id)
    .is('game_type', null);

  // Laboratorios publicados (migracion 078; si la tabla aun no existe, la consulta falla y simplemente no se ofrece el enlace).
  const labCount = await (supabase as any).from('labs').select('id', { count: 'exact', head: true }).eq('classroom_id', params.id).eq('status', 'published');
  const hasLabs = !labCount.error && (labCount.count ?? 0) > 0;

  const teacher = (classroom as any).profiles;
  const completedCount = Array.from(progressMap.values()).filter((p: any) => p.status === 'completed').length;
  const total = modules?.length ?? 0;
  const pct = total > 0 ? (completedCount / total) * 100 : 0;

  return (
    <div className="theme-scope space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-fg text-balance">{classroom.name}</h1>
          <p className="text-fg-muted mt-2">Con {teacher?.full_name || teacher?.username || 'profesor'}</p>
          {classroom.subject_area && <p className="text-fg text-sm mt-2">{classroom.subject_area}</p>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href={`/my-classes/${params.id}/study`} className={`${linkBase} bg-primary text-on-primary hover:brightness-110`}>
            <BrainCircuit aria-hidden="true" className="w-4 h-4" /> Estudiar
          </Link>
          {(practiceable ?? 0) > 0 && (
            <Link href={`/my-classes/${params.id}/practice`} className={`${linkBase} bg-surface-2 text-fg border border-line hover:border-line-strong`}>
              <Dumbbell aria-hidden="true" className="w-4 h-4" /> Practicar sin presión
            </Link>
          )}
          {hasLabs && (
            <Link href={`/my-classes/${params.id}/labs`} className={`${linkBase} bg-surface-2 text-fg border border-line hover:border-line-strong`}>
              <FlaskConical aria-hidden="true" className="w-4 h-4" /> Laboratorios
            </Link>
          )}
          <Link href={`/my-classes/${params.id}/library`} className={`${linkBase} bg-surface-2 text-fg border border-line hover:border-line-strong`}>
            <BookOpen aria-hidden="true" className="w-4 h-4" /> Biblioteca de clase
          </Link>
        </div>
      </div>

      {/* Dominio: que domina, que debe repasar y como va cada objetivo (solo si ya empezo algo) */}
      <MasterySummary
        modules={(modules || []).map((m: any) => ({ id: m.id, objectiveId: m.learning_objective_id ?? null, state: masteryByModule.get(m.id)?.state ?? 'not_started' }))}
        objectives={objectives}
        practiceHref={(practiceable ?? 0) > 0 ? `/my-classes/${params.id}/practice` : null}
      />

      {/* Mapa de módulos generados */}
      {modules && modules.length > 0 ? (
        <section aria-labelledby="modulos-clase" className="space-y-4">
          <h2 id="modulos-clase" className="text-xl font-bold text-fg">Módulos de la clase</h2>
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {modules.map((module: any, index: number) => {
              const progress = progressMap.get(module.id);
              const prevProgress = index > 0 ? progressMap.get((modules[index - 1] as any).id) : null;
              const isLocked = index > 0 && (prevProgress as any)?.status !== 'completed';
              const isCompleted = progress?.status === 'completed';
              const isInProgress = progress?.status === 'in_progress';
              return (
                <li key={module.id}>
                  <Card className={`h-full p-4 flex flex-col ${isLocked ? 'bg-surface-2' : isCompleted ? 'border-success/60' : ''}`}>
                    <div className="flex items-start justify-between mb-2">
                      {/* El estado se dice con icono Y texto, nunca solo con color */}
                      {isCompleted ? (
                        <Badge tone="success"><CheckCircle2 aria-hidden="true" className="w-3.5 h-3.5" /> Completado</Badge>
                      ) : isInProgress ? (
                        <Badge tone="accent"><Play aria-hidden="true" className="w-3.5 h-3.5" /> En curso</Badge>
                      ) : isLocked ? (
                        <Badge tone="neutral"><Lock aria-hidden="true" className="w-3.5 h-3.5" /> Bloqueado</Badge>
                      ) : (
                        <Badge tone="primary">Disponible</Badge>
                      )}
                      <span className="text-xs text-fg-muted tabular-nums">{progress?.completion_percentage || 0}%</span>
                    </div>
                    <h3 className={`font-semibold ${isLocked ? 'text-fg-muted' : 'text-fg'}`}>{module.title}</h3>
                    {module.description && <p className="text-fg-muted text-sm mt-1">{module.description}</p>}
                    {masteryByModule.get(module.id) && <MasteryBadge mastery={masteryByModule.get(module.id)!} />}
                    {isLocked && <p className="text-xs text-fg-muted mt-2">Completa el módulo anterior para desbloquearlo.</p>}
                    <div className="flex justify-between items-center mt-auto pt-3 border-t border-line">
                      <span className="text-xs text-fg-muted">{module.estimated_time_minutes} min</span>
                      {!isLocked && (
                        <Link href={`/lesson/${module.id}`} className={`${linkBase} min-h-[40px] px-3 bg-primary text-on-primary hover:brightness-110`}>
                          {isCompleted ? 'Rehacer' : 'Empezar'}
                          <span className="sr-only">: {module.title}</span>
                        </Link>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <Card className="p-12 text-center">
          <p className="text-fg text-lg">Tu profesor aún no ha subido materiales</p>
          <p className="text-fg-muted text-sm mt-2">Una vez que suba contenido, aparecerán los módulos automáticamente</p>
        </Card>
      )}

      {/* Progress general */}
      {modules && modules.length > 0 && (
        <Card className="p-6">
          <h3 className="text-fg font-medium mb-4">Tu progreso en esta clase</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-fg-muted">Completados</span>
              <span className="text-fg font-medium tabular-nums">
                {completedCount} / {total}
              </span>
            </div>
            <ProgressBar value={pct} label="Módulos completados en esta clase" tone="success" />
          </div>
        </Card>
      )}
    </div>
  );
}
