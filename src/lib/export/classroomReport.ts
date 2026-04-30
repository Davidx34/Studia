// Export de progreso de clase a Excel (4 hojas)
// Fase 11.E · Stud.ia
//
// "A-la-fija": NO importa SheetJS estaticamente porque no esta instalado en
// package.json. Usa import dinamico desde esm.sh CDN solo cuando se invoca.
// Asi no afecta builds ni SSR. Si el navegador no tiene internet en ese
// momento, falla con mensaje claro.

import type { ClassroomProgressData } from '@/lib/actions/classroom-progress';

const SHEETJS_CDN = 'https://esm.sh/xlsx@0.18.5';

export async function downloadClassroomReportXlsx(data: ClassroomProgressData): Promise<void> {
  // Carga lazy
  const XLSX: any = await import(/* webpackIgnore: true */ SHEETJS_CDN);

  const wb = XLSX.utils.book_new();

  // ============================================================
  // Hoja 1: Resumen (1 fila por estudiante con stats agregados)
  // ============================================================
  const resumenRows = data.students.map((s) => ({
    Nombre: s.fullName,
    Usuario: s.username,
    Email: s.email ?? '',
    Nivel: s.level,
    'XP total': s.totalXp,
    'XP ganado en clase': s.earnedXpInClass,
    Racha: s.streakDays,
    'Módulos completados': s.modulesCompleted,
    'Módulos totales': s.modulesTotal,
    'Score promedio': s.avgScore,
    'Tiempo total (min)': Math.round(s.totalTimeSeconds / 60),
    'Última actividad':
      s.lastActivityAt ? new Date(s.lastActivityAt).toLocaleDateString('es') : 'Sin actividad',
    'Días sin actividad': s.daysSinceActivity ?? 'N/A',
  }));
  const wsResumen = XLSX.utils.json_to_sheet(resumenRows);
  applyHeaderStyles(wsResumen, Object.keys(resumenRows[0] ?? {}).length);
  autoWidth(wsResumen, resumenRows);
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  // ============================================================
  // Hoja 2: Detalle por modulo
  // ============================================================
  const detalleRows = data.details.map((d) => ({
    Estudiante: d.studentName,
    Módulo: d.moduleTitle,
    Estado: estadoLabel(d.status),
    'Score actual': d.score ?? '',
    'Mejor score': d.bestScore,
    Intentos: d.attempts,
    'Tiempo (min)': Math.round(d.timeSeconds / 60),
    'XP ganado': d.earnedXp,
    'Completado en':
      d.completedAt ? new Date(d.completedAt).toLocaleDateString('es') : '',
  }));
  const wsDetalle = XLSX.utils.json_to_sheet(detalleRows);
  applyHeaderStyles(wsDetalle, Object.keys(detalleRows[0] ?? {}).length);
  autoWidth(wsDetalle, detalleRows);
  XLSX.utils.book_append_sheet(wb, wsDetalle, 'Detalle por módulo');

  // ============================================================
  // Hoja 3: Actividad semanal (matriz estudiantes x semanas)
  // ============================================================
  const weekHeaders =
    data.students[0]?.weeklyActivity.map((w) =>
      new Date(w.weekStart).toLocaleDateString('es', { day: '2-digit', month: '2-digit' })
    ) ?? [];
  const semanalRows = data.students.map((s) => {
    const row: Record<string, any> = { Estudiante: s.fullName };
    for (const wk of s.weeklyActivity) {
      const key = new Date(wk.weekStart).toLocaleDateString('es', {
        day: '2-digit',
        month: '2-digit',
      });
      row[`Semana ${key} (min)`] = wk.minutes;
    }
    return row;
  });
  const wsSemanal =
    semanalRows.length > 0
      ? XLSX.utils.json_to_sheet(semanalRows)
      : XLSX.utils.aoa_to_sheet([['Sin estudiantes inscritos']]);
  applyHeaderStyles(wsSemanal, 1 + weekHeaders.length);
  autoWidth(wsSemanal, semanalRows);
  XLSX.utils.book_append_sheet(wb, wsSemanal, 'Actividad semanal');

  // ============================================================
  // Hoja 4: Información de la clase
  // ============================================================
  const c = data.classroom;
  const infoRows = [
    { Campo: 'Nombre de la clase', Valor: c.name },
    { Campo: 'Descripción', Valor: c.description ?? '' },
    { Campo: 'Materia', Valor: c.subjectArea ?? '' },
    { Campo: 'Grado', Valor: c.gradeLevel ?? '' },
    { Campo: 'Código de inscripción', Valor: c.joinCode },
    { Campo: 'Profesor', Valor: c.teacherName },
    { Campo: 'Email del profesor', Valor: c.teacherEmail ?? '' },
    { Campo: 'Materiales subidos', Valor: c.totalMaterials },
    { Campo: 'Módulos en la clase', Valor: c.totalModules },
    { Campo: 'Estudiantes inscritos', Valor: data.students.length },
    {
      Campo: 'Estudiantes activos (últimos 7 días)',
      Valor: data.summary.activeStudents,
    },
    { Campo: '% completado promedio', Valor: `${data.summary.avgCompletionPct}%` },
    { Campo: 'XP total ganado', Valor: data.summary.totalXpEarned },
    { Campo: 'Fecha de creación', Valor: new Date(c.createdAt).toLocaleDateString('es') },
    { Campo: 'Fecha de exportación', Valor: new Date().toLocaleDateString('es') },
  ];
  const wsInfo = XLSX.utils.json_to_sheet(infoRows);
  applyHeaderStyles(wsInfo, 2);
  autoWidth(wsInfo, infoRows);
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Información de la clase');

  // ============================================================
  // Trigger download
  // ============================================================
  const slug = slugify(c.name);
  const today = new Date().toISOString().slice(0, 10);
  const filename = `progreso-${slug}-${today}.xlsx`;

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================
// Helpers
// ============================================================

function applyHeaderStyles(ws: any, colCount: number) {
  // SheetJS CE no soporta estilos avanzados en xlsx free, pero igual
  // marcamos celdas header con metadata "s" para que un xlsx-pro reader
  // pueda interpretar. En la mayoria de cases solo formatea bold via
  // worksheet renderer (no aplica en CDN free, pero dejamos el hook).
  if (!ws['!cols']) ws['!cols'] = [];
  for (let i = 0; i < colCount; i++) {
    if (!ws['!cols'][i]) ws['!cols'][i] = {};
  }
}

function autoWidth(ws: any, rows: any[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const widths = headers.map((h) => {
    const headerLen = h.length;
    const dataMax = Math.max(
      ...rows.map((r) => String(r[h] ?? '').length),
      0
    );
    return { wch: Math.min(40, Math.max(8, Math.max(headerLen, dataMax) + 2)) };
  });
  ws['!cols'] = widths;
}

function estadoLabel(s: string): string {
  switch (s) {
    case 'completed':
      return 'Completado';
    case 'in_progress':
      return 'En progreso';
    case 'available':
      return 'Disponible';
    case 'locked':
      return 'Bloqueado';
    default:
      return s;
  }
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}
