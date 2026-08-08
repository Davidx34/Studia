'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, X, AlertTriangle } from 'lucide-react';
import { approveReviewQuestion, rejectReviewQuestion } from '@/lib/actions/learning-objectives';

interface ReviewQuestion {
  id: string;
  module_id: string;
  moduleTitle: string;
  type: string;
  q: string;
  opts: string[] | null;
  ok: unknown;
  answers: string[] | null;
  exp: string | null;
  concept_tag: string | null;
}

// Fase 1.3: vista funcional, no decorativa, a proposito -- el plan explicita
// "no hace falta que sea bonita, que sea funcional". Una fila por pregunta,
// con Aprobar/Rechazar; al resolverse desaparece de la lista (revalidatePath
// la vuelve a traer sin esa fila).
export default function ReviewClient({ classroomId, questions }: { classroomId: string; questions: ReviewQuestion[] }) {
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle(id: string, action: 'approve' | 'reject') {
    setError(null);
    startTransition(async () => {
      const result =
        action === 'approve'
          ? await approveReviewQuestion(id, classroomId)
          : await rejectReviewQuestion(id, classroomId);
      if (!result.ok) {
        setError(result.error ?? 'Error al actualizar.');
        return;
      }
      setResolved((prev) => new Set(prev).add(id));
    });
  }

  const visible = questions.filter((q) => !resolved.has(q.id));
  const grouped = new Map<string, ReviewQuestion[]>();
  for (const q of visible) {
    if (!grouped.has(q.moduleTitle)) grouped.set(q.moduleTitle, []);
    grouped.get(q.moduleTitle)!.push(q);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/teacher/classrooms/${classroomId}/objectives`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a objetivos
        </Link>
      </div>

      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="w-5 h-5 text-amber-300" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">Revisión pendiente</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Preguntas que el juez IA no pudo aprobar ni rechazar con certeza (o que no se pudieron
            evaluar). Apruébalas para que se sirvan a los estudiantes, o recházalas para excluirlas
            del pool activo.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300">{error}</div>
      )}

      {visible.length === 0 ? (
        <div className="text-center py-12 rounded-2xl bg-slate-900/30 border border-slate-800 border-dashed">
          <p className="text-sm text-slate-500">No hay preguntas pendientes de revisión.</p>
        </div>
      ) : (
        Array.from(grouped.entries()).map(([moduleTitle, qs]: [string, ReviewQuestion[]]) => (
          <div key={moduleTitle} className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-300">{moduleTitle} ({qs.length})</h3>
            <div className="space-y-2">
              {qs.map((q) => (
                <div key={q.id} className="rounded-xl bg-slate-900 border border-slate-800 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-500 uppercase tracking-wide">
                        {q.type} {q.concept_tag ? `· ${q.concept_tag}` : ''}
                      </p>
                      <p className="text-sm text-white mt-1">{q.q}</p>
                      {q.opts && (
                        <ul className="text-xs text-slate-400 mt-1.5 space-y-0.5">
                          {q.opts.map((o: string, i: number) => (
                            <li key={i}>{o}</li>
                          ))}
                        </ul>
                      )}
                      {q.answers && (
                        <p className="text-xs text-slate-400 mt-1.5">Respuesta: {q.answers.join(', ')}</p>
                      )}
                      {q.exp && <p className="text-xs text-slate-500 mt-1.5 italic">{q.exp}</p>}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => handle(q.id, 'approve')}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50 transition"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Aprobar
                      </button>
                      <button
                        onClick={() => handle(q.id, 'reject')}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-50 transition"
                      >
                        <X className="w-3.5 h-3.5" />
                        Rechazar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
