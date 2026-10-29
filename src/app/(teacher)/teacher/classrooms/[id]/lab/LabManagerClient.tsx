'use client';

import { useMemo, useState } from 'react';
import { FlaskConical, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LAB_TEMPLATES } from '@/lib/lab/labTemplates';
import { defaultSpec } from '@/lib/lab/labSpec';
import { PROPOSAL_LIMITS } from '@/lib/lab/propose';
import { STATUS_LABEL, sortItems, type LabItem } from '@/lib/lab/labRows';
import { LAB_AREA_LABEL } from '@/lib/lab/types';
import LabEditor, { type EditorStart } from './LabEditor';

export interface MaterialOption {
  id: string;
  name: string;
}

const inputCls =
  'w-full min-h-[44px] rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-base text-fg placeholder:text-fg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function LabManagerClient({ classroomId, teacherId, initialItems, materials, tableMissing }: { classroomId: string; teacherId: string; initialItems: LabItem[]; materials: MaterialOption[]; tableMissing: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<LabItem[]>(initialItems);
  const [editing, setEditing] = useState<EditorStart | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Propuesta con IA
  const [idea, setIdea] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [template, setTemplate] = useState('auto');
  const [proposing, setProposing] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);

  const db: any = supabase;
  const upsert = (item: LabItem) => setItems((list) => sortItems([...list.filter((i) => i.id !== item.id), item]));

  if (tableMissing) {
    return (
      <Card className="space-y-2 p-5">
        <h3 className="flex items-center gap-2 font-bold text-fg">
          <FlaskConical aria-hidden="true" className="h-5 w-5" /> Laboratorio
        </h3>
        <p className="text-sm text-fg-muted">Esta función todavía no está activada en la base de datos (falta aplicar la migración 078). Cuando se active podrás crear laboratorios aquí.</p>
      </Card>
    );
  }

  const propose = async () => {
    setProposing(true);
    setProposeError(null);
    try {
      const res = await fetch('/api/lab/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroomId, idea, materialId: materialId || undefined, template }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProposeError(typeof data?.error === 'string' ? data.error : 'No se pudo generar la propuesta. Inténtalo de nuevo.');
        return;
      }
      setEditing({ id: null, spec: data.spec, status: 'draft', sourceMaterialId: data.sourceMaterialId ?? null, warnings: data.warnings ?? [] });
    } catch {
      setProposeError('No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setProposing(false);
    }
  };

  const setStatus = async (item: LabItem, status: 'draft' | 'published') => {
    setBusyId(item.id);
    setNotice(null);
    const { error } = await db
      .from('labs')
      .update({ status, published_at: status === 'published' ? new Date().toISOString() : null })
      .eq('id', item.id);
    setBusyId(null);
    if (error) return setNotice('No se pudo cambiar el estado. Inténtalo de nuevo.');
    upsert({ ...item, status });
    setNotice(status === 'published' ? 'Publicado: los estudiantes de la clase ya pueden abrirlo.' : 'Pasó a borrador: los estudiantes ya no lo ven.');
  };

  const remove = async (item: LabItem) => {
    setBusyId(item.id);
    setNotice(null);
    const { error } = await db.from('labs').delete().eq('id', item.id);
    setBusyId(null);
    setConfirmDelete(null);
    if (error) return setNotice('No se pudo eliminar. Inténtalo de nuevo.');
    setItems((list) => list.filter((i) => i.id !== item.id));
    setNotice('Laboratorio eliminado.');
  };

  if (editing) {
    return (
      <LabEditor
        classroomId={classroomId}
        teacherId={teacherId}
        start={editing}
        onClose={() => setEditing(null)}
        onSaved={(item) => {
          upsert(item);
          setEditing(null);
          setNotice(item.status === 'published' ? 'Publicado: los estudiantes de la clase ya pueden abrirlo.' : 'Borrador guardado.');
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-fg">
          <FlaskConical aria-hidden="true" className="h-5 w-5" /> Laboratorio
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          Experimentos en un ambiente controlado: el estudiante cambia una variable, mide, grafica y concluye. La IA solo propone la ficha del experimento (títulos, rangos y preguntas); tú la revisas antes de publicarla.
        </p>
      </div>

      <Card className="space-y-4 p-4 sm:p-5">
        <h3 className="flex items-center gap-2 font-bold text-fg">
          <Sparkles aria-hidden="true" className="h-4 w-4" /> Nuevo laboratorio con IA
        </h3>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-fg-muted">¿Qué quieres que investiguen? (opcional si eliges un material)</span>
          <textarea className={inputCls} rows={2} maxLength={PROPOSAL_LIMITS.idea} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Ej.: cómo cambia el alcance de un lanzamiento con el ángulo" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-fg-muted">Basarse en un material de la clase</span>
            <select className={inputCls} value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
              <option value="">Ninguno</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-fg-muted">Plantilla</span>
            <select className={inputCls} value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option value="auto">Que la IA elija</option>
              {LAB_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {LAB_AREA_LABEL[t.area]} · {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={propose} loading={proposing} disabled={proposing || (!idea.trim() && !materialId)}>
            Proponer experimento
          </Button>
          <p role="status" aria-live="polite" className={`text-sm ${proposeError ? 'text-danger' : 'text-fg-muted'}`}>
            {proposing ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> La IA está preparando la ficha…
              </span>
            ) : (
              (proposeError ?? 'Podrás ajustarla con una vista previa antes de guardar.')
            )}
          </p>
        </div>
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <h3 className="font-bold text-fg">O empezar desde una plantilla</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {LAB_TEMPLATES.map((t) => (
            <div key={t.id} className="flex flex-col justify-between gap-3 rounded-xl border border-line bg-surface p-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{LAB_AREA_LABEL[t.area]}</p>
                <p className="font-semibold text-fg">{t.name}</p>
                <p className="text-sm text-fg-muted">{t.description}</p>
                <p className="mt-1 text-xs text-fg-muted">
                  <span className="font-semibold text-fg">Ideal para: </span>
                  {t.bestFor}
                </p>
              </div>
              <Button variant="secondary" onClick={() => setEditing({ id: null, spec: defaultSpec(t), status: 'draft', sourceMaterialId: null })}>
                Usar esta plantilla
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <section aria-labelledby="lab-list">
        <h3 id="lab-list" className="mb-2 font-bold text-fg">
          Laboratorios de esta clase
        </h3>
        <p role="status" aria-live="polite" className="mb-2 min-h-[1.25rem] text-sm text-fg-muted">
          {notice}
        </p>
        {items.length === 0 ? (
          <Card className="p-5 text-sm text-fg-muted">Todavía no hay laboratorios. Crea el primero arriba.</Card>
        ) : (
          <ul className="space-y-3">
            {items.map((it) => (
              <li key={it.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-fg [overflow-wrap:anywhere]">{it.title}</p>
                    <p className="text-sm text-fg-muted">
                      {it.areaLabel} · {it.templateName}
                    </p>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${it.status === 'published' ? 'bg-success/15 text-success' : 'bg-surface-2 text-fg-muted'}`}>{STATUS_LABEL[it.status]}</span>
                    {!it.spec && <p className="mt-1 text-xs text-danger">Esta ficha no se puede leer (la plantilla ya no existe). Puedes eliminarla.</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {it.spec && (
                      <>
                        <Button variant="secondary" size="sm" onClick={() => setEditing({ id: it.id, spec: it.spec!, status: it.status, sourceMaterialId: it.sourceMaterialId })} disabled={busyId === it.id}>
                          Editar
                        </Button>
                        <Button variant={it.status === 'published' ? 'ghost' : 'primary'} size="sm" loading={busyId === it.id} onClick={() => setStatus(it, it.status === 'published' ? 'draft' : 'published')}>
                          {it.status === 'published' ? 'Despublicar' : 'Publicar'}
                        </Button>
                      </>
                    )}
                    {confirmDelete === it.id ? (
                      <>
                        <Button variant="danger" size="sm" onClick={() => remove(it)} loading={busyId === it.id}>
                          Sí, eliminar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
                          Cancelar
                        </Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="sm" aria-label={`Eliminar ${it.title}`} onClick={() => setConfirmDelete(it.id)}>
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
