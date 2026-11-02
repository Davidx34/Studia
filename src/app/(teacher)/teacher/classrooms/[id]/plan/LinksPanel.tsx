'use client';

// Enlazar los modulos del PLAN con los modulos REALES de la clase (migracion 087). Es aditivo: no crea ni cambia modulos reales, solo los asocia. Las sugerencias (por parecido de
// titulo) se APLICAN a la lista para que el profesor las revise; nada se guarda hasta pulsar "Guardar enlaces".

import { useMemo, useState } from 'react';
import { Link2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { applySuggestions, coverage, planModules, relevantLinks, setLink, suggestLinks, type Link, type RealModule } from '@/lib/blueprint/links';
import type { Blueprint } from '@/lib/blueprint/types';
import { call } from './planApi';

const SELECT = 'w-full min-h-[44px] rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-base text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function LinksPanel({ classroomId, plan, modules, initialLinks, target, onSaved }: { classroomId: string; plan: Blueprint; modules: RealModule[]; initialLinks: Link[]; target: 'draft' | 'published'; onSaved: (links: Link[]) => void }) {
  const [links, setLinks] = useState<Link[]>(() => relevantLinks(plan, initialLinks));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string; list?: string[] } | null>(null);

  const nodes = useMemo(() => planModules(plan), [plan]);
  const cover = useMemo(() => coverage(plan, links), [plan, links]);
  const suggestions = useMemo(() => suggestLinks(plan, modules, links), [plan, modules, links]);
  const titleOf = useMemo(() => new Map(modules.map((m) => [m.id, m.title])), [modules]);
  const moduleOf = (nodeId: string) => links.find((l) => l.nodeId === nodeId)?.moduleId ?? '';
  // Un modulo real usado por OTRO modulo del plan se marca (elegirlo lo MUEVE aqui): asi nadie lo pierde sin enterarse.
  const usedBy = useMemo(() => new Map(links.map((l) => [l.moduleId, l.nodeId])), [links]);
  const nodeTitle = useMemo(() => new Map(nodes.map((n) => [n.nodeId, n.title || '(sin titulo)'])), [nodes]);

  const change = (nodeId: string, moduleId: string) => {
    setLinks((l) => setLink(l, nodeId, moduleId || null));
    setDirty(true);
    setNotice(null);
  };

  const applyAll = () => {
    setLinks((l) => applySuggestions(l, suggestLinks(plan, modules, l)));
    setDirty(true);
    setNotice({ tone: 'ok', text: `${suggestions.length} ${suggestions.length === 1 ? 'sugerencia aplicada' : 'sugerencias aplicadas'}. Revisalas y guarda los enlaces.` });
  };

  const save = async () => {
    setBusy(true);
    setNotice(null);
    const r = await call({ action: 'saveLinks', classroomId, links });
    setBusy(false);
    if (!r.ok) {
      setNotice({ tone: 'error', text: r.data?.error ?? 'No se pudieron guardar los enlaces.', list: Array.isArray(r.data?.errors) ? r.data.errors : undefined });
      return;
    }
    setDirty(false);
    onSaved(links);
    setNotice({ tone: 'ok', text: `Enlaces guardados (${r.data.total}).` });
  };

  // Agrupado por corte y objetivo, en el orden del recorrido.
  const groups: { period: string; objective: string; items: typeof nodes }[] = [];
  for (const n of nodes) {
    const g = groups[groups.length - 1];
    if (g && g.period === n.periodName && g.objective === n.objectiveTitle) g.items.push(n);
    else groups.push({ period: n.periodName, objective: n.objectiveTitle, items: [n] });
  }

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Link2 aria-hidden="true" className="h-5 w-5 shrink-0 text-primary-text" />
        <h3 className="min-w-0 text-lg font-semibold text-fg">Enlazar con los modulos de la clase</h3>
      </div>
      <p className="text-sm text-fg-muted">
        Asocia cada modulo del plan con un modulo que ya existe en tu clase. <strong className="text-fg">No crea ni cambia modulos</strong>: solo los une. Los enlaces son de esta version del plan ({target === 'draft' ? 'borrador' : 'publicada'}); si
        regeneras el plan, hay que enlazar de nuevo.
      </p>

      {modules.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-2 p-3 text-sm text-fg-muted">Esta clase todavia no tiene modulos. Crealos en la pestana «Modulos» y vuelve aqui.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className={`text-sm font-semibold ${cover.pending.length === 0 && cover.total > 0 ? 'text-success' : 'text-fg'}`} role="status">
              {cover.linked} de {cover.total} modulos del plan tienen contenido enlazado
            </p>
            <Button size="sm" variant="secondary" disabled={suggestions.length === 0 || busy} onClick={applyAll}>
              <Sparkles aria-hidden="true" className="h-4 w-4" />
              {suggestions.length === 0 ? 'Sin sugerencias' : `Aplicar ${suggestions.length} ${suggestions.length === 1 ? 'sugerencia' : 'sugerencias'}`}
            </Button>
          </div>

          <div className="space-y-4">
            {groups.map((g, gi) => (
              <section key={gi} aria-label={`${g.period}: ${g.objective}`} className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
                <p className="text-sm font-semibold text-fg [overflow-wrap:anywhere]">
                  {g.period} <span className="font-normal text-fg-muted">· {g.objective || '(objetivo sin titulo)'}</span>
                </p>
                {g.items.map((n) => {
                  const current = moduleOf(n.nodeId);
                  return (
                    <div key={n.nodeId} className="space-y-1">
                      <label htmlFor={`ln-${n.nodeId}`} className="block text-sm text-fg [overflow-wrap:anywhere]">
                        {n.title || '(sin titulo)'}
                      </label>
                      <select id={`ln-${n.nodeId}`} value={current} onChange={(e) => change(n.nodeId, e.target.value)} className={SELECT}>
                        <option value="">Sin enlazar (pendiente de contenido)</option>
                        {modules.map((m) => {
                          const owner = usedBy.get(m.id);
                          const elsewhere = owner !== undefined && owner !== n.nodeId;
                          return (
                            <option key={m.id} value={m.id}>
                              {m.title}
                              {elsewhere ? ` (ya enlazado a «${nodeTitle.get(owner!) ?? owner}»: pasaria a este)` : ''}
                            </option>
                          );
                        })}
                      </select>
                      {current && !titleOf.has(current) && <p className="text-xs text-danger">Ese modulo ya no existe en la clase.</p>}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={save} loading={busy} disabled={busy || !dirty}>
              {dirty ? 'Guardar enlaces' : 'Enlaces guardados'}
            </Button>
            {cover.pending.length > 0 && !dirty && <span className="text-sm text-fg-muted">{cover.pending.length} {cover.pending.length === 1 ? 'modulo sigue pendiente' : 'modulos siguen pendientes'} de contenido.</span>}
          </div>
        </>
      )}

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
    </Card>
  );
}
