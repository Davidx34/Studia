'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, FlaskConical, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LAB_TEMPLATES } from '@/lib/lab/labTemplates';
import { defaultSpec } from '@/lib/lab/labSpec';
import { MODEL_EXAMPLES, exampleSpec } from '@/lib/lab/modelExamples';
import { DESIGN_LIMITS } from '@/lib/lab/design';
import { STATUS_LABEL, sortItems, type LabItem } from '@/lib/lab/labRows';
import { LAB_AREA_LABEL } from '@/lib/lab/types';
import LabEditor, { type EditorStart } from './LabEditor';

const inputCls =
  'w-full min-h-[44px] rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-base text-fg placeholder:text-fg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// Por que la IA no pudo crear el laboratorio con lo que hay en la memoria de la clase (para mostrarlo con detalle).
interface Gap {
  reason: string;
  message: string;
  missing: string[];
  weak: string[];
}

export default function LabManagerClient({ classroomId, teacherId, initialItems, memoryReady, tableMissing }: { classroomId: string; teacherId: string; initialItems: LabItem[]; memoryReady: boolean; tableMissing: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<LabItem[]>(initialItems);
  const [editing, setEditing] = useState<EditorStart | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Propuesta con IA
  const [idea, setIdea] = useState('');
  const [proposing, setProposing] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [gap, setGap] = useState<Gap | null>(null);

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

  // La IA diseña el laboratorio a partir de la memoria de la clase. `force`: el profesor acepta seguir cuando los materiales cubren solo una parte.
  const propose = async (force = false) => {
    setProposing(true);
    setProposeError(null);
    setGap(null);
    try {
      const res = await fetch('/api/lab/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroomId, idea, force }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data?.error === 'string' ? data.error : 'No se pudo diseñar el laboratorio. Inténtalo de nuevo.';
        // Falta conocimiento en los materiales (o el tema no se puede modelar): se muestra el detalle de lo que falta.
        if (res.status === 422) setGap({ reason: String(data?.reason ?? ''), message: msg, missing: data?.coverage?.missing ?? [], weak: data?.coverage?.weak ?? [] });
        else setProposeError(msg);
        return;
      }
      setEditing({ id: null, spec: data.spec, status: 'draft', sourceMaterialId: data.sourceMaterialId ?? null, warnings: data.warnings ?? [], evidence: data.evidence ?? [] });
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
          Experimentos en un ambiente controlado: el estudiante cambia una variable, mide, grafica y concluye. La IA diseña el modelo a partir de lo que ya enseñaste en tus materiales; tú lo revisas con una vista previa antes de publicarlo.
        </p>
      </div>

      <Card className="space-y-4 p-4 sm:p-5">
        <div>
          <h3 className="flex items-center gap-2 font-bold text-fg">
            <Sparkles aria-hidden="true" className="h-4 w-4" /> Diseñar un laboratorio con IA
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">
            La IA usa la memoria de tu clase (lo que ya enseñaste en tus materiales) para escribir el modelo del experimento: sus variables, sus fórmulas y su gráfica. Si lo que cargaste no alcanza para crearlo, te dice qué falta en vez de inventarlo.
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-fg-muted">¿Qué quieres que investiguen?</span>
          <textarea
            className={inputCls}
            rows={3}
            maxLength={DESIGN_LIMITS.idea}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            disabled={!memoryReady}
            placeholder="Ej.: cómo elige un consumidor cuánto comprar de cada bien para obtener la mayor utilidad con su presupuesto"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => propose(false)} loading={proposing} disabled={proposing || !memoryReady || idea.trim().length < 10}>
            Diseñar experimento
          </Button>
          <p role="status" aria-live="polite" className={`text-sm ${proposeError ? 'text-danger' : 'text-fg-muted'}`}>
            {proposing ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> La IA está diseñando y probando el modelo… puede tardar un minuto.
              </span>
            ) : !memoryReady ? (
              'Primero construye la memoria de la clase (arriba): así la IA conoce tus materiales.'
            ) : (
              (proposeError ?? 'Podrás ajustarlo con una vista previa antes de guardar.')
            )}
          </p>
        </div>

        {gap && (
          <div role="alert" className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-fg">
            <p className="flex items-start gap-2 font-semibold">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /> {gap.message}
            </p>
            {gap.missing.length > 0 && (
              <div>
                <p className="font-semibold">Falta en tus materiales:</p>
                <ul className="list-disc pl-6 text-fg-muted">
                  {gap.missing.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            {gap.weak.length > 0 && (
              <div>
                <p className="font-semibold">Está, pero flojo:</p>
                <ul className="list-disc pl-6 text-fg-muted">
                  {gap.weak.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            {gap.reason === 'partial' && (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button variant="secondary" size="sm" onClick={() => propose(true)} disabled={proposing}>
                  Crear de todos modos
                </Button>
                <span className="text-fg-muted">La IA lo creará con lo que hay y te avisará; revísalo con cuidado.</span>
              </div>
            )}
          </div>
        )}
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

      <Card className="space-y-3 p-4 sm:p-5">
        <div>
          <h3 className="font-bold text-fg">Modelos a la medida (ejemplos)</h3>
          <p className="mt-1 text-sm text-fg-muted">A diferencia de las plantillas, aquí las fórmulas del experimento están escritas como datos: se adaptan a cualquier materia numérica. Parte de un ejemplo y ajústalo.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {MODEL_EXAMPLES.map((e) => {
            const spec = exampleSpec(e);
            return (
              <div key={e.id} className="flex flex-col justify-between gap-3 rounded-xl border border-line bg-surface p-3">
                <p className="text-sm font-semibold text-fg">{e.title}</p>
                <Button variant="secondary" disabled={!spec} onClick={() => spec && setEditing({ id: null, spec, status: 'draft', sourceMaterialId: null })}>
                  Usar este ejemplo
                </Button>
              </div>
            );
          })}
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
