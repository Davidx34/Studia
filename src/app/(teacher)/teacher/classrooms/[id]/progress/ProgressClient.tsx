'use client';

// Tabla de progreso del prof + export Excel (Fase 11.E)
// "A-la-fija": tabla nativa con useState (sin @tanstack/react-table).
// xlsx se carga lazy on-click via CDN.
//
// Fase 11 · Sesion C: se agregan 3 tabs de brecha de conocimiento por
// concepto (concept_tag, de question_attempts / Sesion B), sobre la
// tabla de progreso ya existente ("Resumen").

import { useEffect, useMemo, useState } from 'react';
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
import type { ClassMasteryResult } from '@/lib/actions/class-mastery';
import { ClassMasteryView } from '@/components/teacher/ClassMasteryView';
import {
  createRemediationPlan,
  getActiveRemediationPlans,
  type RemediationPlan,
} from '@/lib/actions/remediation-plans';

type SortKey =
  | 'fullName'
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

type ProgressTab = 'resumen' | 'dominio' | 'brecha' | 'estudiantes' | 'matriz';

const TAB_LABELS: Record<ProgressTab, string> = {
  resumen: 'Resumen',
  dominio: 'Dominio',
  brecha: 'Brecha de Conocimiento',
  estudiantes: 'Por Estudiante',
  matriz: 'Matriz Concepto-Estudiante',
};

