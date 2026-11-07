import { Scale } from 'lucide-react';
import type { Calibration } from '@/lib/aiLearning/judgeCalibration';

const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)} %`);

// Muestra cuanto coincide el juez IA con las decisiones del profesor. Con pocas decisiones NO concluye: lo dice con claridad (no se promete mejora que no se midio).
export default function JudgeAgreementCard({ c }: { c: Calibration }) {
  const headline =
    c.status === 'trusted'
      ? 'El juez coincide con tus decisiones'
      : c.status === 'degraded'
        ? 'El juez no coincide lo suficiente con tus decisiones'
        : 'Aún no hay suficientes decisiones tuyas para medir al juez';
  const detail =
    c.status === 'insufficient'
      ? `Con ${c.decisive} de ${c.minDecisive} decisiones comparables no se puede concluir nada todavía. Cada pregunta que apruebes o rechaces aquí ayuda a medirlo.`
      : `Coincidió en ${c.agree} de ${c.decisive} (${pct(c.agreementRate)}); con esta muestra se puede afirmar al menos ${pct(c.lowerBound)}. Umbral para confiar: ${pct(c.threshold)}.`;
  return (
    <div className="rounded-2xl border border-line shadow-card bg-surface p-5 flex items-start gap-4" data-testid="judge-agreement">
      <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center flex-shrink-0">
        <Scale className="w-5 h-5 text-accent-text" aria-hidden />
      </div>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-fg">{headline}</h2>
        <p className="text-sm text-fg-muted mt-0.5">{detail}</p>
        {c.decisive > 0 && (
          <p className="text-xs text-fg-muted mt-2">
            El juez aprobó y tú rechazaste: <strong>{c.falsePass}</strong> · El juez rechazó y tú aprobaste: <strong>{c.falseFail}</strong>
            {c.unpaired > 0 && <> · Decisiones sin veredicto previo del juez: {c.unpaired}</>}
          </p>
        )}
      </div>
    </div>
  );
}
