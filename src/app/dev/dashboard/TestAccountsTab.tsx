'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Download, Loader2, OctagonX, Play } from 'lucide-react';

type Bucket = { students: number; teachers: number; others: number; total: number };
type State = {
  summary: { real: Bucket; test: Bucket; total: number };
  control: { enabled: boolean; max: number };
  domain: string;
  registered: { email: string; createdAt: string }[];
};
type Credential = { email: string; password: string };

// Pestaña «Cuentas de prueba»: registro (reales frente a de prueba), interruptor de seguridad (apagado por defecto) y creación en lote. Las contraseñas se muestran UNA vez aquí y no se guardan.
export default function TestAccountsTab() {
  const [state, setState] = useState<State | null>(null);
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Credential[]>([]);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/dev/test-accounts');
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? 'No se pudo cargar');
    setState(json);
  }
  useEffect(() => {
    load();
  }, []);

  async function post(body: unknown) {
    const res = await fetch('/api/dev/test-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json() };
  }

  async function toggle(enabled: boolean) {
    setError(null);
    const { ok, json } = await post({ action: 'toggle', enabled });
    if (!ok) return setError(json.error ?? 'No se pudo cambiar el interruptor');
    await load();
  }

  async function create() {
    setBusy(true);
    setError(null);
    setNote(null);
    const { ok, json } = await post({ action: 'create', count });
    setBusy(false);
    if (!ok) return setError(json.error ?? 'No se pudo crear');
    setCreated((prev) => [...prev, ...(json.created ?? [])]);
    if (json.stoppedBy) setNote(json.message ?? 'El lote se detuvo.');
    await load();
  }

  function download() {
    const blob = new Blob([JSON.stringify(created, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'users.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!state) return <div className="text-sm text-slate-400">{error ?? 'Cargando…'}</div>;
  const { summary, control } = state;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-label="Registro de cuentas">
        <Tile label="Cuentas reales" value={summary.real.total} sub={`${summary.real.students} estudiantes · ${summary.real.teachers} profesores`} />
        <Tile label="Cuentas de prueba" value={summary.test.total} sub={`${summary.test.students} estudiantes · ${summary.test.teachers} profesores`} />
        <Tile label="Total" value={summary.total} sub="en la plataforma" />
        <Tile label="Registradas por el panel" value={state.registered.length} sub={`tope ${control.max}`} />
      </div>

      <div className={`rounded-xl border p-4 ${control.enabled ? 'border-amber-500/60 bg-amber-500/10' : 'border-slate-800 bg-slate-900'}`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold">Interruptor de creación de cuentas de prueba</h2>
            <p className="text-sm text-slate-400">
              Estado: <strong className={control.enabled ? 'text-amber-300' : 'text-emerald-300'}>{control.enabled ? 'ENCENDIDO: se pueden crear cuentas' : 'APAGADO: no se crea ninguna cuenta'}</strong>. Apagarlo detiene un lote en marcha (se comprueba antes de cada cuenta).
            </p>
          </div>
          {control.enabled ? (
            <button onClick={() => toggle(false)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 transition">
              <OctagonX className="w-4 h-4" /> DETENER
            </button>
          ) : (
            <button onClick={() => toggle(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 transition">
              <Play className="w-4 h-4" /> Permitir crear cuentas
            </button>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-base font-semibold mb-1">Crear cuentas de estudiante de prueba</h2>
        <p className="text-xs text-slate-500 mb-3">Correos carga01…@{state.domain}; contraseña al azar que se muestra UNA sola vez aquí (no se guarda). Máximo 20 por lote.</p>
        <div className="flex gap-2 flex-wrap items-center">
          <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} aria-label="Cantidad de cuentas" className="w-24 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm" />
          <button onClick={create} disabled={busy || !control.enabled} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-violet-500 hover:bg-violet-600 disabled:opacity-40 transition">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Crear
          </button>
          {!control.enabled && <span className="text-xs text-slate-500">Enciende el interruptor para crear.</span>}
        </div>
        {error && (
          <div className="mt-2 flex items-center gap-2 text-sm text-red-300">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}
        {note && <p className="mt-2 text-sm text-amber-300">{note}</p>}
      </div>

      {created.length > 0 && (
        <div className="rounded-xl border border-violet-500/50 p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <h3 className="text-sm font-semibold">Credenciales de esta sesión ({created.length}) — se pierden al salir de esta pantalla</h3>
            <button onClick={download} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-slate-800 hover:bg-slate-700 transition">
              <Download className="w-4 h-4" /> Descargar users.json
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-2">Guarda el archivo como <code>loadtest/users.json</code> (está ignorado por git). Solo contiene cuentas de prueba.</p>
          <ul className="text-xs font-mono space-y-1">
            {created.map((c) => (
              <li key={c.email}>
                {c.email} · {c.password}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="text-base font-semibold mb-2">Cuentas de prueba registradas ({state.registered.length})</h2>
        {state.registered.length === 0 ? <p className="text-sm text-slate-500">Ninguna todavía.</p> : <ul className="text-sm text-slate-300 space-y-1">{state.registered.map((r) => <li key={r.email}>{r.email}</li>)}</ul>}
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm">{label}</div>
      <div className="text-xs text-slate-500">{sub}</div>
    </div>
  );
}
