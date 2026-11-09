import { redirect } from 'next/navigation';
import { GraduationCap } from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase/server';
import { ALL_PRINCIPLES, DOCTRINE_VERSION, DOMAIN_LABELS, EVIDENCE_LABELS, PERSONA, SOURCES, TASK_LABELS, doctrineEnabled, type Domain, type Principle } from '@/lib/aiLearning/doctrine';

// Doctrina pedagogica global: lo que la IA «hereda» de la investigacion educativa. Es de solo lectura y se muestra completa para que se vea QUE se aplica, con que fuentes y con que limites.
// Que entre o no a los prompts depende de una medicion (variable DOCTRINE); aqui se dice con claridad en que estado esta.
export const dynamic = 'force-dynamic';

const ORDER: Domain[] = ['aprendizaje', 'evaluacion', 'retroalimentacion', 'motivacion', 'creatividad_e_indagacion', 'datos', 'mitos'];

function Sources({ ids }: { ids: string[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {ids.map((id) => {
        const s = SOURCES[id];
        if (!s) return null;
        return (
          <li key={id} className="text-xs text-fg-muted">
            {s.authors} ({s.year}). <em>{s.title}</em>. {s.venue}
            {s.detail ? `, ${s.detail}` : ''}.{s.doi ? ` doi:${s.doi}` : ''}{' '}
            <span className={s.verified ? 'text-accent-text' : 'text-warning'}>{s.verified ? '· fuente verificada' : '· cita de referencia, pendiente de verificar'}</span>
            {s.caveat && <span> — Matiz: {s.caveat}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function Item({ p }: { p: Principle }) {
  return (
    <details className="rounded-xl border border-line bg-surface p-4">
      <summary className="cursor-pointer text-sm font-medium text-fg">
        {p.title} <span className="text-xs text-fg-muted">· {EVIDENCE_LABELS[p.evidence]}</span>
      </summary>
      <div className="mt-3 space-y-2 text-sm">
        <p className="text-fg">{p.essence}</p>
        <p className="text-fg">
          <strong>{p.antiPrinciple ? 'Qué hace la IA al respecto: ' : 'Cómo se aplica: '}</strong>
          {p.apply}
          {p.avoid ? ` ${p.avoid}` : ''}
        </p>
        <p className="text-fg-muted">
          <strong>Límites: </strong>
          {p.limits}
        </p>
        <p className="text-xs text-fg-muted">Se usa en: {p.tasks.map((t) => TASK_LABELS[t]).join(', ')}.</p>
        <Sources ids={p.sources} />
      </div>
    </details>
  );
}

export default async function DoctrinaPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const on = doctrineEnabled();
  const verified = Object.values(SOURCES).filter((s) => s.verified).length;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line shadow-card bg-surface p-5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <GraduationCap className="w-5 h-5 text-accent-text" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-fg">Doctrina pedagógica de la IA</h2>
          <p className="text-sm text-fg-muted mt-0.5">
            Conocimiento de referencia de la investigación educativa (psicología del aprendizaje, evaluación, retroalimentación, motivación, creatividad e indagación) que todas las clases heredan. No es material de tu curso: son
            principios, con su fuente, su nivel de evidencia y sus límites. La IA solo recibe en cada tarea los pocos principios que le tocan.
          </p>
          <p className="text-xs text-fg-muted mt-2" data-testid="doctrina-estado">
            Versión {DOCTRINE_VERSION} · {ALL_PRINCIPLES.length} principios · {Object.keys(SOURCES).length} fuentes ({verified} verificadas en línea) ·{' '}
            <strong>{on ? 'Aplicada al generar preguntas' : 'Todavía NO se aplica al generar preguntas: se activa solo cuando una medición demuestre que mejora los resultados'}</strong>. Los principios de evidencia discutida y los mitos se
            muestran aquí pero nunca se le dan a la IA como regla.
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-line bg-surface p-5 space-y-3" data-testid="doctrina-perfil">
        <h3 className="text-base font-semibold text-fg">El perfil de la IA, convertido en conductas que se pueden comprobar</h3>
        <p className="text-sm text-fg-muted">Un adjetivo no mejora a un modelo; una conducta que se verifica, sí. Cada rasgo dice qué hace y cómo se comprueba.</p>
        <ul className="space-y-2">
          {PERSONA.map((t) => (
            <li key={t.id} className="text-sm text-fg">
              <strong>{t.label}:</strong> {t.meaning} <span className="text-fg-muted">Se comprueba así: {t.check}</span>
            </li>
          ))}
        </ul>
      </section>

      {ORDER.map((d) => {
        const list = ALL_PRINCIPLES.filter((p) => p.domain === d);
        if (list.length === 0) return null;
        return (
          <section key={d} className="space-y-2">
            <h3 className="text-base font-semibold text-fg">
              {DOMAIN_LABELS[d]} <span className="text-xs font-normal text-fg-muted">({list.length})</span>
            </h3>
            {list.map((p) => (
              <Item key={p.id} p={p} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
