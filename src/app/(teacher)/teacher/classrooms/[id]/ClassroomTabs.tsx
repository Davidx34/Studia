'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users, FileText, Map, BarChart3, Brain, Target, ImagePlus, Sparkles } from 'lucide-react';

export default function ClassroomTabs({ classroomId }: { classroomId: string }) {
  const pathname = usePathname();
  const base = `/teacher/classrooms/${classroomId}`;

  const tabs = [
    { href: `${base}/students`, label: 'Estudiantes', icon: Users },
    { href: `${base}/materials`, label: 'Materiales', icon: FileText },
    { href: `${base}/modules`, label: 'Módulos', icon: Map },
    { href: `${base}/media`, label: 'Medios', icon: ImagePlus },
    { href: `${base}/objectives`, label: 'Objetivos', icon: Target },
    { href: `${base}/progress`, label: 'Progreso', icon: BarChart3 },

    { href: `${base}/brain`, label: 'Configurar IA', icon: Brain },
    // Al final: se prepara cuando todo lo demas ya esta cargado y procesado.
    { href: `${base}/study`, label: 'Material de estudio', icon: Sparkles },
  ];

  return (
    <div className="border-b border-line-strong -mx-2 px-2 overflow-x-auto">
      <nav aria-label="Secciones de la clase" className="flex gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className={`inline-flex min-h-[44px] items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition motion-reduce:transition-none whitespace-nowrap ${
                isActive
                  ? 'border-primary text-primary-text'
                  : 'border-transparent text-fg-muted hover:text-fg'
              }`}
            >
              <Icon aria-hidden="true" className="w-4 h-4" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
