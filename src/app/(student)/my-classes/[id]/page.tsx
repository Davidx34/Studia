import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import Link from 'next/link';

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

  const teacher = (classroom as any).profiles;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">{classroom.name}</h1>
        <p className="text-slate-400 mt-2">
          Con {teacher?.full_name || teacher?.username || 'profesor'}
        </p>
        {classroom.subject_area && (
          <p className="text-slate-300 text-sm mt-2">📚 {classroom.subject_area}</p>
        )}
      </div>

      {/* Mapa de módulos generados */}
      {modules && modules.length > 0 ? (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-white">Módulos de la clase</h2>
          {/* Grid de módulos simplificado */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {modules.map((module: any, index: number) => {
              const progress = progressMap.get(module.id);
              const isLocked = index > 0 && !progressMap.get((modules[index - 1] as any).id);
              const statusEmoji =
                progress?.status === 'completed'
                  ? '✓'
                  : progress?.status === 'in_progress'
                  ? '▶️'
                  : progress?.status === 'available'
                  ? '🔓'
                  : '🔒';
              return (
                <div
                  key={module.id}
                  className={`rounded-lg p-4 border ${
                    isLocked
                      ? 'bg-slate-800 border-slate-700 opacity-50 cursor-not-allowed'
                      : progress?.status === 'completed'
                      ? 'bg-green-900 border-green-700'
                      : 'bg-slate-800 border-slate-700 hover:border-blue-500'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-2xl">{statusEmoji}</span>
                    <span className="text-xs text-slate-400">
                      {progress?.completion_percentage || 0}%
                    </span>
                  </div>
                  <h3 className="text-white font-medium">{module.title}</h3>
                  {module.description && (
                    <p className="text-slate-400 text-sm mt-1">{module.description}</p>
                  )}
                  <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-700">
                    <span className="text-xs text-slate-400">
                      {module.estimated_time_minutes} min
                    </span>
                    {!isLocked && (
                      <Link href={`/lesson/${module.id}`}>
                        <button className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded transition-colors">
                          {progress?.status === 'completed' ? 'Rehacer' : 'Empezar'}
                        </button>
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-lg p-12 border border-slate-700 text-center">
          <p className="text-slate-400 text-lg">Tu profesor aún no ha subido materiales</p>
          <p className="text-slate-500 text-sm mt-2">
            Una vez que suba contenido, aparecerán los módulos automáticamente
          </p>
        </div>
      )}

      {/* Progress general */}
      {modules && modules.length > 0 && (
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h3 className="text-white font-medium mb-4">Tu progreso en esta clase</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Completados</span>
              <span className="text-white font-medium">
                {Array.from(progressMap.values()).filter((p: any) => p.status === 'completed').length} /{' '}
                {modules.length}
              </span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{
                  width: `${
                    (Array.from(progressMap.values()).filter((p: any) => p.status === 'completed').length /
                      modules.length) *
                    100
                  }%`,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
