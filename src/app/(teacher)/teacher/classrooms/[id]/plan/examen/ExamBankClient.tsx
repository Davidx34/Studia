'use client';

// Revision del banco de preguntas de examen. El profesor ve cada pregunta con su clave, su explicacion, la cita del material y lo que dijo el juez, y la aprueba o la rechaza. La IA propone,
// el profesor decide: nada entra a un examen sin su aprobacion. Tambien puede pedir mas preguntas para una comprension y modulo.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { ReviewGroup, ReviewItem } from '@/lib/blueprint/examReviewView';

const SELECT = 'w-full min-h-[44px] rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-base text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch('/api/exam-bank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, data: { error: 'No hay conexion con el servidor. Revisa tu red e intenta de nuevo.' } };
  }
}

const STATUS_TEXT: Record<ReviewItem['status'], string> = { pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada' };

export default function ExamBankClient({ classroomId, tableMissing, groups: initial, modulesByOutcome }: { classroomId: string; tableMissing: boolean; groups: ReviewGroup[]; modulesByOutcome: Record<string, { id: string; title: string }[]> }) {
  const router = useRouter();
  const [groups, setGroups] = useState(initial);
  useEffect(() => setGroups(initial), [initial]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [moduleFor, setModuleFor] = useState<Record<string, string>>({});

  if (tableMissing) return <Card className="p-4 text-fg-muted">El banco de preguntas todavia no esta disponible en esta base de datos.</Card>;

  const decide = async (item: ReviewItem, decision: 'approved' | 'rejected') => {
    setBusy(item.id);
    setNotice(null);
    const r = await post({ action: 'review', classroomId, questionId: item.id, decision });
    setBusy(null);
    if (!r.ok) return setNotice({ tone: 'error', text: r.data?.error ?? 'No se pudo guardar tu decision.' });
    setGroups((gs) =>
      gs.map((g) => {
        if (!g.items.some((i) => i.id === item.id)) return g;
        const items = g.items.map((i) => (i.id === item.id ? { ...i, status: decision } : i));
        const n = (s: ReviewItem['status']) => items.filter((i) => i.status === s).length;
        return { ...g, items, approved: n('approved'), pending: n('pending'), rejected: n('rejected') };
      })
    );
  };

  const generate = async (g: ReviewGroup) => {
    const nodeId = moduleFor[g.outcomeId] ?? modulesByOutcome[g.outcomeId]?.[0]?.id;
    if (!nodeId) return;
    setBusy(`gen-${g.outcomeId}`);
    setNotice(null);
    const r = await post({ action: 'generate', classroomId, outcomeId: g.outcomeId, nodeId });
    setBusy(null);
    if (!r.ok) return setNotice({ tone: 'error', text: r.data?.error ?? 'No se pudieron generar preguntas.' });
    const saved = r.data?.saved;
    setNotice({ tone: 'ok', text: typeof saved === 'number' ? (saved === 0 ? 'La IA no logro escribir preguntas validas con ese material. Prueba con otro modulo.' : `${saved} ${saved === 1 ? 'pregunta nueva lista' : 'preguntas nuevas listas'} para revisar.`) : 'Listo.' });
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {notice && (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${notice.tone === 'error' ? 'border-danger text-danger' : 'border-line text-fg'}`}>
          {notice.text}
        </p>
      )}
      {groups.map((g) => {
        const mods = modulesByOutcome[g.outcomeId] ?? [];
        return (
          <Card key={g.outcomeId} className="space-y-3 p-4">
            <div>
              <h2 className="text-lg font-semibold text-fg">{g.statement}</h2>
              <p className="text-sm text-fg-muted">
                {g.approved} aprobadas · {g.pending} pendientes · {g.rejected} rechazadas
                {g.approved === 0 && <span className="text-danger"> · sin preguntas aprobadas, esta comprension no se puede examinar</span>}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex-1 text-sm text-fg-muted">
                Generar mas preguntas desde el modulo
                <select className={SELECT} value={moduleFor[g.outcomeId] ?? mods[0]?.id ?? ''} onChange={(e) => setModuleFor((m) => ({ ...m, [g.outcomeId]: e.target.value }))} disabled={mods.length === 0}>
                  {mods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title || '(sin titulo)'}
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="secondary" loading={busy === `gen-${g.outcomeId}`} disabled={mods.length === 0 || busy !== null} onClick={() => generate(g)}>
                <Sparkles className="h-4 w-4" aria-hidden="true" /> Generar con IA
              </Button>
            </div>
            {busy === `gen-${g.outcomeId}` && <p className="text-sm text-fg-muted">La IA lee el material y escribe las preguntas; puede tardar un minuto.</p>}

            {g.items.length === 0 && <p className="text-sm text-fg-muted">Todavia no hay preguntas para esta comprension.</p>}
            <ul className="space-y-3">
              {g.items.map((i) => (
                <li key={i.id} className="space-y-2 rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                    <span className="font-semibold text-fg">{STATUS_TEXT[i.status]}</span>
                    <span>· {i.typeLabel}</span>
                    <span>· {i.periodName ? `${i.periodName} · ` : ''}{i.moduleTitle}</span>
                  </div>
                  <p className="text-base font-medium text-fg">{i.q}</p>
                  {i.options.length > 0 && (
                    <ul className="space-y-1 text-sm">
                      {i.options.map((o, k) => (
                        <li key={k} className={o.correct ? 'font-semibold text-fg' : 'text-fg-muted'}>
                          {o.correct ? '✔ ' : '• '}
                          {o.text}
                          {o.correct && <span className="sr-only"> (respuesta correcta)</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {i.key && <p className="text-sm text-fg">Clave: {i.key}</p>}
                  <p className="text-sm text-fg-muted">
                    <span className="font-semibold text-fg">Explicacion: </span>
                    {i.exp}
                  </p>
                  <p className="text-sm text-fg-muted">
                    <span className="font-semibold text-fg">Material: </span>
                    {i.materialName} — «{i.quote}»
                  </p>
                  <p className={`text-sm ${i.attention ? 'font-semibold text-danger' : 'text-fg-muted'}`}>{i.verdictLabel}</p>
                  {i.problems.length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-5 text-sm text-fg-muted">
                      {i.problems.map((p, k) => (
                        <li key={k}>{p}</li>
                      ))}
                    </ul>
                  )}
                  {i.status === 'pending' && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="md" loading={busy === i.id} disabled={busy !== null} onClick={() => decide(i, 'approved')}>
                        <Check className="h-4 w-4" aria-hidden="true" /> Aprobar
                      </Button>
                      <Button size="md" variant="secondary" disabled={busy !== null} onClick={() => decide(i, 'rejected')}>
                        <X className="h-4 w-4" aria-hidden="true" /> Rechazar
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
