'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle } from 'lucide-react';
import { createClassroom } from '@/lib/actions/classrooms';
import { SUBJECT_AREAS, GRADE_LEVELS } from '@/lib/classrooms/constants';

export default function NewClassroomForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [subjectArea, setSubjectArea] = useState<string>('');
  const [gradeLevel, setGradeLevel] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const result = await createClassroom({
      name,
      description,
      subject_area: subjectArea || undefined,
      grade_level: gradeLevel || undefined,
    });

    if (!result.ok || !result.classroomId) {
      setError(result.error ?? 'No se pudo crear la clase.');
      setSubmitting(false);
      return;
    }

    router.push(`/teacher/classrooms/${result.classroomId}/students`);
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-5"
    >
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-slate-300 mb-1.5">
          Nombre de la clase <span className="text-red-400">*</span>
        </label>
        <input
          id="name"
          type="text"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Geografía de América Latina"
          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
        />
      </div>

      <div>
        <label
          htmlFor="description"
          className="block text-sm font-medium text-slate-300 mb-1.5"
        >
          Descripción <span className="text-slate-500">(opcional)</span>
        </label>
        <textarea
          id="description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Breve descripción de qué aprenderán en esta clase…"
          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 resize-none"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="subject_area"
            className="block text-sm font-medium text-slate-300 mb-1.5"
          >
            Materia
          </label>
          <select
            id="subject_area"
            value={subjectArea}
            onChange={(e) => setSubjectArea(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          >
            <option value="">— Sin especificar —</option>
            {SUBJECT_AREAS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="grade_level"
            className="block text-sm font-medium text-slate-300 mb-1.5"
          >
            Grado
          </label>
          <select
            id="grade_level"
            value={gradeLevel}
            onChange={(e) => setGradeLevel(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          >
            <option value="">— Sin especificar —</option>
            {GRADE_LEVELS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:bg-slate-800 transition"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="inline-flex items-center gap-2 bg-violet-500 hover:bg-violet-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-xl text-sm font-medium transition"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitting ? 'Creando…' : 'Crear clase'}
        </button>
      </div>
    </form>
  );
}
