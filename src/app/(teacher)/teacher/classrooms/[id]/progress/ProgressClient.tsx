'use client';

// Tabla de progreso del prof + export Excel (Fase 11.E)
// "A-la-fija": tabla nativa con useState (sin @tanstack/react-table).
// xlsx se carga lazy on-click via CDN.
//
// Fase 11 · Sesion C: se agregan 3 tabs de brecha de conocimiento por
// concepto (concept_tag, de question_attempts / Sesion B), sobre la
// tabla de progreso ya existente ("Resumen").

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
  AlertTriangle,
  CheckCircle2,
  Download,
} from 'lucide-react';
import type { ClassroomProgressData, StudentRow } from '@/lib/actions/classroom-progress';
import type { ConceptGapData, ConceptMetric, StudentMetric, ConceptSeverity, StudentStatus } from '@/lib/actions/concept-metrics';
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

type ProgressTab = 'resumen' | 'brecha' | 'estudiantes' | 'matriz';

const TAB_LABELS: Record<ProgressTab, string> = {
  resumen: 'Resumen',
  brecha: 'Brecha de Conocimiento',
  estudiantes: 'Por Estudiante',
  matriz: 'Matriz Concepto-Estudiante',
};

export default function ProgressClient({
  data,
  conceptGap,
}: {
  data: ClassroomProgressData;
  conceptGap: ConceptGapData | null;
}) {
  const [tab, setTab] = useState<ProgressTab>('resumen');
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

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-900 border border-slate-800 p-1 flex-wrap">
        {(Object.keys(TAB_LABELS) as ProgressTab[]).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              tab === k
                ? 'bg-violet-500/20 text-violet-300'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {TAB_LABELS[k]}
          </button>
        ))}
      </div>

      {tab === 'resumen' && (
        <>
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
        </>
      )}

      {tab === 'brecha' && <ConceptBreach conceptGap={conceptGap} />}
      {tab === 'estudiantes' && <StudentPerformance conceptGap={conceptGap} />}
      {tab === 'matriz' && <ConceptStudentMatrix conceptGap={conceptGap} />}
    </div>
  );
}

// ============================================================
// Vista 1: Brecha de Conocimiento
// ============================================================

