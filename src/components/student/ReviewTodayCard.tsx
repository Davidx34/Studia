import Link from 'next/link';
import { Layers, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/components/ui/cn';
import type { ReviewPlanForDashboard } from '@/lib/study/reviewPlanServer';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

// Accion SECUNDARIA del inicio (la principal sigue siendo continuar el modulo). Solo aparece si hay algo pendiente.
export function ReviewTodayCard({ plan }: { plan: ReviewPlanForDashboard | null }) {
  if (!plan || !plan.target || plan.dueTotal === 0) return null;
  const { sessionCount, dueTotal, minutes, target, targetClassroomName } = plan;
  const href = `/my-classes/${target.classroomId}/study?m=${target.materialId}`;
  const more = dueTotal > sessionCount ? ` (${dueTotal} pendientes en total)` : '';
  return (
    <Link href={href} className={cn('block group rounded-2xl', focusRing)} aria-label={`Repaso de hoy: ${sessionCount} tarjetas, unos ${minutes} minutos${more}`}>
      <Card interactive className="p-4 sm:p-5 flex items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-accent/20 text-accent-text flex items-center justify-center flex-shrink-0">
          <Layers className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-accent-text">Repaso de hoy</div>
          <div className="text-fg font-bold">
            {sessionCount} {sessionCount === 1 ? 'tarjeta' : 'tarjetas'} · unos {minutes} {minutes === 1 ? 'minuto' : 'minutos'}
          </div>
          <div className="text-xs text-fg-muted truncate">
            {targetClassroomName ? `${targetClassroomName}` : 'Tus clases'}
            {dueTotal > sessionCount ? ` · ${dueTotal} pendientes en total` : ''}
          </div>
        </div>
        <ArrowRight className="w-6 h-6 text-fg-muted group-hover:translate-x-1 transition-transform motion-reduce:transform-none flex-shrink-0" aria-hidden="true" />
      </Card>
    </Link>
  );
}