export default function ProgressClient({
  data,
  conceptGap,
  mastery,
  masteryError = null,
}: {
  data: ClassroomProgressData;
  conceptGap: ConceptGapData | null;
  // Dominio por modulo y objetivo (null si no se pudo calcular; ver masteryError).
  mastery: ClassMasteryResult | null;
  masteryError?: string | null;
}) {
  const [tab, setTab] = useState<ProgressTab>('resumen');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('modulesCompleted');
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
          label="Módulos completados"
          value={data.summary.totalModulesCompleted.toString()}
        />
        <StatCard
          icon={<Award className="w-4 h-4" />}
          label="Módulos en clase"
          value={data.classroom.totalModules.toString()}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-line shadow-card bg-surface backdrop-blur-xl p-1 flex-wrap">
        {(Object.keys(TAB_LABELS) as ProgressTab[]).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              tab === k
                ? 'bg-primary/20 text-primary-text'
                : 'text-fg-muted hover:text-fg'
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
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre o email…"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface border border-line-strong text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex gap-1 rounded-xl border border-line shadow-card bg-surface backdrop-blur-xl p-1">
              {(Object.keys(FILTER_LABELS) as FilterKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    filter === k
                      ? 'bg-primary/20 text-primary-text'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  {FILTER_LABELS[k]}
                </button>
              ))}
            </div>
            <button
              onClick={handleExport}
              disabled={exporting || data.students.length === 0}
              className="inline-flex items-center gap-2 bg-success/15 hover:bg-success/25 text-success border border-success/30 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : '📊'}
              Exportar a Excel
            </button>
          </div>

          {exportError && (
            <div className="rounded-xl bg-danger/10 border border-danger/30 p-3 flex items-start gap-2 text-sm text-danger">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{exportError}</span>
            </div>
          )}

          {/* Tabla */}
          {filtered.length === 0 ? (
            <div className="text-center py-12 rounded-2xl border border-line shadow-card bg-surface backdrop-blur-xl border-dashed">
              <p className="text-sm text-fg-muted">
                {data.students.length === 0
                  ? 'Aún no hay estudiantes inscritos en esta clase.'
                  : 'No se encontraron estudiantes con esos filtros.'}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-line shadow-card bg-surface backdrop-blur-xl overflow-hidden">
              {/* Header de columnas */}
              <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-line-strong bg-surface text-[10px] font-semibold text-fg-muted uppercase tracking-wider">
                <Th label="Estudiante" k="fullName" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="col-span-5" />
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

      {tab === 'dominio' && <ClassMasteryView mastery={mastery?.mastery ?? null} truncated={mastery?.truncated ?? false} error={masteryError} />}
      {tab === 'brecha' && <ConceptBreach conceptGap={conceptGap} />}
      {tab === 'estudiantes' && (
        <StudentPerformance conceptGap={conceptGap} classroomId={data.classroom.id} />
      )}
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
  critical: { bar: 'bg-danger', badge: 'bg-danger/15 text-danger border-danger/30', label: '⚠️ CRÍTICO (>50% error)' },
  important: { bar: 'bg-accent', badge: 'bg-accent/15 text-accent-text border-accent/30', label: '⚠️ IMPORTANTE (30-50% error)' },
  good: { bar: 'bg-success', badge: 'bg-success/15 text-success border-success/30', label: '✓ DOMINADO (<30% error)' },
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
    <div className="rounded-2xl border border-line shadow-card bg-surface backdrop-blur-xl p-5 space-y-5">
      <h3 className="text-fg font-semibold">Brecha de Conocimiento de la Clase</h3>

      {(['critical', 'important', 'good'] as ConceptSeverity[]).map((sev) =>
        groups[sev].length > 0 ? (
          <div key={sev} className="space-y-2">
            <div className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-lg border ${SEVERITY_STYLES[sev].badge}`}>
              {SEVERITY_STYLES[sev].label}
            </div>
            {groups[sev].map((c) => (
              <div key={c.conceptTag} className="rounded-xl bg-bg/50 border border-line-strong p-3.5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-medium text-fg">{formatConceptLabel(c.conceptTag)}</span>
                  <span className="text-sm font-mono text-fg-muted">
                    {c.errorRate}% error ({c.errorCount}/{c.totalAttempts})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className={`h-full ${SEVERITY_STYLES[sev].bar}`}
                      style={{ width: `${Math.min(100, c.errorRate)}%` }}
                    />
                  </div>
                  <span className="text-xs text-fg-muted whitespace-nowrap">
                    {c.affectedStudents} estudiante{c.affectedStudents === 1 ? '' : 's'} afectado{c.affectedStudents === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : null
      )}

      {topCritical && (
        <div className="rounded-xl bg-primary/10 border border-primary/30 p-3.5 flex items-start gap-2">
          <span className="text-lg leading-none">📌</span>
          <p className="text-sm text-primary-text">
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
  critical: { badge: 'bg-danger/15 text-danger border-danger/30', label: '🔴 CRÍTICO (<60% general)', dot: 'text-danger' },
  low: { badge: 'bg-accent/15 text-accent-text border-accent/30', label: '🟡 BAJO (60-75% general)', dot: 'text-accent-text' },
  good: { badge: 'bg-success/15 text-success border-success/30', label: '🟢 BIEN (>75% general)', dot: 'text-success' },
};

function StudentPerformance({
  conceptGap,
  classroomId,
}: {
  conceptGap: ConceptGapData | null;
  classroomId: string;
}) {
  const [filter, setFilter] = useState<StudentFilter>('all');
  const [sort, setSort] = useState<StudentSort>('worst');
  const [plans, setPlans] = useState<Record<string, RemediationPlan>>({});
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  useEffect(() => {
    getActiveRemediationPlans(classroomId).then(setPlans);
  }, [classroomId]);

  async function handleCreatePlan(s: StudentMetric) {
    setPlanError(null);
    setCreatingFor(s.studentId);
    // 2-3 conceptos con peor performance, ordenados de peor a mejor.
    const weakest = [...s.weaknesses]
      .sort((a, b) => s.byConcept[a].accuracy - s.byConcept[b].accuracy)
      .slice(0, 3);
    const result = await createRemediationPlan(s.studentId, classroomId, weakest);
    setCreatingFor(null);
    if (result.ok) {
      setPlans((prev) => ({ ...prev, [s.studentId]: result.plan }));
      setConfirmedFor(s.studentId);
      setTimeout(() => setConfirmedFor(null), 4000);
    } else {
      setPlanError(result.error);
    }
  }

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
    <div className="rounded-2xl border border-line shadow-card bg-surface backdrop-blur-xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-fg font-semibold">Desempeño Individual</h3>
        <div className="flex gap-2 flex-wrap">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as StudentFilter)}
            className="text-xs bg-bg border border-line-strong rounded-lg px-2 py-1.5 text-fg-muted"
          >
            <option value="all">Todos</option>
            <option value="critical">Crítico</option>
            <option value="low">Bajo</option>
            <option value="good">Bien</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as StudentSort)}
            className="text-xs bg-bg border border-line-strong rounded-lg px-2 py-1.5 text-fg-muted"
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
              <div key={s.studentId} className="rounded-xl bg-bg/50 border border-line-strong p-3.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-fg">{s.studentName}</span>
                  <span className="text-sm font-mono text-fg-muted">
                    {s.overallAccuracy}% acierto ({s.correctAttempts}/{s.totalAttempts})
                  </span>
                </div>
                {s.strengths.length > 0 && (
                  <p className="text-xs text-success">
                    Fortalezas: {s.strengths.map(formatConceptLabel).join(', ')}
                  </p>
                )}
                {s.weaknesses.length > 0 ? (
                  <p className="text-xs text-danger">
                    Áreas débiles: {s.weaknesses
                      .map((tag) => `${formatConceptLabel(tag)} (${s.byConcept[tag].accuracy}%)`)
                      .join(', ')}
                  </p>
                ) : (
                  status === 'good' && <p className="text-xs text-fg-muted">Puede avanzar a contenido más desafiante.</p>
                )}
                {status !== 'good' && (
                  <div className="pt-1">
                    {plans[s.studentId] ? (
                      <span className="text-xs inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/30 text-primary-text">
                        {plans[s.studentId].status === 'completed' ? '✓' : '📋'} Plan activo: {plans[s.studentId].title.replace('Plan de Refuerzo: ', '')} (
                        {Math.round(
                          (plans[s.studentId].modules_completed / plans[s.studentId].modules_target) * 100
                        )}
                        % completado)
                      </span>
                    ) : (
                      <button
                        onClick={() => handleCreatePlan(s)}
                        disabled={creatingFor === s.studentId}
                        className="text-xs inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/30 text-primary-text hover:bg-primary/20 transition disabled:opacity-50"
                      >
                        {creatingFor === s.studentId ? 'Creando…' : '📋 Crear plan de refuerzo'}
                      </button>
                    )}
                    {confirmedFor === s.studentId && (
                      <span className="ml-2 text-[11px] text-success">
                        ✓ Plan creado y asignado a {s.studentName.split(' ')[0]}
                      </span>
                    )}
                    {planError && creatingFor === null && (
                      <span className="ml-2 text-[11px] text-danger">{planError}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : null
      )}

      {list.length === 0 && (
        <p className="text-sm text-fg-muted py-4 text-center">Ningún estudiante coincide con este filtro.</p>
      )}
    </div>
  );
}

// ============================================================
// Vista 3: Matriz Concepto-Estudiante
// ============================================================

function accuracyColor(accuracy: number): string {
  if (accuracy < 60) return 'bg-danger/70 text-fg';
  if (accuracy <= 80) return 'bg-accent/70 text-fg';
  return 'bg-success/70 text-fg';
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
    <div className="rounded-2xl border border-line shadow-card bg-surface backdrop-blur-xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-fg font-semibold">Matriz Concepto-Estudiante</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSortByName((v) => !v)}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-bg border border-line-strong text-fg-muted hover:text-fg transition"
          >
            Ordenar por {sortByName ? 'concepto' : 'nombre'}
          </button>
          <button
            onClick={handleExportCsv}
            className="text-xs inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-success/15 border border-success/30 text-success hover:bg-success/25 transition"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 bg-surface text-left text-fg-muted font-medium px-3 py-2 border-b border-line-strong">
                Estudiante
              </th>
              {conceptGap.conceptTags.map((tag) => (
                <th key={tag} className="text-fg-muted font-medium px-2 py-2 border-b border-line-strong whitespace-nowrap">
                  {formatConceptLabel(tag)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedStudents.map(([studentId, name]) => (
              <tr key={studentId}>
                <td className="sticky left-0 bg-surface text-fg px-3 py-2 border-b border-line-strong whitespace-nowrap">
                  {name}
                </td>
                {conceptGap.conceptTags.map((tag) => {
                  const cell = cellFor(studentId, tag);
                  return (
                    <td key={tag} className="px-1 py-1.5 border-b border-line-strong text-center">
                      {cell ? (
                        <span
                          title={`${cell.correct}/${cell.total} correctas`}
                          className={`inline-block w-14 rounded-md px-1.5 py-1 font-mono ${accuracyColor(cell.accuracy)}`}
                        >
                          {cell.accuracy}%
                        </span>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-fg-muted">
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-danger/70 align-middle mr-1" /> &lt;60% crítico</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-accent/70 align-middle mr-1" /> 60-80% en desarrollo</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-success/70 align-middle mr-1" /> &gt;80% dominado</span>
      </div>
    </div>
  );
}

function EmptyConceptState() {
  return (
    <div className="text-center py-12 rounded-2xl border border-line shadow-card bg-surface backdrop-blur-xl border-dashed">
      <AlertTriangle className="w-6 h-6 text-fg-muted mx-auto mb-2" />
      <p className="text-sm text-fg-muted">
        Todavía no hay suficientes intentos de preguntas registrados para esta clase.
      </p>
      <p className="text-xs text-fg-muted mt-1">
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
    <div className="rounded-2xl border border-line shadow-card bg-surface backdrop-blur-xl p-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-fg-muted">
        {icon}
        {label}
      </div>
      <div className="text-xl font-bold text-fg mt-1">{value}</div>
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
      className={`flex items-center gap-1 hover:text-fg transition ${
        active ? 'text-primary-text' : ''
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
    <div className="border-b border-line-strong last:border-0">
      <button
        onClick={onToggle}
        className="w-full grid grid-cols-2 md:grid-cols-12 gap-2 px-4 py-3 text-left hover:bg-surface transition items-center"
      >
        <div className="md:col-span-5 flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-primary-text text-sm font-semibold flex-shrink-0">
            {s.fullName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-fg truncate">{s.fullName}</div>
            <div className="text-xs text-fg-muted truncate">{s.email ?? `@${s.username}`}</div>
          </div>
        </div>
        <div className="hidden md:block md:col-span-2 text-center text-sm">
          <span className="text-fg">
            {s.modulesCompleted}/{s.modulesTotal}
          </span>
          <span className="text-fg-muted ml-1">({completionPct}%)</span>
        </div>
        <div className="hidden md:block md:col-span-1 text-center text-sm">
          {s.avgScore > 0 ? `${s.avgScore}%` : '—'}
        </div>
        <div className="hidden md:block md:col-span-1 text-center text-sm">
          {s.streakDays > 0 ? `🔥 ${s.streakDays}` : '—'}
        </div>
        <div className="hidden md:block md:col-span-3 text-xs">
          {s.daysSinceActivity == null ? (
            <span className="text-fg-muted">Sin actividad</span>
          ) : s.daysSinceActivity === 0 ? (
            <span className="text-success">Hoy</span>
          ) : (
            <span className={isAtRisk ? 'text-accent-text' : 'text-fg-muted'}>
              Hace {s.daysSinceActivity} día{s.daysSinceActivity === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 bg-bg/50 border-t border-line-strong">
          <div className="pt-3 space-y-3">
            <Sparkline data={s.weeklyActivity} />
            {details.length > 0 ? (
              <div className="text-xs space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-1">
                  Detalle por módulo
                </div>
                {details.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 py-1 border-b border-line-strong last:border-0"
                  >
                    <span className="text-fg-muted truncate">{d.moduleTitle}</span>
                    <span className="text-fg-muted text-[10px] uppercase tracking-wider">
                      {d.status}
                    </span>
                    <span className="text-primary-text font-mono text-xs">
                      {d.bestScore}% · {d.attempts}x
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-fg-muted">Sin progreso registrado.</p>
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
      <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-1">
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
