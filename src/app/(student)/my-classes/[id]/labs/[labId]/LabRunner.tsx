'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LabFrame } from '@/components/lab/LabFrame';
import { parseAttemptState } from '@/lib/lab/protocol';
import type { LabAttemptState, ResolvedLab } from '@/lib/lab/types';

// El borrador vive solo en este navegador (no es la entrega): si el estudiante cierra la pestana, no pierde sus ensayos. Lo que se entrega lo valida el servidor.
const draftKey = (userId: string, labId: string) => `lab-draft:${userId}:${labId}`;

function loadDraft(userId: string, labId: string): LabAttemptState | null {
  try {
    const raw = window.localStorage.getItem(draftKey(userId, labId));
    return raw ? parseAttemptState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export default function LabRunner({ labId, userId, lab, submitted }: { labId: string; userId: string; lab: ResolvedLab; submitted: LabAttemptState | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState<LabAttemptState | null | undefined>(submitted ? submitted : undefined);
  const [problems, setProblems] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const sendingRef = useRef(false);

  // Se lee el borrador despues de montar (localStorage no existe en el servidor).
  useEffect(() => {
    if (!submitted) setDraft(loadDraft(userId, labId));
  }, [submitted, userId, labId]);

  const onState = useCallback(
    (s: LabAttemptState) => {
      try {
        window.localStorage.setItem(draftKey(userId, labId), JSON.stringify(s));
      } catch {
        /* sin almacenamiento: se sigue sin borrador */
      }
    },
    [userId, labId]
  );

  const onSubmit = useCallback(
    async (state: LabAttemptState) => {
      if (sendingRef.current) return;
      sendingRef.current = true;
      setSending(true);
      setProblems([]);
      try {
        const res = await fetch('/api/lab/attempt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ labId, state }) });
        const data = await res.json().catch(() => ({}));
        if (res.ok || res.status === 409) {
          try {
            window.localStorage.removeItem(draftKey(userId, labId));
          } catch {
            /* nada */
          }
          setDone(true);
          router.refresh();
          return;
        }
        setProblems(Array.isArray(data?.errors) && data.errors.length ? data.errors : [data?.error ?? 'No se pudo entregar el informe. Inténtalo de nuevo.']);
      } catch {
        setProblems(['No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.']);
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [labId, userId, router]
  );

  // Hasta saber si hay borrador no se monta el laboratorio (el estado inicial se manda una sola vez).
  if (draft === undefined) return <p className="text-fg-muted">Cargando…</p>;

  return (
    <div className="space-y-3">
      {problems.length > 0 && (
        <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-fg">
          <p className="font-semibold">No se pudo entregar tu informe:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {(sending || done) && (
        <p role="status" className="rounded-xl border border-line bg-surface-2 p-3 text-sm text-fg">
          {done ? 'Informe entregado. ¡Buen trabajo!' : 'Entregando tu informe…'}
        </p>
      )}
      <LabFrame lab={lab} state={draft} readOnly={!!submitted || done} onState={submitted ? undefined : onState} onSubmit={submitted ? undefined : onSubmit} />
    </div>
  );
}
