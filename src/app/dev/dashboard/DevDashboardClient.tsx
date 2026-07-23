'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  BarChart3,
  Activity,
  ScrollText,
  LogOut,
  Loader2,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

type Tab = 'users' | 'analytics' | 'health' | 'logs';

interface PendingRegistration {
  id: string;
  email: string;
  role: 'student' | 'teacher';
  created_at: string;
  used_at: string | null;
}

interface Profile {
  id: string;
  username: string;
  email: string | null;
  full_name: string | null;
  role: string;
  created_at: string;
}

interface AnalyticsSummary {
  total_students: number;
  total_teachers: number;
  total_classrooms: number;
  total_modules: number;
  total_lesson_questions: number;
  signups_last_7_days: number;
  pending_registrations_unused: number;
  active_classrooms: number;
}

interface SystemHealth {
  env: { cohere: boolean; gemini: boolean; devAuth: boolean; supabase: boolean };
  database: { ok: boolean; latencyMs: number; error: string | null };
}

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: 'users', label: 'Usuarios', icon: Users },
  { id: 'analytics', label: 'Analíticas', icon: BarChart3 },
  { id: 'health', label: 'Estado del sistema', icon: Activity },
  { id: 'logs', label: 'Logs', icon: ScrollText },
];

export default function DevDashboardClient() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('users');

  async function handleLogout() {
    await fetch('/api/dev-auth', { method: 'DELETE' });
    router.push('/dev/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Panel de desarrollador</h1>
          <p className="text-xs text-slate-500">catral.josedavid@gmail.com</p>
        </div>
        <button
          onClick={handleLogout}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <LogOut className="w-4 h-4" />
          Salir
        </button>
      </div>

      <div className="border-b border-slate-800 px-6 overflow-x-auto">
        <nav className="flex gap-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                  active ? 'border-violet-500 text-violet-300' : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-6 max-w-5xl mx-auto">
        {tab === 'users' && <UsersTab />}
        {tab === 'analytics' && <AnalyticsTab />}
        {tab === 'health' && <HealthTab />}
        {tab === 'logs' && <LogsTab />}
      </div>
    </div>
  );
}

function UsersTab() {
  const [registrations, setRegistrations] = useState<PendingRegistration[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'student' | 'teacher'>('student');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/dev/pending-registrations');
    const data = await res.json();
    if (res.ok) setRegistrations(data.registrations);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    const res = await fetch('/api/dev/pending-registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    const data = await res.json();
    setAdding(false);
    if (!res.ok) {
      setError(data.error ?? 'Error al invitar.');
      return;
    }
    setEmail('');
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Borrar esta invitación?')) return;
    await fetch(`/api/dev/pending-registrations/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-3">Invitar nuevo usuario</h2>
        <form onSubmit={handleAdd} className="flex gap-2 flex-wrap">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@ejemplo.com"
            className="flex-1 min-w-[220px] px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm focus:outline-none focus:border-violet-500"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'student' | 'teacher')}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm focus:outline-none focus:border-violet-500"
          >
            <option value="student">Estudiante</option>
            <option value="teacher">Profesor</option>
          </select>
          <button
            type="submit"
            disabled={adding}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-violet-500 hover:bg-violet-600 disabled:opacity-50 transition"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Invitar
          </button>
        </form>
        {error && (
          <div className="mt-2 flex items-center gap-2 text-sm text-red-300">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-base font-semibold mb-3">Invitaciones pendientes</h2>
        {registrations === null ? (
          <p className="text-sm text-slate-500">Cargando...</p>
        ) : registrations.length === 0 ? (
          <p className="text-sm text-slate-500">No hay invitaciones.</p>
        ) : (
          <div className="space-y-2">
            {registrations.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-slate-900 border border-slate-800 px-4 py-2.5"
              >
                <div>
                  <span className="text-sm text-white">{r.email}</span>
                  <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                    {r.role === 'teacher' ? 'Profesor' : 'Estudiante'}
                  </span>
                  {r.used_at && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      Usada
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(r.id)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-slate-500 mt-1">{label}</p>
    </div>
  );
}

function AnalyticsTab() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);

  useEffect(() => {
    fetch('/api/dev/analytics')
      .then((r) => r.json())
      .then((data) => setSummary(data.summary));
  }, []);

  if (!summary) return <p className="text-sm text-slate-500">Cargando...</p>;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <StatTile label="Estudiantes" value={summary.total_students} />
      <StatTile label="Profesores" value={summary.total_teachers} />
      <StatTile label="Clases" value={summary.total_classrooms} />
      <StatTile label="Clases activas" value={summary.active_classrooms} />
      <StatTile label="Módulos" value={summary.total_modules} />
      <StatTile label="Preguntas generadas" value={summary.total_lesson_questions} />
      <StatTile label="Registros últimos 7 días" value={summary.signups_last_7_days} />
      <StatTile label="Invitaciones sin usar" value={summary.pending_registrations_unused} />
    </div>
  );
}

function HealthTab() {
  const [health, setHealth] = useState<SystemHealth | null>(null);

  useEffect(() => {
    fetch('/api/dev/system-health')
      .then((r) => r.json())
      .then(setHealth);
  }, []);

  if (!health) return <p className="text-sm text-slate-500">Cargando...</p>;

  const items = [
    { label: 'Cohere API key', ok: health.env.cohere },
    { label: 'Gemini API key', ok: health.env.gemini },
    { label: 'Auth del panel dev', ok: health.env.devAuth },
    { label: 'Supabase configurado', ok: health.env.supabase },
    { label: `Base de datos (${health.database.latencyMs}ms)`, ok: health.database.ok },
  ];

  return (
    <div className="space-y-2 max-w-md">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center justify-between rounded-lg bg-slate-900 border border-slate-800 px-4 py-2.5"
        >
          <span className="text-sm text-white">{item.label}</span>
          {item.ok ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <XCircle className="w-4 h-4 text-red-400" />
          )}
        </div>
      ))}
      {health.database.error && (
        <p className="text-xs text-red-300 mt-2">{health.database.error}</p>
      )}
    </div>
  );
}

function LogsTab() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);

  useEffect(() => {
    fetch('/api/dev/analytics')
      .then((r) => r.json())
      .then((data) => setProfiles(data.profiles));
  }, []);

  if (!profiles) return <p className="text-sm text-slate-500">Cargando...</p>;

  return (
    <div>
      <h2 className="text-base font-semibold mb-3">Registros recientes</h2>
      <div className="space-y-2">
        {profiles.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between gap-3 rounded-lg bg-slate-900 border border-slate-800 px-4 py-2.5"
          >
            <div>
              <span className="text-sm text-white">{p.full_name || p.username}</span>
              <span className="ml-2 text-xs text-slate-500">{p.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                {p.role}
              </span>
              <span className="text-xs text-slate-500">{new Date(p.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
