'use client';

// Plan del curso "hacia atras": el profesor escribe un borrador, la IA lo desarrolla (comprension final -> evaluacion de cada corte -> objetivos -> modulos), el profesor lo REVISA y lo
// edita, y recien entonces lo guarda y lo publica. La IA nunca guarda ni publica por si sola. Las reglas se comprueban en vivo (checkBlueprint, el mismo codigo que usa el servidor);
// el servidor vuelve a validar todo al guardar y al publicar.

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ListChecks, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { parseBlueprint } from '@/lib/blueprint/parse';
import { checkBlueprint, isPublishable } from '@/lib/blueprint/validate';
import {
  addModule, addObjective, addOutcome, addPeriod, blankFields, emptyBlueprint, equalizeWeights, removeModule, removeObjective, removeOutcome, removePeriod, setModuleTitle,
  setObjectiveTitle, setOutcomeText, setPeriod, toggleAssessed, toggleObjectiveOutcome,
} from '@/lib/blueprint/edit';
import { BLUEPRINT_LIMITS as L, type Blueprint, type Issue } from '@/lib/blueprint/types';
import type { Link as PlanLink, RealModule } from '@/lib/blueprint/links';
import LinksPanel from './LinksPanel';
import { call } from './planApi';

export interface StoredPlan {
  version: number;
  doc: unknown;
  publishedAt: string | null;
}

const INPUT = 'w-full min-h-[44px] rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-base text-fg placeholder:text-fg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const read = (doc: unknown): Blueprint | null => {
  const r = parseBlueprint(doc);
  return r.ok ? r.blueprint : null;
};

