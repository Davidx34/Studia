import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { LearningMap } from './LearningMap';

export type NodeStatus = 'locked' | 'available' | 'in_progress' | 'completed' | 'current';

export interface MapNode {
  id: string;
  title: string;
  category: string;
  difficulty: number;
  order: number;
  x: number;
  y: number;
  prerequisites: string[];
  status: NodeStatus;
  score: number | null;
  completionPct: number;
  isCurrent: boolean;
}

const CATEGORY_META: Record<
  string,
  { label: string; color: string; emoji: string; gradient: [string, string] }
> = {
  math: { label: 'Matemáticas', color: '#6C5CE7', emoji: '🔢', gradient: ['#6C5CE7', '#a29bfe'] },
  science: { label: 'Ciencias', color: '#00D2D3', emoji: '🔬', gradient: ['#00D2D3', '#55E6C1'] },
  language: { label: 'Lenguaje', color: '#FF7675', emoji: '📖', gradient: ['#FF7675', '#fab1a0'] },
  history: { label: 'Historia', color: '#FDCB6E', emoji: '📜', gradient: ['#FDCB6E', '#ffeaa7'] },
  logic: { label: 'Lógica', color: '#A29BFE', emoji: '🧩', gradient: ['#A29BFE', '#dfe6e9'] },
};

export default async function MapPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Cargar todos los módulos
  const { data: modules } = await supabase
    .from('content_modules')
    .select('*')
    .eq('is_active', true)
    .order('category')
    .order('order_index');

  // Cargar progreso del estudiante
  const { data: progress } = await supabase
    .from('student_progress')
    .select('*')
    .eq('student_id', user.id);

  if (!modules) {
    return <div className="text-white">No hay módulos disponibles.</div>;
  }

  // Mapear progreso por module_id para lookup rápido
  const progressMap = new Map(progress?.map((p) => [p.module_id, p]) || []);

  // Calcular estado de cada nodo
  const completedSet = new Set(
    progress?.filter((p) => p.status === 'completed').map((p) => p.module_id) || []
  );

  let currentModuleId: string | null = null;
  // El "current" es el módulo en progreso más reciente
  const inProgress = progress?.find((p) => p.status === 'in_progress');
  if (inProgress) currentModuleId = inProgress.module_id;

  const nodes: MapNode[] = modules.map((m) => {
    const p = progressMap.get(m.id);
    let status: NodeStatus;

    if (p?.status === 'completed') {
      status = 'completed';
    } else if (p?.status === 'in_progress') {
      status = 'in_progress';
    } else {
      // Verificar prerequisitos
      const prereqs = (m.prerequisites as string[]) || [];
      const allPrereqsCompleted =
        prereqs.length === 0 || prereqs.every((pid) => completedSet.has(pid));
      status = allPrereqsCompleted ? 'available' : 'locked';
    }

    return {
      id: m.id,
      title: m.title,
      category: m.category,
      difficulty: m.difficulty_level,
      order: m.order_index,
      x: m.map_position_x,
      y: m.map_position_y,
      prerequisites: (m.prerequisites as string[]) || [],
      status,
      score: p?.best_score || null,
      completionPct: p?.completion_percentage || 0,
      isCurrent: m.id === currentModuleId,
    };
  });

  // Stats agregadas para el header del mapa
  const totalModules = nodes.length;
  const completedCount = nodes.filter((n) => n.status === 'completed').length;

  return (
    <LearningMap
      nodes={nodes}
      categoryMeta={CATEGORY_META}
      stats={{ total: totalModules, completed: completedCount }}
    />
  );
}
