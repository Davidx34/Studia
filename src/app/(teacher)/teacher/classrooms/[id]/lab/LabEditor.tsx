'use client';

// Editor de la ficha del experimento. El profesor ajusta TEXTOS y VALORES (nunca codigo); lo que se previsualiza y se guarda es siempre la ficha validada y recortada a los
// limites de la plantilla. La vista previa es el laboratorio real, en su iframe aislado.

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LabFrame } from '@/components/lab/LabFrame';
import { LIMITS, templateOfSpec } from '@/lib/lab/labSpec';
import { cleanQuestions, effectiveVariable, limitHint, normalizeDraft, questionError, withConstant, withIndependent, withMode, withVariable } from '@/lib/lab/labEditor';
import { rowToItem, specToFields, type LabItem, type LabRow, type LabStatus } from '@/lib/lab/labRows';
import type { Evidence } from '@/lib/lab/design';
import { KIND_LABEL } from '@/lib/memory/types';
import type { LabSpec, LabVariableOverride } from '@/lib/lab/types';

const inputCls =
  'w-full min-h-[44px] rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-base text-fg placeholder:text-fg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// Campo numerico: se escribe libremente y se confirma al salir; si no es un numero, vuelve al valor anterior.
function NumField({ label, value, onCommit, hint, decimals = 2 }: { label: string; value: number; onCommit: (n: number) => number | void; hint?: string; decimals?: number }) {
  const show = (n: number) => String(Number(n.toFixed(decimals)));
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-fg-muted">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text.replace(',', '.'));
          if (text.trim() !== '' && Number.isFinite(n)) {
            // El campo muestra el valor ya recortado a los limites de la plantilla (aunque la ficha no cambie, el texto escrito se corrige).
            const eff = onCommit(n);
            setText(show(typeof eff === 'number' ? eff : n));
          } else setText(show(value));
        }}
        className={inputCls}
      />
      {hint && <span className="mt-1 block text-xs text-fg-muted">{hint}</span>}
    </label>
  );
}

export interface EditorStart {
  id: string | null;
  spec: LabSpec;
  status: LabStatus;
  sourceMaterialId: string | null;
  // Avisos de la propuesta de la IA (lo que se ajusto a los limites).
  warnings?: string[];
  // Los conceptos de la memoria de la clase en los que se apoya el modelo (si lo diseño la IA).
  evidence?: Evidence[];
}

