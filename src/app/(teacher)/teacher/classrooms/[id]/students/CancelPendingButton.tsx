'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { X, Loader2 } from 'lucide-react';
import { cancelPendingInvitation } from '@/lib/actions/classrooms';

export default function CancelPendingButton({
  pendingId,
  email,
}: {
  pendingId: string;
  email: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm(`¿Cancelar invitación a ${email}?`)) return;
    startTransition(async () => {
      await cancelPendingInvitation(pendingId);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title="Cancelar invitación"
      className="p-1.5 rounded-lg text-amber-400/60 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition"
    >
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
    </button>
  );
}
