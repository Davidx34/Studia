'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Send, CheckCircle2, AlertCircle, Clock, X } from 'lucide-react';
import { inviteStudents, type InviteStudentsResult } from '@/lib/actions/classrooms';
import { INVITE_PLACEHOLDER } from '@/lib/classrooms/constants';

export default function InviteStudentsForm({ classroomId }: { classroomId: string }) {
  const router = useRouter();
  const [emails, setEmails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<InviteStudentsResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!emails.trim()) return;
    setSubmitting(true);
    setResult(null);
    const r = await inviteStudents(classroomId, emails);
    setResult(r);
    setSubmitting(false);
    if (r.ok) {
      setEmails('');
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3"
      >
        <p className="text-xs text-slate-400">
          Pega o escribe emails separados por coma, punto y coma, espacios o saltos de línea.
          Los que ya tienen cuenta se inscribirán de inmediato; los demás quedarán pendientes
          y se inscribirán automáticamente cuando hagan signup.
        </p>
        <textarea
          rows={5}
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          placeholder={INVITE_PLACEHOLDER}
          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 resize-none font-mono"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || !emails.trim()}
            className="inline-flex items-center gap-2 bg-violet-500 hover:bg-violet-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-xl text-sm font-medium transition"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {submitting ? 'Invitando…' : 'Invitar'}
          </button>
        </div>
      </form>

      {result && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-2 text-sm">
          {!result.ok && result.error && (
            <div className="flex items-start gap-2 text-red-300">
              <AlertCircle className="w-4 h-4 mt-0.5" />
              <span>{result.error}</span>
            </div>
          )}
          <ResultRow
            ok
            icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            label="Inscritos"
            count={result.enrolled.length}
            items={result.enrolled}
          />
          <ResultRow
            icon={<Clock className="w-4 h-4 text-amber-400" />}
            label="Pendientes"
            count={result.pending.length}
            items={result.pending}
          />
          <ResultRow
            icon={<AlertCircle className="w-4 h-4 text-slate-400" />}
            label="Ya inscritos"
            count={result.alreadyEnrolled.length}
            items={result.alreadyEnrolled}
          />
          <ResultRow
            icon={<X className="w-4 h-4 text-red-400" />}
            label="Inválidos"
            count={result.invalidEmails.length}
            items={result.invalidEmails}
          />
        </div>
      )}
    </div>
  );
}

function ResultRow({
  ok,
  icon,
  label,
  count,
  items,
}: {
  ok?: boolean;
  icon: React.ReactNode;
  label: string;
  count: number;
  items: string[];
}) {
  if (count === 0) return null;
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <span className={ok ? 'text-emerald-300 font-medium' : 'text-slate-300 font-medium'}>
          {count}
        </span>{' '}
        <span className="text-slate-400">{label}:</span>{' '}
        <span className="text-slate-300 break-words">{items.join(', ')}</span>
      </div>
    </div>
  );
}
