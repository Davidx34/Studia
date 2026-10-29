'use client';

// Visor de laboratorios (panel de desarrollo). Sirve para ver cada plantilla funcionando y para comprobar el recorrido completo: la ficha del experimento se valida,
// el laboratorio corre aislado y lo que el estudiante hace llega a la app ya validado.

import { useMemo, useState } from 'react';
import { LabFrame } from '@/components/lab/LabFrame';
import { buildLab } from '@/lib/lab/labSpec';
import { LAB_TEMPLATES } from '@/lib/lab/labTemplates';
import { MODEL_EXAMPLES } from '@/lib/lab/modelExamples';
import { LAB_AREA_LABEL, type LabAttemptState } from '@/lib/lab/types';

export default function LaboratoriosClient() {
  const [template, setTemplate] = useState(LAB_TEMPLATES[0].id);
  const [mode, setMode] = useState<'controlado' | 'libre'>('controlado');
  const [curve, setCurve] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [state, setState] = useState<LabAttemptState | null>(null);

  // 'modelo:<id>' = un laboratorio a la medida (modelo declarativo de ejemplo); lo demas, una plantilla fija.
  const example = template.startsWith('modelo:') ? MODEL_EXAMPLES.find((e) => `modelo:${e.id}` === template) : undefined;
  const built = useMemo(
    () => (example ? buildLab({ template: 'modelo', title: example.title, model: example.raw, mode, showModelCurve: curve }) : buildLab({ template, mode, showModelCurve: curve })),
    [template, example, mode, curve]
  );
  const info = LAB_TEMPLATES.find((t) => t.id === template) ?? LAB_TEMPLATES[0];
  const push = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${s}`, ...l].slice(0, 8));

  return (
    <div className="theme-scope mx-auto max-w-6xl space-y-5 p-4 text-fg">
      <header>
        <h1 className="text-2xl font-bold">Laboratorios</h1>
        <p className="mt-1 text-sm text-fg-muted">Cada plantilla con su ficha por defecto. Lo que hagas queda registrado abajo, tal como le llegaría a la app.</p>
      </header>

      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-line bg-surface p-4">
        <label className="grid gap-1 text-sm font-semibold">
          Plantilla
          <select className="min-h-[44px] rounded-xl border border-line bg-bg px-3 font-normal" value={template} onChange={(e) => { setTemplate(e.target.value); setState(null); }}>
            {LAB_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>{LAB_AREA_LABEL[t.area]} · {t.name}</option>
            ))}
            {MODEL_EXAMPLES.map((e) => (
              <option key={e.id} value={`modelo:${e.id}`}>A la medida · {e.title}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Modo
          <select className="min-h-[44px] rounded-xl border border-line bg-bg px-3 font-normal" value={mode} onChange={(e) => setMode(e.target.value as 'controlado' | 'libre')}>
            <option value="controlado">Controlado (una variable a la vez)</option>
            <option value="libre">Libre</option>
          </select>
        </label>
        <label className="flex min-h-[44px] items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="h-5 w-5 accent-primary" checked={curve} onChange={(e) => setCurve(e.target.checked)} /> Mostrar la curva del modelo
        </label>
      </div>

      <p className="text-sm text-fg-muted"><strong className="text-fg">{example ? (built.ok ? built.lab.model?.concept : '') : info.concept}</strong> {example ? 'Modelo declarativo: las fórmulas las interpreta un evaluador propio, sin código de la IA.' : info.bestFor}</p>

      {built.ok ? (
        <LabFrame
          key={`${template}-${mode}-${curve}`}
          lab={built.lab}
          state={state}
          onState={(s) => { setState(s); push(`borrador: ${s.trials.length} ensayo(s), ${s.conclusion.length} caracteres de conclusión`); }}
          onSubmit={(s) => push(`ENTREGADO: ${s.trials.length} ensayo(s)`)}
        />
      ) : (
        <p role="alert" className="text-danger">{built.errors.join(' ')}</p>
      )}

      <section aria-label="Mensajes del laboratorio" className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="mb-2 text-sm font-bold">Lo que llegó a la app</h2>
        {log.length === 0 ? <p className="text-sm text-fg-muted">Todavía nada: registra un ensayo o escribe en el informe.</p> : (
          <ul className="space-y-1 font-mono text-xs">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
        )}
      </section>
    </div>
  );
}
