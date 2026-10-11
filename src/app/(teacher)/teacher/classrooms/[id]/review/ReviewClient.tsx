'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, X, AlertTriangle } from 'lucide-react';
import { approveReviewQuestion, rejectReviewQuestion } from '@/lib/actions/learning-objectives';
import RespuestaCorrecta from './RespuestaCorrecta';

interface ReviewQuestion {
  id: string;
  module_id: string;
  moduleTitle: string;
  type: string;
  q: string;
  opts: string[] | null;
  ok: unknown;
  answers: string[] | null;
  pairs: unknown;
  keywords: string[] | null;
  exp: string | null;
  concept_tag: string | null;
  game_type: string | null;
  game_data: unknown;
  review_reason: string | null;
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
          className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a objetivos
        </Link>
      </div>

      <div className="rounded-2xl border border-line shadow-card bg-surface backdrop-blur-xl p-5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="w-5 h-5 text-accent-text" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-fg">Revisión pendiente</h2>
          <p className="text-sm text-fg-muted mt-0.5">
            Preguntas que el juez IA no pudo aprobar ni rechazar con certeza (o que no se pudieron
            evaluar). Apruébalas para que se sirvan a los estudiantes, o recházalas para excluirlas
            del pool activo.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-danger/10 border border-danger/30 p-3 text-sm text-danger">{error}</div>
      )}

      {visible.length === 0 ? (
        <div className="text-center py-12 rounded-2xl bg-surface border border-line-strong border-dashed">
          <p className="text-sm text-fg-muted">No hay preguntas pendientes de revisión.</p>
        </div>
      ) : (
        Array.from(grouped.entries()).map(([moduleTitle, qs]: [string, ReviewQuestion[]]) => (
          <div key={moduleTitle} className="space-y-2">
            <h3 className="text-sm font-semibold text-fg-muted">{moduleTitle} ({qs.length})</h3>
            <div className="space-y-2">
              {qs.map((q) => (
                <div key={q.id} className="rounded-xl border border-line shadow-card bg-surface backdrop-blur-xl p-4 space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-fg-muted uppercase tracking-wide">
                        {q.type} {q.concept_tag ? `· ${q.concept_tag}` : ''}
                      </p>
                      <p className="text-sm text-fg mt-1">{q.q}</p>
                      <RespuestaCorrecta q={q} />
                      {/* Un minijuego no tiene su contenido en "q" (que suele
                          ser un titulo generico como "Resuelve la crisis")
                          sino en game_data. Sin esto, el profesor tenia que
                          decidir sobre una pregunta cuyo contenido no veia --
                          el mismo problema que tenia el juez IA (review 360
                          §3.3), pero del lado humano. */}
                      {q.game_data != null && (
                        <details className="mt-1.5">
                          <summary className="text-xs text-fg-muted cursor-pointer rounded">
                            Ver contenido del minijuego{q.game_type ? ` (${q.game_type})` : ''}
                          </summary>
                          <pre className="text-[11px] text-fg-muted mt-1.5 p-2 rounded-lg bg-black/30 overflow-x-auto whitespace-pre-wrap break-words">
                            {JSON.stringify(q.game_data, null, 2)}
                          </pre>
                        </details>
                      )}
                      {q.exp && <p className="text-xs text-fg-muted mt-1.5 italic">{q.exp}</p>}
                      {/* La razon del juez (migracion 044) -- antes se
                          calculaba y se tiraba, dejando al profesor una cola
                          sin ninguna pista de por que cada pregunta esta ahi. */}
                      {q.review_reason && (
                        <p className="text-xs mt-2 p-2 rounded-lg bg-accent/10 border border-accent/20 text-accent-text/90">
                          <span className="font-medium">Por qué la marcó la IA:</span> {q.review_reason}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => handle(q.id, 'approve')}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-success/15 text-success border border-success/30 hover:bg-success/25 disabled:opacity-50 transition"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Aprobar
                      </button>
                      <button
                        onClick={() => handle(q.id, 'reject')}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25 disabled:opacity-50 transition"
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
