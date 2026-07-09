'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users, FileText, Map, BarChart3, Brain } from 'lucide-react';

export default function ClassroomTabs({ classroomId }: { classroomId: string }) {
  const pathname = usePathname();
  const base = `/teacher/classrooms/${classroomId}`;

  const tabs = [
    { href: `${base}/students`, label: 'Estudiantes', icon: Users },
    { href: `${base}/materials`, label: 'Materiales', icon: FileText },
    { href: `${base}/modules`, label: 'Módulos', icon: Map },
    { href: `${base}/progress`, label: 'Progreso', icon: BarChart3 },
  
    { href: `${base}/brain`, label: 'Configurar IA', icon: Brain },
  ];

  return (
    <div className="border-b border-slate-800 -mx-2 px-2 overflow-x-auto">
      <nav className="flex gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                isActive
                  ? 'border-violet-500 text-violet-300'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