function formatConceptLabel(tag: string): string {
  const s = tag.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SEVERITY_STYLES: Record<
  ConceptSeverity,
  { bar: string; badge: string; label: string }
> = {
  critical: { bar: 'bg-red-500', badge: 'bg-red-500/15 text-red-300 border-red-500/30', label: '⚠️ CRÍTICO (>50% error)' },
  important: { bar: 'bg-amber-500', badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30', label: '⚠️ IMPORTANTE (30-50% error)' },
  good: { bar: 'bg-emerald-500', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', label: '✓ DOMINADO (<30% error)' },
};

function ConceptBreach({ conceptGap }: { conceptGap: ConceptGapData | null }) {
  if (!conceptGap || !conceptGap.hasData) {
    return <EmptyConceptState />;
  }

  const groups: Record<ConceptSeverity, ConceptMetric[]> = {
    critical: conceptGap.concepts.filter((c) => c.severity === 'critical'),
    important: conceptGap.concepts.filter((c) => c.severity === 'important'),
    good: conceptGap.concepts.filter((c) => c.severity === 'good'),
  };

  const topCritical = groups.critical[0] ?? groups.important[0] ?? null;

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-5">
      <h3 className="text-white font-semibold">Brecha de Conocimiento de la Clase</h3>

      {(['critical', 'important', 'good'] as ConceptSeverity[]).map((sev) =>
        groups[sev].length > 0 ? (
          <div key={sev} className="space-y-2">
            <div className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-lg border ${SEVERITY_STYLES[sev].badge}`}>
              {SEVERITY_STYLES[sev].label}
            </div>
            {groups[sev].map((c) => (
              <div key={c.conceptTag} className="rounded-xl bg-slate-950/50 border border-slate-800 p-3.5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-medium text-white">{formatConceptLabel(c.conceptTag)}</span>
                  <span className="text-sm font-mono text-slate-300">
                    {c.errorRate}% error ({c.errorCount}/{c.totalAttempts})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full ${SEVERITY_STYLES[sev].bar}`}
                      style={{ width: `${Math.min(100, c.errorRate)}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    {c.affectedStudents} estudiante{c.affectedStudents === 1 ? '' : 's'} afectado{c.affectedStudents === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : null
      )}

      {topCritical && (
        <div className="rounded-xl bg-violet-500/10 border border-violet-500/30 p-3.5 flex items-start gap-2">
          <span className="text-lg leading-none">📌</span>
          <p className="text-sm text-violet-200">
            <strong>Recomendación:</strong> dedica unos minutos a reforzar{' '}
            <strong>"{formatConceptLabel(topCritical.conceptTag)}"</strong> en la próxima clase —{' '}
            {topCritical.errorRate}% de los intentos registrados fallan en este concepto (
            {topCritical.affectedStudents} estudiante{topCritical.affectedStudents === 1 ? '' : 's'}).
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Vista 2: Por Estudiante
// ============================================================

type StudentSort = 'worst' | 'best' | 'name';
type StudentFilter = 'all' | StudentStatus;

const STATUS_STYLES: Record<StudentStatus, { badge: string; label: string; dot: string }> = {
  critical: { badge: 'bg-red-500/15 text-red-300 border-red-500/30', label: '🔴 CRÍTICO (<60% general)', dot: 'text-red-400' },
  low: { badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30', label: '🟡 BAJO (60-75% general)', dot: 'text-amber-400' },
  good: { badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', label: '🟢 BIEN (>75% general)', dot: 'text-emerald-400' },
};

function StudentPerformance({ conceptGap }: { conceptGap: ConceptGapData | null }) {
  const [filter, setFilter] = useState<StudentFilter>('all');
  const [sort, setSort] = useState<StudentSort>('worst');
  const [planNoted, setPlanNoted] = useState<string | null>(null);

  if (!conceptGap || !conceptGap.hasData) {
    return <EmptyConceptState />;
  }

  let list = conceptGap.students;
  if (filter !== 'all') list = list.filter((s) => s.status === filter);
  list = [...list].sort((a, b) => {
    if (sort === 'name') return a.studentName.localeCompare(b.studentName);
    return sort === 'worst' ? a.overallAccuracy - b.overallAccuracy : b.overallAccuracy - a.overallAccuracy;
  });

  const groups: Record<StudentStatus, StudentMetric[]> = {
    critical: list.filter((s) => s.status === 'critical'),
    low: list.filter((s) => s.status === 'low'),
    good: list.filter((s) => s.status === 'good'),
  };

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-white font-semibold">Desempeño Individual</h3>
        <div className="flex gap-2 flex-wrap">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as StudentFilter)}
            className="text-xs bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-300"
          >
            <option value="all">Todos</option>
            <option value="critical">Crítico</option>
            <option value="low">Bajo</option>
            <option value="good">Bien</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as StudentSort)}
            className="text-xs bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-300"
          >
            <option value="worst">Peor primero</option>
            <option value="best">Mejor primero</option>
            <option value="name">Nombre</option>
          </select>
        </div>
      </div>

      {(['critical', 'low', 'good'] as StudentStatus[]).map((status) =>
        groups[status].length > 0 ? (
          <div key={status} className="space-y-2">
            <div className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-lg border ${STATUS_STYLES[status].badge}`}>
              {STATUS_STYLES[status].label}
            </div>
            {groups[status].map((s) => (
              <div key={s.studentId} className="rounded-xl bg-slate-950/50 border border-slate-800 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white">{s.studentName}</span>
                  <span className="text-sm font-mono text-slate-300">
                    {s.overallAccuracy}% acierto ({s.correctAttempts}/{s.totalAttempts})
                  </span>
                </div>
                {s.strengths.length > 0 && (
                  <p className="text-xs text-emerald-300">
                    Fortalezas: {s.strengths.map(formatConceptLabel).join(', ')}
                  </p>
                )}
                {s.weaknesses.length > 0 ? (
                  <p className="text-xs text-red-300">
                    Áreas débiles: {s.weaknesses
                      .map((tag) => `${formatConceptLabel(tag)} (${s.byConcept[tag].accuracy}%)`)
                      .join(', ')}
                  </p>
                ) : (
                  status === 'good' && <p className="text-xs text-slate-500">Puede avanzar a contenido más desafiante.</p>
                )}
                {status !== 'good' && (
                  <div className="pt-1">
                    <button
                      onClick={() => setPlanNoted(s.studentId)}
                      className="text-xs inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-500/10 border border-violet-500/30 text-violet-300 hover:bg-violet-500/20 transition"
                    >
                      📋 Crear plan de refuerzo
                    </button>
                    {planNoted === s.studentId && (
                      <span className="ml-2 text-[11px] text-slate-500">🔜 Disponible próximamente</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : null
      )}

      {list.length === 0 && (
        <p className="text-sm text-slate-500 py-4 text-center">Ningún estudiante coincide con este filtro.</p>
      )}
    </div>
  );
}

// ============================================================
// Vista 3: Matriz Concepto-Estudiante
// ============================================================

function accuracyColor(accuracy: number): string {
  if (accuracy < 60) return 'bg-red-500/70 text-white';
  if (accuracy <= 80) return 'bg-amber-500/70 text-white';
  return 'bg-emerald-500/70 text-white';
}

function ConceptStudentMatrix({ conceptGap }: { conceptGap: ConceptGapData | null }) {
  const [sortByName, setSortByName] = useState(true);

  if (!conceptGap || !conceptGap.hasData) {
    return <EmptyConceptState />;
  }

  const studentNames = Array.from(
    new Map(conceptGap.matrix.map((m) => [m.studentId, m.studentName])).entries()
  );
  const sortedStudents = sortByName
    ? [...studentNames].sort((a, b) => a[1].localeCompare(b[1]))
    : studentNames;

  const cellFor = (studentId: string, conceptTag: string) =>
    conceptGap.matrix.find((m) => m.studentId === studentId && m.conceptTag === conceptTag);

  function handleExportCsv() {
    const header = ['Estudiante', ...conceptGap!.conceptTags.map(formatConceptLabel)];
    const rows = sortedStudents.map(([studentId, name]) => [
      name,
      ...conceptGap!.conceptTags.map((tag) => {
        const cell = cellFor(studentId, tag);
        return cell ? `${cell.accuracy}%` : '';
      }),
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'matriz-concepto-estudiante.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-white font-semibold">Matriz Concepto-Estudiante</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSortByName((v) => !v)}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-300 hover:text-white transition"
          >
            Ordenar por {sortByName ? 'concepto' : 'nombre'}
          </button>
          <button
            onClick={handleExportCsv}
            className="text-xs inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 bg-slate-900 text-left text-slate-400 font-medium px-3 py-2 border-b border-slate-800">
                Estudiante
              </th>
              {conceptGap.conceptTags.map((tag) => (
                <th key={tag} className="text-slate-400 font-medium px-2 py-2 border-b border-slate-800 whitespace-nowrap">
                  {formatConceptLabel(tag)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedStudents.map(([studentId, name]) => (
              <tr key={studentId}>
                <td className="sticky left-0 bg-slate-900 text-white px-3 py-2 border-b border-slate-800/50 whitespace-nowrap">
                  {name}
                </td>
                {conceptGap.conceptTags.map((tag) => {
                  const cell = cellFor(studentId, tag);
                  return (
                    <td key={tag} className="px-1 py-1.5 border-b border-slate-800/50 text-center">
                      {cell ? (
                        <span
                          title={`${cell.correct}/${cell.total} correctas`}
                          className={`inline-block w-14 rounded-md px-1.5 py-1 font-mono ${accuracyColor(cell.accuracy)}`}
                        >
                          {cell.accuracy}%
                        </span>
                      ) : (
                        <span className="text-slate-700">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-slate-500">
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500/70 align-middle mr-1" /> &lt;60% crítico</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500/70 align-middle mr-1" /> 60-80% en desarrollo</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500/70 align-middle mr-1" /> &gt;80% dominado</span>
      </div>
    </div>
  );
}

function EmptyConceptState() {
  return (
    <div className="text-center py-12 rounded-2xl bg-slate-900 border border-slate-800 border-dashed">
      <AlertTriangle className="w-6 h-6 text-slate-600 mx-auto mb-2" />
      <p className="text-sm text-slate-500">
        Todavía no hay suficientes intentos de preguntas registrados para esta clase.
      </p>
      <p className="text-xs text-slate-600 mt-1">
        Esta vista se llena a medida que los estudiantes responden preguntas en sus lecciones.
      </p>
    </div>
  );
}

// ============================================================
// Subcomponentes (tabla "Resumen")
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
