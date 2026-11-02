import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { parseBlueprint } from '@/lib/blueprint/parse';
import { linkTarget } from '@/lib/blueprint/linkStore';
import { buildReview } from '@/lib/blueprint/examReviewView';
import type { BankRow } from '@/lib/blueprint/examBank';
import ExamBankClient from './ExamBankClient';

// Banco de preguntas de examen: el profesor revisa lo que la IA genero (docs/EVALUACIONES.md). Se LEE con la sesion del profesor (la RLS de la migracion 088 solo le muestra las preguntas de
// SUS clases); se escribe por /api/exam-bank.
export default async function ExamBankPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: classroom } = await supabase.from('classrooms').select('id, name').eq('id', params.id).eq('teacher_id', user.id).maybeSingle();
  if (!classroom) redirect('/teacher/classrooms');

  const db: any = supabase;
  const { data: plans } = await db.from('course_blueprints').select('id, version, status, doc, published_at').eq('classroom_id', params.id);
  const target = linkTarget((plans ?? []) as any[]) as any;
  const parsed = target ? parseBlueprint(target.doc) : null;
  const back = (
    <Link href={`/teacher/classrooms/${params.id}/plan`} className="text-sm text-primary underline underline-offset-2">
      ← Volver al plan del curso
    </Link>
  );
  if (!target || !parsed || !parsed.ok) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        {back}
        <h1 className="text-2xl font-bold text-fg">Banco de preguntas de examen</h1>
        <p className="text-fg-muted">Primero guarda un plan del curso con sus comprensiones finales: las preguntas se generan por comprension y modulo.</p>
      </main>
    );
  }

  const { data: qrows, error } = await db.from('exam_questions').select('id, outcome_id, node_id, type, q, opts, ok, answers, keywords, pairs, exp, source_material_id, source_chunk, source_quote, review_status, judge_verdict, judge_problems').eq('blueprint_id', target.id).order('created_at', { ascending: true });
  const rows = (qrows ?? []) as BankRow[];
  const { data: mats } = await db.from('teaching_materials').select('id, filename').eq('classroom_id', params.id);
  const names = new Map<string, string>(((mats ?? []) as { id: string; filename: string | null }[]).map((m) => [m.id, m.filename ?? 'Material']));

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      {back}
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-fg">Banco de preguntas de examen</h1>
        <p className="text-fg-muted">
          {classroom.name} · plan v{target.version} ({target.status === 'draft' ? 'borrador' : 'publicado'}). La IA propone; solo las preguntas que apruebes entran a un examen.
        </p>
      </header>
      <ExamBankClient
        classroomId={params.id}
        tableMissing={!!error}
        groups={buildReview(parsed.blueprint, rows, names)}
        modulesByOutcome={Object.fromEntries(
          parsed.blueprint.outcomes.map((o) => [
            o.id,
            parsed.blueprint.periods.flatMap((p) => p.objectives.filter((ob) => ob.outcomeIds.includes(o.id)).flatMap((ob) => ob.modules.map((m) => ({ id: m.id, title: m.title })))),
          ])
        )}
      />
    </main>
  );
}