export default function PlanClient({ classroomId, className, draft, published: publishedInit, tableMissing, modules, draftLinks: draftLinksInit, publishedLinks: publishedLinksInit }: { classroomId: string; className: string; draft: StoredPlan | null; published: StoredPlan | null; tableMissing: boolean; modules: RealModule[]; draftLinks: PlanLink[]; publishedLinks: PlanLink[] }) {
  const initial = draft ? read(draft.doc) : null;
  // El plan publicado vive en el estado: al publicar uno nuevo, "editar una copia" debe partir de ESE y no del que llego con la pagina.
  const [published, setPublished] = useState<StoredPlan | null>(publishedInit);
  // Los enlaces guardados de cada version; viven aqui para no perderse al editar y volver a mostrar el panel.
  const [draftLinks, setDraftLinks] = useState<PlanLink[]>(draftLinksInit);
  const [publishedLinks, setPublishedLinks] = useState<PlanLink[]>(publishedLinksInit);
  const [plan, setPlan] = useState<Blueprint | null>(initial);
  const [savedVersion, setSavedVersion] = useState<number | null>(draft && initial ? draft.version : null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | 'generate' | 'save' | 'publish'>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string; list?: string[] } | null>(draft && !initial ? { tone: 'error', text: 'El borrador guardado no se pudo leer. Empieza uno nuevo.' } : null);
  const [confirmPublish, setConfirmPublish] = useState(false);

  // Borrador del curso (para la IA).
  const [title, setTitle] = useState(className);
  const [description, setDescription] = useState('');
  const [periods, setPeriods] = useState(3);
  const [outcomesText, setOutcomesText] = useState('');

  const issues: Issue[] = useMemo(() => (plan ? checkBlueprint(plan) : []), [plan]);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const publishedPlan = useMemo(() => (published ? read(published.doc) : null), [published]);
  const blanks = useMemo(() => (plan ? blankFields(plan) : []), [plan]);
  const publishable = plan !== null && isPublishable(issues) && blanks.length === 0;
  const weightTotal = plan ? Math.round(plan.periods.reduce((s, p) => s + p.weight, 0) * 100) / 100 : 0;

  const edit = (f: (b: Blueprint) => Blueprint) => {
    setPlan((p) => (p ? f(p) : p));
    setDirty(true);
    setConfirmPublish(false);
    setNotice(null);
  };

  const generate = async () => {
    setBusy('generate');
    setNotice(null);
    const outcomes = outcomesText.split('\n').map((s) => s.trim()).filter(Boolean);
    const r = await call({ action: 'generate', classroomId, brief: { title, description, periods, ...(outcomes.length ? { outcomes } : {}) } });
    setBusy(null);
    if (!r.ok) {
      setNotice({ tone: 'error', text: r.data?.error ?? 'No se pudo desarrollar el plan.', list: Array.isArray(r.data?.errors) ? r.data.errors : undefined });
      return;
    }
    const bp = read(r.data.blueprint);
    if (!bp) {
      setNotice({ tone: 'error', text: 'La IA devolvio un plan que no se pudo leer. Intenta de nuevo.' });
      return;
    }
    setPlan(bp);
    setDirty(true);
    setNotice({ tone: 'ok', text: 'Plan desarrollado por la IA. Es un BORRADOR sin guardar: revisalo, corrige lo que haga falta y guardalo.' });
  };

  const save = async () => {
    if (!plan) return;
    setBusy('save');
    setNotice(null);
    const r = await call({ action: 'save', classroomId, blueprint: plan });
    setBusy(null);
    if (!r.ok) {
      setNotice({ tone: 'error', text: r.data?.error ?? 'No se pudo guardar.', list: Array.isArray(r.data?.errors) ? r.data.errors : undefined });
      return;
    }
    setSavedVersion(r.data.version);
    setDirty(false);
    setNotice({ tone: 'ok', text: r.data.publishable ? 'Borrador guardado. Ya cumple las reglas: puedes publicarlo.' : 'Borrador guardado. Todavia le faltan cosas para poder publicarlo (abajo).' });
  };

  const publish = async () => {
    setBusy('publish');
    setNotice(null);
    const r = await call({ action: 'publish', classroomId });
    setBusy(null);
    setConfirmPublish(false);
    if (!r.ok) {
      setNotice({ tone: 'error', text: r.data?.error ?? 'No se pudo publicar.', list: Array.isArray(r.data?.issues) ? (r.data.issues as Issue[]).filter((i) => i.severity === 'error').map((i) => i.message) : undefined });
      return;
    }
    setPublished({ version: r.data.version, doc: plan, publishedAt: new Date().toISOString() });
    setPublishedLinks(draftLinks); // es la MISMA fila: al publicarse, sus enlaces se quedan con ella
    setDraftLinks([]);
    setSavedVersion(null);
    setDirty(false);
    setPlan(null);
    setNotice({ tone: 'ok', text: `Plan version ${r.data.version} publicado.` });
  };

  const startFromPublished = () => {
    const bp = published ? read(published.doc) : null;
    if (!bp) return;
    setPlan(bp);
    setDraftLinks([]);
    setDirty(true);
    setNotice({ tone: 'ok', text: 'Editando una copia del plan publicado. Al guardar se crea una version nueva; el publicado no cambia hasta que publiques la nueva.' });
  };

  if (tableMissing) {
    return (
      <Card className="p-5">
        <p className="font-semibold text-fg">El plan por cortes todavia no esta disponible.</p>
        <p className="mt-1 text-sm text-fg-muted">Falta aplicar la migracion 085 en la base de datos.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <ListChecks aria-hidden="true" className="h-6 w-6 text-primary-text" />
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-fg">Plan del curso</h2>
          <p className="text-sm text-fg-muted">
            {published ? `Plan publicado: version ${published.version}.` : 'Todavia no hay un plan publicado.'}
            {savedVersion ? ` Borrador guardado: version ${savedVersion}.` : ''}
          </p>
        </div>
        {(published || savedVersion) && (
          <Link href={`/teacher/classrooms/${classroomId}/plan/examen`} className="ml-auto inline-flex min-h-[44px] items-center text-sm font-semibold text-primary-text underline underline-offset-2">
            Preguntas de examen
          </Link>
        )}
      </header>

      <Card className="border-line-strong p-4 text-sm text-fg-muted">
        <p>
          Aqui defines el curso <strong className="text-fg">de adelante hacia atras</strong>: primero lo que el estudiante debe comprender al final, luego que evalua cada corte, y de ahi salen los objetivos y los modulos. La IA puede proponer
          el plan completo; tu lo revisas y decides.
        </p>
        <p className="mt-2">
          <strong className="text-fg">Importante:</strong> publicar el plan todavia <strong className="text-fg">no cambia lo que ven tus estudiantes</strong>. Es el primer paso; las evaluaciones y el avance por cortes se conectaran despues.
        </p>
      </Card>

      {notice && (
        <div role={notice.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${notice.tone === 'error' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-success/40 bg-success/10 text-success'}`}>
          <p className="font-semibold">{notice.text}</p>
          {notice.list && (
            <ul className="mt-1 list-disc pl-5">
              {notice.list.map((m, i) => (
                <li key={i} className="[overflow-wrap:anywhere]">
                  {m}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!plan && (
        <Card className="space-y-4 p-4 sm:p-5">
          <h3 className="text-lg font-semibold text-fg">Borrador del curso</h3>
          {published && (
            <div className="rounded-xl border border-line bg-surface-2 p-3 text-sm text-fg-muted">
              Ya hay un plan publicado (version {published.version}).{' '}
              <Button size="sm" variant="secondary" onClick={startFromPublished} className="ml-1">
                Editar una copia
              </Button>
            </div>
          )}
          <Field label="Nombre del curso" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          <div>
            <label htmlFor="plan-desc" className="mb-2 block text-sm font-medium text-fg-muted">
              De que trata (opcional)
            </label>
            <textarea id="plan-desc" rows={3} maxLength={1500} value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT} placeholder="Temas, nivel de los estudiantes, enfoque..." />
          </div>
          <div className="max-w-[12rem]">
            <label htmlFor="plan-periods" className="mb-2 block text-sm font-medium text-fg-muted">
              Cantidad de cortes
            </label>
            <input id="plan-periods" type="number" inputMode="numeric" min={1} max={L.periods} value={periods} onChange={(e) => setPeriods(Math.max(1, Math.min(L.periods, Math.round(Number(e.target.value) || 1))))} className={INPUT} />
          </div>
          <div>
            <label htmlFor="plan-outcomes" className="mb-2 block text-sm font-medium text-fg-muted">
              Que debe comprender el estudiante al final (opcional, una por linea)
            </label>
            <textarea id="plan-outcomes" rows={4} value={outcomesText} onChange={(e) => setOutcomesText(e.target.value)} className={INPUT} placeholder={'Si no las escribes, la IA las propone.\nExplica la elasticidad de la demanda\nCalcula el equilibrio de mercado'} />
          </div>
          <p className="text-sm text-fg-muted">Los cortes pesan lo mismo al principio; los ajustas despues. La IA no decide cuantos cortes hay ni cuanto pesa cada uno.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={generate} loading={busy === 'generate'} disabled={!title.trim() || busy !== null}>
              {busy === 'generate' ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Sparkles aria-hidden="true" className="h-4 w-4" />}
              {busy === 'generate' ? 'Desarrollando...' : 'Desarrollar con IA'}
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => {
                setPlan(emptyBlueprint());
                setDirty(true);
                setNotice(null);
              }}
            >
              Empezar en blanco
            </Button>
          </div>
          {busy === 'generate' && <p className="text-sm text-fg-muted">La IA hace una llamada por corte; puede tardar un minuto.</p>}
        </Card>
      )}

      {!plan && publishedPlan && (
        <LinksPanel key={`pub-${published!.version}`} classroomId={classroomId} plan={publishedPlan} modules={modules} initialLinks={publishedLinks} target="published" onSaved={setPublishedLinks} />
      )}

      {plan && (
        <>
          <Card className="space-y-3 p-4 sm:p-5">
            <h3 className="text-lg font-semibold text-fg">Lo que debe comprender el estudiante al final</h3>
            <p className="text-sm text-fg-muted">La evaluacion final del curso comprueba todas estas comprensiones.</p>
            <ul className="space-y-2">
              {plan.outcomes.map((o, i) => (
                <li key={o.id} className="flex items-start gap-2">
                  <textarea aria-label={`Comprension final ${i + 1}`} rows={2} maxLength={L.statement} value={o.statement} onChange={(e) => edit((b) => setOutcomeText(b, o.id, e.target.value))} className={INPUT} />
                  <Button size="sm" variant="ghost" aria-label={`Quitar la comprension ${i + 1}`} onClick={() => edit((b) => removeOutcome(b, o.id))}>
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="secondary" disabled={plan.outcomes.length >= L.outcomes} onClick={() => edit(addOutcome)}>
              <Plus aria-hidden="true" className="h-4 w-4" /> Agregar comprension
            </Button>
          </Card>

          <section aria-label="Cortes" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-fg">Cortes</h3>
              <p className={`text-sm font-semibold ${Math.round(weightTotal * 100) === 10000 ? 'text-success' : 'text-danger'}`}>Los cortes suman {weightTotal} % (deben sumar 100)</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => edit(equalizeWeights)}>
                Repartir el peso por igual
              </Button>
              <Button size="sm" variant="secondary" disabled={plan.periods.length >= L.periods} onClick={() => edit(addPeriod)}>
                <Plus aria-hidden="true" className="h-4 w-4" /> Agregar corte
              </Button>
            </div>

            {plan.periods.map((p, pi) => (
              <Card key={p.id} className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[10rem] flex-1">
                    <label htmlFor={`pn-${p.id}`} className="mb-1 block text-sm font-medium text-fg-muted">
                      Corte {pi + 1}
                    </label>
                    <input id={`pn-${p.id}`} maxLength={L.title} value={p.name} onChange={(e) => edit((b) => setPeriod(b, p.id, { name: e.target.value }))} className={INPUT} />
                  </div>
                  <div className="w-28">
                    <label htmlFor={`pw-${p.id}`} className="mb-1 block text-sm font-medium text-fg-muted">
                      Peso (%)
                    </label>
                    <input id={`pw-${p.id}`} type="number" inputMode="decimal" min={0} max={100} step="0.01" value={p.weight} onChange={(e) => edit((b) => setPeriod(b, p.id, { weight: Number(e.target.value) || 0 }))} className={INPUT} />
                  </div>
                  <Button size="sm" variant="ghost" aria-label={`Quitar el corte ${pi + 1}`} onClick={() => edit((b) => removePeriod(b, p.id))}>
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </div>

                <fieldset>
                  <legend className="mb-1 text-sm font-medium text-fg-muted">La evaluacion de este corte comprueba:</legend>
                  <div className="space-y-1">
                    {plan.outcomes.map((o, oi) => (
                      <label key={o.id} className="flex min-h-[32px] cursor-pointer items-start gap-2 text-sm text-fg">
                        <input type="checkbox" className="mt-1 h-4 w-4" checked={p.assessesOutcomeIds.includes(o.id)} onChange={() => edit((b) => toggleAssessed(b, p.id, o.id))} />
                        <span className="[overflow-wrap:anywhere]">{o.statement || `Comprension ${oi + 1} (sin texto)`}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-fg">Objetivos del corte</h4>
                  {p.objectives.length === 0 && <p className="text-sm text-fg-muted">Este corte todavia no tiene objetivos.</p>}
                  {p.objectives.map((ob, oi) => (
                    <div key={ob.id} className="space-y-3 rounded-xl border border-line bg-surface-2 p-3">
                      <div className="flex items-start gap-2">
                        <input aria-label={`Objetivo ${oi + 1} del corte ${pi + 1}`} maxLength={L.title} value={ob.title} onChange={(e) => edit((b) => setObjectiveTitle(b, ob.id, e.target.value))} className={INPUT} />
                        <Button size="sm" variant="ghost" aria-label={`Quitar el objetivo ${oi + 1} del corte ${pi + 1}`} onClick={() => edit((b) => removeObjective(b, ob.id))}>
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                        </Button>
                      </div>
                      <fieldset>
                        <legend className="mb-1 text-xs font-medium text-fg-muted">Este objetivo contribuye a:</legend>
                        {p.assessesOutcomeIds.length === 0 && <p className="text-xs text-fg-muted">Primero elige que comprueba el corte.</p>}
                        <div className="space-y-1">
                          {plan.outcomes
                            .filter((o) => p.assessesOutcomeIds.includes(o.id))
                            .map((o, k) => (
                              <label key={o.id} className="flex min-h-[28px] cursor-pointer items-start gap-2 text-sm text-fg">
                                <input type="checkbox" className="mt-1 h-4 w-4" checked={ob.outcomeIds.includes(o.id)} onChange={() => edit((b) => toggleObjectiveOutcome(b, ob.id, o.id))} />
                                <span className="[overflow-wrap:anywhere]">{o.statement || `Comprension ${k + 1} (sin texto)`}</span>
                              </label>
                            ))}
                        </div>
                      </fieldset>
                      <div>
                        <p className="mb-1 text-xs font-medium text-fg-muted">Modulos</p>
                        <ul className="space-y-2">
                          {ob.modules.map((m, mi) => (
                            <li key={m.id} className="flex items-start gap-2">
                              <input aria-label={`Modulo ${mi + 1} del objetivo ${oi + 1} del corte ${pi + 1}`} maxLength={L.title} value={m.title} onChange={(e) => edit((b) => setModuleTitle(b, m.id, e.target.value))} className={INPUT} />
                              <Button size="sm" variant="ghost" aria-label={`Quitar el modulo ${mi + 1} del objetivo ${oi + 1} del corte ${pi + 1}`} onClick={() => edit((b) => removeModule(b, m.id))}>
                                <Trash2 aria-hidden="true" className="h-4 w-4" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                        <Button size="sm" variant="ghost" className="mt-1" disabled={ob.modules.length >= L.modulesPerObjective} onClick={() => edit((b) => addModule(b, ob.id))}>
                          <Plus aria-hidden="true" className="h-4 w-4" /> Agregar modulo
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button size="sm" variant="secondary" disabled={p.objectives.length >= L.objectivesPerPeriod} onClick={() => edit((b) => addObjective(b, p.id))}>
                    <Plus aria-hidden="true" className="h-4 w-4" /> Agregar objetivo
                  </Button>
                </div>
              </Card>
            ))}
          </section>

          <Card className="space-y-3 p-4 sm:p-5">
            <h3 className="text-lg font-semibold text-fg">Revision</h3>
            {issues.length === 0 && blanks.length === 0 ? (
              <p className="text-sm font-semibold text-success">El plan cumple todas las reglas.</p>
            ) : (
              <>
                {errors.length + blanks.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-danger">Falta arreglar ({errors.length + blanks.length}) para poder publicar:</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-fg">
                      {blanks.map((m, k) => (
                        <li key={`b${k}`} className="[overflow-wrap:anywhere]">
                          {m}
                        </li>
                      ))}
                      {errors.map((i, k) => (
                        <li key={k} className="[overflow-wrap:anywhere]">
                          {i.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {warnings.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-fg">Avisos ({warnings.length}):</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-fg-muted">
                      {warnings.map((i, k) => (
                        <li key={k} className="[overflow-wrap:anywhere]">
                          {i.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button onClick={save} loading={busy === 'save'} disabled={busy !== null || !dirty || blanks.length > 0}>
                {dirty ? 'Guardar borrador' : 'Guardado'}
              </Button>
              {!confirmPublish ? (
                <Button variant="accent" disabled={busy !== null || dirty || savedVersion === null || !publishable} onClick={() => setConfirmPublish(true)}>
                  Publicar
                </Button>
              ) : (
                <>
                  <Button variant="accent" loading={busy === 'publish'} disabled={busy !== null} onClick={publish}>
                    Si, publicar la version {savedVersion}
                  </Button>
                  <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirmPublish(false)}>
                    Cancelar
                  </Button>
                </>
              )}
              {!confirmPublish && blanks.length > 0 && <span className="text-sm text-fg-muted">Completa los textos vacios para poder guardar.</span>}
              {!confirmPublish && blanks.length === 0 && (dirty || savedVersion === null) && <span className="text-sm text-fg-muted">Guarda el borrador para poder publicarlo.</span>}
              {!confirmPublish && blanks.length === 0 && !dirty && savedVersion !== null && !publishable && <span className="text-sm text-fg-muted">Arregla lo marcado arriba para poder publicar.</span>}
            </div>
            {confirmPublish && published !== null && <p className="text-sm text-fg-muted">La version {published.version} que esta publicada pasara a archivada.</p>}
          </Card>

          {dirty || savedVersion === null ? (
            <Card className="p-4 text-sm text-fg-muted sm:p-5">Guarda el borrador para poder enlazar sus modulos con los modulos de la clase.</Card>
          ) : (
            <LinksPanel key={`draft-${savedVersion}`} classroomId={classroomId} plan={plan} modules={modules} initialLinks={draftLinks} target="draft" onSaved={setDraftLinks} />
          )}
        </>
      )}
    </div>
  );
}