export default function LabEditor({ classroomId, teacherId, start, onClose, onSaved }: { classroomId: string; teacherId: string; start: EditorStart; onClose: () => void; onSaved: (item: LabItem) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [draft, setDraft] = useState<LabSpec>(start.spec);
  const [questions, setQuestions] = useState<string[]>(start.spec.questions.length ? start.spec.questions : ['']);
  const [busy, setBusy] = useState<'draft' | 'publish' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tpl = templateOfSpec(draft);
  const full = useMemo(() => normalizeDraft({ ...draft, questions: cleanQuestions(questions) }), [draft, questions]);

  // La vista previa se recarga con una pausa: el laboratorio recibe su estado una vez al abrirse.
  const [preview, setPreview] = useState(full);
  const [previewKey, setPreviewKey] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      setPreview(full);
      setPreviewKey((k) => k + 1);
    }, 700);
    return () => clearTimeout(t);
  }, [full]);

  if (!tpl) return null;
  const set = (patch: Partial<LabSpec>) => setDraft((d) => ({ ...d, ...patch }));
  // Cada confirmacion aplica el cambio y devuelve el valor ya recortado, para que el campo no se quede mostrando lo que se escribio.
  const commitVar = (patch: LabVariableOverride, id: string, key: 'min' | 'max' | 'default') => {
    const next = withVariable(draft, id, patch);
    setDraft(next);
    return effectiveVariable(next, id)?.[key];
  };
  const commitConst = (id: string, n: number) => {
    const next = withConstant(draft, id, n);
    setDraft(next);
    return normalizeDraft(next)?.lab.constants.find((c) => c.id === id)?.value;
  };
  const commitTrials = (n: number) => {
    const next = { ...draft, minTrials: Math.round(n) };
    setDraft(next);
    return normalizeDraft(next)?.spec.minTrials;
  };
  const qErrors = questions.map(questionError);
  const hasQError = qErrors.some(Boolean);
  const warnings = [...(start.warnings ?? []), ...(full?.warnings ?? [])];

  const save = async (status: LabStatus) => {
    if (!full || hasQError) return;
    setBusy(status === 'published' ? 'publish' : 'draft');
    setError(null);
    const fields = specToFields(full.spec);
    const now = new Date().toISOString();
    const payload = {
      ...fields,
      source_material_id: start.sourceMaterialId,
      status,
      published_at: status === 'published' ? now : null,
    };
    // La tabla nueva aun no esta en los tipos generados de la base.
    const db: any = supabase;
    const res = start.id
      ? await db.from('labs').update(payload).eq('id', start.id).select('*').single()
      : await db.from('labs').insert({ ...payload, classroom_id: classroomId, teacher_id: teacherId }).select('*').single();
    setBusy(null);
    if (res.error || !res.data) {
      setError('No se pudo guardar el laboratorio. Revisa tu conexión e inténtalo de nuevo.');
      return;
    }
    onSaved(rowToItem(res.data as LabRow));
  };

  const independentId = full?.spec.independent ?? draft.independent;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-fg">{start.id ? 'Editar laboratorio' : 'Nuevo laboratorio'}</h3>
          <p className="text-sm text-fg-muted">
            Plantilla: <span className="font-semibold text-fg">{tpl.name}</span> · {tpl.concept}
          </p>
        </div>
        <Button variant="ghost" onClick={onClose} disabled={busy !== null}>
          Volver a la lista
        </Button>
      </div>

      {warnings.length > 0 && (
        <div role="status" className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-fg">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle aria-hidden="true" className="h-4 w-4" /> Revisa esto antes de publicar
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-6 text-fg-muted">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {(start.evidence?.length ?? 0) > 0 && (
        <Card className="space-y-2 p-4">
          <h4 className="font-bold text-fg">Se apoya en lo que enseñaste</h4>
          <p className="text-xs text-fg-muted">Estos son los conceptos de tus materiales que usó la IA. Compara las fórmulas del modelo (abajo) con las de tus apuntes antes de publicar.</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {(start.evidence ?? []).map((e) => (
              <li key={e.key} className="rounded-lg border border-line bg-surface p-2.5 text-sm">
                <p className="font-semibold text-fg [overflow-wrap:anywhere]">
                  {e.name} <span className="font-normal text-fg-muted">· {KIND_LABEL[e.kind]}</span>
                </p>
                {e.definition && <p className="text-fg-muted [overflow-wrap:anywhere]">{e.definition}</p>}
                {e.formula && <p className="mt-0.5 font-mono text-xs text-fg [overflow-wrap:anywhere]">{e.formula}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <h4 className="font-bold text-fg">El experimento</h4>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-fg-muted">Título</span>
              <input className={inputCls} value={draft.title} maxLength={LIMITS.title} onChange={(e) => set({ title: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-fg-muted">Pregunta de investigación</span>
              <textarea className={inputCls} rows={2} value={draft.objective} maxLength={LIMITS.objective} onChange={(e) => set({ objective: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-fg-muted">Escenario (opcional)</span>
              <textarea className={inputCls} rows={2} value={draft.context} maxLength={LIMITS.context} onChange={(e) => set({ context: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-fg-muted">Pregunta de la hipótesis</span>
              <input className={inputCls} value={draft.hypothesisPrompt} maxLength={LIMITS.hypothesisPrompt} onChange={(e) => set({ hypothesisPrompt: e.target.value })} />
            </label>
          </Card>

          <Card className="space-y-3 p-4">
            <h4 className="font-bold text-fg">Variables y ambiente controlado</h4>
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-fg-muted">Modo</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ['controlado', 'Controlado', 'Solo se mueve la variable independiente; las demás quedan fijas.'],
                    ['libre', 'Libre', 'El estudiante puede mover todas las variables.'],
                  ] as const
                ).map(([id, name, desc]) => (
                  <label key={id} className={`flex min-h-[44px] cursor-pointer items-start gap-2 rounded-xl border-2 p-3 ${draft.mode === id ? 'border-primary bg-primary/5' : 'border-line'}`}>
                    <input type="radio" name="lab-mode" className="mt-1 accent-primary" checked={draft.mode === id} onChange={() => setDraft((d) => withMode(d, id))} />
                    <span>
                      <span className="block text-sm font-semibold text-fg">{name}</span>
                      <span className="block text-xs text-fg-muted">{desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-fg-muted">Variable independiente (la que mueve el estudiante)</span>
              <select className={inputCls} value={independentId} onChange={(e) => setDraft((d) => withIndependent(d, e.target.value))}>
                {tpl.variables.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-3">
              {tpl.variables.map((v) => {
                const eff = effectiveVariable(draft, v.id) ?? { min: v.min, max: v.max, default: v.default };
                const isInd = v.id === independentId;
                const showRange = isInd || draft.mode === 'libre';
                return (
                  <div key={v.id} className="rounded-xl border border-line p-3">
                    <p className="mb-2 text-sm font-semibold text-fg">
                      {v.label}
                      {v.unit && <span className="font-normal text-fg-muted"> ({v.unit})</span>}
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${isInd ? 'bg-primary/10 text-primary-text' : 'bg-surface-2 text-fg-muted'}`}>
                        {isInd ? 'independiente' : draft.mode === 'controlado' ? 'controlada (fija)' : 'libre'}
                      </span>
                    </p>
                    <div className={`grid gap-2 ${showRange ? 'grid-cols-3' : 'grid-cols-1 sm:max-w-[10rem]'}`}>
                      {showRange && <NumField label="Mínimo" value={eff.min} decimals={v.decimals + 1} onCommit={(n) => commitVar({ min: n }, v.id, 'min')} />}
                      <NumField label={isInd ? 'Valor inicial' : 'Valor fijo'} value={eff.default} decimals={v.decimals + 1} onCommit={(n) => commitVar({ default: n }, v.id, 'default')} />
                      {showRange && <NumField label="Máximo" value={eff.max} decimals={v.decimals + 1} onCommit={(n) => commitVar({ max: n }, v.id, 'max')} />}
                    </div>
                    <p className="mt-1 text-xs text-fg-muted">{limitHint(draft, v.id)}</p>
                  </div>
                );
              })}
            </div>

            {tpl.constants.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-semibold text-fg">Constantes del ambiente</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {tpl.constants.map((c) => (
                    <NumField
                      key={c.id}
                      label={`${c.label}${c.unit ? ` (${c.unit})` : ''}`}
                      value={draft.constants[c.id] ?? c.value}
                      decimals={c.decimals + 1}
                      hint={`De ${c.min} a ${c.max}`}
                      onCommit={(n) => commitConst(c.id, n)}
                    />
                  ))}
                </div>
              </div>
            )}
          </Card>

          {draft.model && (
            <Card className="space-y-2 p-4">
              <h4 className="font-bold text-fg">Fórmulas del modelo</h4>
              <p className="text-xs text-fg-muted">Solo lectura. Si algo no coincide con tus apuntes, no lo publiques y pide otro diseño.</p>
              <ul className="space-y-1 font-mono text-xs text-fg">
                {[...draft.model.derived, ...draft.model.outputs].map((f) => (
                  <li key={f.id} className="[overflow-wrap:anywhere]">
                    <span className="text-fg-muted">{f.id} =</span> {f.expr}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="space-y-3 p-4">
            <h4 className="font-bold text-fg">Informe del estudiante</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumField label="Ensayos mínimos" value={draft.minTrials} decimals={0} hint={`De ${LIMITS.minTrials.min} a ${LIMITS.minTrials.max}`} onCommit={(n) => commitTrials(n)} />
              <label className="flex min-h-[44px] cursor-pointer items-start gap-2 self-end rounded-xl border border-line p-3">
                <input type="checkbox" className="mt-1 h-5 w-5 accent-primary" checked={draft.showModelCurve} onChange={(e) => set({ showModelCurve: e.target.checked })} />
                <span>
                  <span className="block text-sm font-semibold text-fg">Mostrar la curva teórica</span>
                  <span className="block text-xs text-fg-muted">Apagado: el estudiante descubre la relación con sus datos.</span>
                </span>
              </label>
            </div>

            <div>
              <p className="mb-1 text-sm font-medium text-fg-muted">Preguntas guía (se responden con los datos medidos)</p>
              <ul className="space-y-2">
                {questions.map((q, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <textarea
                        aria-label={`Pregunta ${i + 1}`}
                        className={inputCls}
                        rows={2}
                        value={q}
                        maxLength={LIMITS.question + 40}
                        onChange={(e) => setQuestions((qs) => qs.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                      {qErrors[i] && (
                        <p role="alert" className="mt-1 text-xs text-danger">
                          {qErrors[i]}
                        </p>
                      )}
                    </div>
                    <Button variant="ghost" aria-label={`Quitar la pregunta ${i + 1}`} onClick={() => setQuestions((qs) => (qs.length > 1 ? qs.filter((_, j) => j !== i) : ['']))}>
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
              {questions.length < LIMITS.maxQuestions && (
                <Button variant="secondary" size="sm" className="mt-2" onClick={() => setQuestions((qs) => [...qs, ''])}>
                  <Plus aria-hidden="true" className="h-4 w-4" /> Añadir pregunta
                </Button>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-2 xl:sticky xl:top-4 xl:self-start">
          <h4 className="font-bold text-fg">Así lo verá el estudiante</h4>
          <p className="text-xs text-fg-muted">Puedes probarlo: lo que hagas aquí no se guarda. Se actualiza al dejar de escribir.</p>
          {preview ? <LabFrame key={previewKey} lab={preview.lab} /> : <p className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-fg">La ficha no es válida todavía.</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button variant="secondary" onClick={() => save('draft')} loading={busy === 'draft'} disabled={!full || hasQError || busy !== null}>
          Guardar borrador
        </Button>
        <Button onClick={() => save('published')} loading={busy === 'publish'} disabled={!full || hasQError || busy !== null}>
          {start.status === 'published' ? 'Guardar y mantener publicado' : 'Publicar para la clase'}
        </Button>
        <p role="status" aria-live="polite" className={`text-sm ${error || hasQError ? 'text-danger' : 'text-fg-muted'}`}>
          {error ?? (hasQError ? 'Corrige las preguntas marcadas para poder guardar.' : 'Un borrador no lo ve ningún estudiante.')}
        </p>
      </div>
    </div>
  );
}
