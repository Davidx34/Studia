'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { X, Loader2 } from 'lucide-react';
import { removeEnrollment } from '@/lib/actions/classrooms';

export default function RemoveEnrollmentButton({
  classroomId,
  studentId,
}: {
  classroomId: string;
  studentId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm('¿Quitar a este estudiante de la clase? Su progreso en la clase se perderá.'))
      return;
    startTransition(async () => {
      await removeEnrollment(classroomId, studentId);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title="Quitar de la clase"
      className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition"
    >
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
    </button>
  );
}
