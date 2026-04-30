import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { Plus, Clock, BookOpen } from 'lucide-react';

const CATEGORY_LABELS: Record<string, { name: string; emoji: string; color: string }> = {
  math: { name: 'Matemáticas', emoji: '🔢', color: 'violet' },
  science: { name: 'Ciencias', emoji: '🔬', color: 'cyan' },
  language: { name: 'Lenguaje', emoji: '📖', color: 'rose' },
  history: { name: 'Historia', emoji: '📜', color: 'amber' },
  logic: { name: 'Lógica', emoji: '🧩', color: 'purple' },
};

export default async function TeacherContentPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: modules } = await supabase
    .from('content_modules')
    .select('*')
    .eq('teacher_id', user.id)
    .order('category')
    .order('order_index');

  // Agrupar por categoría
  const grouped = new Map<string, any[]>();
  for (const m of modules || []) {
    if (!grouped.has(m.category)) grouped.set(m.category, []);
    grouped.get(m.category)!.push(m);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-white">Contenido</h1>
          <p className="text-slate-400 mt-1">
            {modules?.length || 0} módulos creados
          </p>
        </div>
        <Link
          href="/teacher/content/new"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 text-white font-semibold rounded-xl hover:scale-[1.02] active:scale-[0.98] transition shadow-lg"
        >
          <Plus className="w-4 h-4" />
          Crear módulo
        </Link>
      </div>

      {/* Empty state */}
      {(!modules || modules.length === 0) && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-12 text-center">
          <BookOpen className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="font-semibold text-white mb-1">Aún no has creado contenido</h3>
          <p className="text-sm text-slate-500 mb-4">
            Crea tu primer módulo para que tus estudiantes empiecen a aprender.
          </p>
          <Link
            href="/teacher/content/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-violet-500/20 border border-violet-500/40 text-violet-200 rounded-lg hover:bg-violet-500/30 transition text-sm font-semibold"
          >
            <Plus className="w-4 h-4" />
            Crear primer módulo
          </Link>
        </div>
      )}

      {/* Lista por categorías */}
      <div className="space-y-6">
        {Array.from(grouped.entries()).map(([category, mods]) => {
          const cat = CATEGORY_LABELS[category];
          if (!cat) return null;
          return (
            <section key={category}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">{cat.emoji}</span>
                <h2 className="font-semibold text-white">{cat.name}</h2>
                <span className="text-xs text-slate-500">· {mods.length} módulos</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {mods.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-xl bg-slate-900 border border-slate-800 p-4 hover:border-violet-500/40 transition group"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-semibold text-white text-sm leading-snug">{m.title}</h3>
                      <div className="flex-shrink-0 flex items-center gap-0.5">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <span
                            key={i}
                            className={i < m.difficulty_level ? 'text-yellow-400' : 'text-slate-700'}
                          >
                            ★
                          </span>
                        ))}
                      </div>
                    </div>
                    {m.description && (
                      <p className="text-xs text-slate-500 line-clamp-2 mb-3">{m.description}</p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {m.estimated_time_minutes}min
                      </div>
                      <div>{m.base_xp_reward} XP</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
