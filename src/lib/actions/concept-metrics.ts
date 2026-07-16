'use server';

// Server action: getConceptGapData
// Fase 11 · Sesion C · Stud.ia
//
// Convierte question_attempts (Sesion B) en 3 vistas para el profesor:
// brecha de conocimiento por concepto, desempeño por estudiante, y la
// matriz concepto x estudiante para el heatmap. Misma verificacion de
// ownership que getClassroomProgress (defense-in-depth junto con RLS).

import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';

export type ConceptSeverity = 'critical' | 'important' | 'good';
export type StudentStatus = 'critical' | 'low' | 'good';

export interface ConceptMetric {
  conceptTag: string;
  totalAttempts: number;
  errorCount: number;
  errorRate: number;
  affectedStudents: number;
  severity: ConceptSeverity;
}

export interface StudentConceptBreakdown {
  correct: number;
  total: number;
  accuracy: number;
}

export interface StudentMetric {
  studentId: string;
  studentName: string;
  totalAttempts: number;
  correctAttempts: number;
  overallAccuracy: number;
  byConcept: Record<string, StudentConceptBreakdown>;
  strengths: string[]; // concept tags con accuracy >= 80
  weaknesses: string[]; // concept tags con accuracy < 70
  status: StudentStatus;
}

export interface MatrixCell {
  studentId: string;
  studentName: string;
  conceptTag: string;
  correct: number;
  total: number;
  accuracy: number;
}

export interface ConceptGapData {
  concepts: ConceptMetric[];
  students: StudentMetric[];
  matrix: MatrixCell[];
  conceptTags: string[];
  hasData: boolean;
}

function conceptSeverity(errorRate: number): ConceptSeverity {
  if (errorRate > 50) return 'critical';
  if (errorRate >= 30) return 'important';
  return 'good';
}

function studentStatus(accuracy: number): StudentStatus {
  if (accuracy < 60) return 'critical';
  if (accuracy <= 75) return 'low';
  return 'good';
}

export async function getConceptGapData(
  classroomId: string
): Promise<{ ok: boolean; data?: ConceptGapData; error?: string }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Verificar ownership (misma clase que getClassroomProgress).
  const { data: classroom } = await supabase
    .from('classrooms')
    .select('id')
    .eq('id', classroomId)
    .eq('teacher_id', user.id)
    .single();
  if (!classroom) return { ok: false, error: 'Clase no encontrada o sin permisos.' };

  const [conceptsRes, studentsRes, matrixRes] = await Promise.all([
    supabase.rpc('get_class_concept_metrics', { p_classroom_id: classroomId }),
    supabase.rpc('get_student_metrics', { p_classroom_id: classroomId }),
    supabase.rpc('get_concept_student_matrix', { p_classroom_id: classroomId }),
  ]);

  const concepts: ConceptMetric[] = (conceptsRes.data ?? []).map((c: any) => ({
    conceptTag: c.concept_tag,
    totalAttempts: Number(c.total_attempts),
    errorCount: Number(c.error_count),
    errorRate: Number(c.error_rate),
    affectedStudents: Number(c.affected_students),
    severity: conceptSeverity(Number(c.error_rate)),
  }));

  const students: StudentMetric[] = (studentsRes.data ?? []).map((s: any) => {
    const byConcept: Record<string, StudentConceptBreakdown> = s.concepts_breakdown ?? {};
    const strengths = Object.entries(byConcept)
      .filter(([, v]) => v.accuracy >= 80)
      .map(([k]) => k);
    const weaknesses = Object.entries(byConcept)
      .filter(([, v]) => v.accuracy < 70)
      .map(([k]) => k);
    return {
      studentId: s.student_id,
      studentName: s.student_name,
      totalAttempts: Number(s.total_attempts),
      correctAttempts: Number(s.correct_attempts),
      overallAccuracy: Number(s.overall_accuracy),
      byConcept,
      strengths,
      weaknesses,
      status: studentStatus(Number(s.overall_accuracy)),
    };
  });

  const matrix: MatrixCell[] = (matrixRes.data ?? []).map((m: any) => ({
    studentId: m.student_id,
    studentName: m.student_name,
    conceptTag: m.concept_tag,
    correct: Number(m.correct),
    total: Number(m.total),
    accuracy: Number(m.accuracy),
  }));

  const conceptTags = Array.from(new Set(matrix.map((m) => m.conceptTag))).sort();

  return {
    ok: true,
    data: {
      concepts,
      students,
      matrix,
      conceptTags,
      hasData: concepts.length > 0,
    },
  };
}
