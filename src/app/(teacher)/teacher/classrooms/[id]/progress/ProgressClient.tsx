'use client';

// Tabla de progreso del prof + export Excel (Fase 11.E)
// "A-la-fija": tabla nativa con useState (sin @tanstack/react-table).
// xlsx se carga lazy on-click via CDN.

import { useMemo, useState } from 'react';
import {
  Search,
  ArrowUp,
  ArrowDown,
  Users,
  TrendingUp,
  Sparkles,
  Award,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import type { ClassroomProgressData, StudentRow } from '@/lib/actions/classroom-progress';
import { downloadClassroomReportXlsx } from '@/lib/export/classroomReport';

type SortKey =
  | 'fullName'
  | 'level'
  | 'totalXp'
  | 'modulesCompleted'
  | 'avgScore'
  | 'lastActivityAt'
  | 'streakDays';

type FilterKey = 'all' | 'active' | 'at_risk';

const FILTER_LABELS: Record<FilterKey, string> = {
  all: 'Todos',
  active: 'Activos',
  at_risk: 'En riesgo',
};

export default function ProgressClient({ data }: { data: ClassroomProgressData }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('totalXp');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = data.students;

    if (filter === 'active') {
      list = list.filter(
        (s) => s.daysSinceActivity !== null && s.daysSinceActivity <= 7
      );
    } else if (filter === 'at_risk') {
      list = list.filter(
        (s) => s.daysSinceActivity === null || s.daysSinceActivity > 3
      );
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.username.toLowerCase().includes(q) ||
          (s.email ?? '').toLowerCase().includes(q)
      );
    }

    return [...list].sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return sortDir === 'asc' ? -1 : 1;
      if (bv == null) return sortDir === 'asc' ? 1 : -1;
      if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      const s = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? s : -s;
    });
  }, [data.students, search, sortKey, sortDir, filter]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'fullName' ? 'asc' : 'desc');
    }
  }

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      await downloadClassroomReportXlsx(data);
    } catch (err) {
      setExportError(
        `No se pudo cargar la librería de Excel. Verifica tu conexión. (${(err as Error).message})`
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header con stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Users className="w-4 h-4" />}
          label="Activos"
          value={`${data.summary.activeStudents}/${data.summary.totalStudents}`}
        />
        <StatCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Completado promedio"
          value={`${data.summary.avgCompletionPct}%`}
        />
        <StatCard
          icon={<Sparkles className="w-4 h-4" />}
          label="XP total ganado"
          value={data.summary.totalXpEarned.toString()}
        />
        <StatCard
          icon={<Award className="w-4 h-4" />}
          label="Módulos en clase"
          value={data.classroom.totalModules.toString()}
        />
      </div>

      {/* Toolbar: search + filter + export */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o email…"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
          />
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-900 border border-slate-800 p-1">
          {(Object.keys(FILTER_LABELS) as FilterKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                filter === k
                  ? 'bg-violet-500/20 text-violet-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {FILTER_LABELS[k]}
            </button>
          ))}
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || data.students.length === 0}
          className="inline-flex items-center gap-2 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : '📊'}
          Exportar a Excel
        </button>
      </div>

      {exportError && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 flex items-start gap-2 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{exportError}</span>
        </div>
      )}

      {/* Tabla */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 rounded-2xl bg-slate-900 border border-slate-800 border-dashed">
          <p className="text-sm text-slate-500">
            {data.students.length === 0
              ? 'Aún no hay estudiantes inscritos en esta clase.'
              : 'No se encontraron estudiantes con esos filtros.'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
          {/* Header de columnas */}
          <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-slate-800 bg-slate-900/50 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            <Th label="Estudiante" k="fullName" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="col-span-3" />
            <Th label="Nivel" k="level" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="col-span-1 text-center" />
            <Th label="XP" k="totalXp" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="col-span-1 text-right" />
            <Th label="Completados" k="modulesCompleted" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="col-span-2 text-center" />
            <Th label="Score" k="avgScore" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="col-span-1 text-center" />
            <Th label="Racha" k="streakDays" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="col-span-1 text-center" />
            <Th label="Última act." k="lastActivityAt" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="col-span-3" />
          </div>

          {filtered.map((s) => (
            <StudentRowView
              key={s.studentId}
              s={s}
              expanded={expandedId === s.studentId}
              onToggle={() =>
                setExpandedId(expandedId === s.studentId ? null : s.studentId)
              }
              details={data.details.filter((d) => d.studentId === s.studentId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Subcomponentes
// ============================================================

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
        {icon}
        {label}
      </div>
      <div className="text-xl font-bold text-white mt-1">{value}</div>
    </div>
  );
}

function Th({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  className,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onClick: (k: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === k;
  return (
    <button
      onClick={() => onClick(k)}
      className={`flex items-center gap-1 hover:text-white transition ${
        active ? 'text-violet-300' : ''
      } ${className ?? ''}`}
    >
      {label}
      {active &&
        (sortDir === 'asc' ? (
          <ArrowUp className="w-3 h-3" />
        ) : (
          <ArrowDown className="w-3 h-3" />
        ))}
    </button>
  );
}

function StudentRowView({
  s,
  expanded,
  onToggle,
  details,
}: {
  s: StudentRow;
  expanded: boolean;
  onToggle: () => void;
  details: { moduleTitle: string; status: string; bestScore: number; attempts: number }[];
}) {
  const completionPct =
    s.modulesTotal > 0 ? Math.round((s.modulesCompleted / s.modulesTotal) * 100) : 0;
  const isAtRisk = s.daysSinceActivity == null || s.daysSinceActivity > 7;

  return (
    <div className="border-b border-slate-800 last:border-0">
      <button
        onClick={onToggle}
        className="w-full grid grid-cols-2 md:grid-cols-12 gap-2 px-4 py-3 text-left hover:bg-slate-900/50 transition items-center"
      >
        <div className="md:col-span-3 flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-300 text-sm font-semibold flex-shrink-0">
            {s.fullName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-white truncate">{s.fullName}</div>
            <div className="text-xs text-slate-500 truncate">{s.email ?? `@${s.username}`}</div>
          </div>
        </div>
        <div className="hidden md:block md:col-span-1 text-center text-sm text-slate-300">
          {s.level}
        </div>
        <div className="hidden md:block md:col-span-1 text-right text-sm font-mono text-violet-300">
          {s.totalXp}
        </div>
        <div className="hidden md:block md:col-span-2 text-center text-sm">
          <span className="text-white">
            {s.modulesCompleted}/{s.modulesTotal}
          </span>
          <span className="text-slate-500 ml-1">({completionPct}%)</span>
        </div>
        <div className="hidden md:block md:col-span-1 text-center text-sm">
          {s.avgScore > 0 ? `${s.avgScore}%` : '—'}
        </div>
        <div className="hidden md:block md:col-span-1 text-center text-sm">
          {s.streakDays > 0 ? `🔥 ${s.streakDays}` : '—'}
        </div>
        <div className="hidden md:block md:col-span-3 text-xs">
          {s.daysSinceActivity == null ? (
            <span className="text-slate-500">Sin actividad</span>
          ) : s.daysSinceActivity === 0 ? (
            <span className="text-emerald-400">Hoy</span>
          ) : (
            <span className={isAtRisk ? 'text-amber-400' : 'text-slate-400'}>
              Hace {s.daysSinceActivity} día{s.daysSinceActivity === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 bg-slate-950/50 border-t border-slate-800/50">
          <div className="pt-3 space-y-3">
            <Sparkline data={s.weeklyActivity} />
            {details.length > 0 ? (
              <div className="text-xs space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                  Detalle por módulo
                </div>
                {details.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 py-1 border-b border-slate-800/50 last:border-0"
                  >
                    <span className="text-slate-300 truncate">{d.moduleTitle}</span>
                    <span className="text-slate-500 text-[10px] uppercase tracking-wider">
                      {d.status}
                    </span>
                    <span className="text-violet-300 font-mono text-xs">
                      {d.bestScore}% · {d.attempts}x
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Sin progreso registrado.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Sparkline SVG inline (sin recharts)
// ============================================================

function Sparkline({ data }: { data: { weekStart: string; minutes: number }[] }) {
  if (data.length === 0) return null;
  const W = 200;
  const H = 32;
  const max = Math.max(1, ...data.map((d) => d.minutes));
  const barWidth = W / data.length;

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
        Actividad últimas {data.length} semanas (min)
      </div>
      <svg
        width={W}
        height={H + 14}
        viewBox={`0 0 ${W} ${H + 14}`}
        className="block"
        aria-label="Sparkline de actividad semanal"
      >
        {data.map((d, i) => {
          const h = (d.minutes / max) * H;
          return (
            <g key={i}>
              <rect
                x={i * barWidth + 1}
                y={H - h}
                width={Math.max(2, barWidth - 2)}
                height={Math.max(1, h)}
                rx={1}
                fill={d.minutes > 0 ? '#a78bfa' : '#334155'}
              />
              <text
                x={i * barWidth + barWidth / 2}
                y={H + 12}
                fontSize={8}
                fill="#64748b"
                textAnchor="middle"
              >
                {d.minutes}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
