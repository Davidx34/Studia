// Marco comun de los evaluadores con conjuntos dorados (golden sets): metricas, umbrales ("compuertas") y un informe que FALLA de verdad.
//
// Un evaluador que siempre aprueba no sirve: por eso (1) sin casos NO aprueba, (2) una metrica no numerica NO aprueba, y (3) `assertPasses` lanza
// en cuanto una compuerta se incumple. Los scripts (scripts/eval-*.ts) terminan con codigo 1 en ese caso, y las pruebas inyectan generadores
// defectuosos para comprobar que cada evaluador los detecta.

export type GateOp = '>=' | '<=';

export interface Gate {
  metric: string;
  op: GateOp;
  threshold: number;
  // Por que importa esta compuerta (se imprime al fallar).
  why: string;
}

export interface GateResult extends Gate {
  value: number;
  pass: boolean;
}

export interface EvalReport {
  name: string;
  cases: number;
  metrics: Record<string, number>;
  gates: GateResult[];
  ok: boolean;
  // Una linea por caso o hallazgo, para depurar.
  details: string[];
}

export class EvalFailure extends Error {
  constructor(public readonly report: EvalReport) {
    super(failureMessage(report));
    this.name = 'EvalFailure';
  }
}

// n / d, con un valor por defecto cuando no hay con que dividir.
export const ratio = (n: number, d: number, whenEmpty = 0): number => (d === 0 ? whenEmpty : n / d);

export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function evaluateGates(name: string, cases: number, metrics: Record<string, number>, gates: Gate[], details: string[] = []): EvalReport {
  const results: GateResult[] = gates.map((g) => {
    const value = metrics[g.metric];
    const numeric = typeof value === 'number' && Number.isFinite(value);
    const pass = numeric && (g.op === '>=' ? value >= g.threshold : value <= g.threshold);
    return { ...g, value: numeric ? value : Number.NaN, pass };
  });
  // Sin casos no hay nada que medir: no se aprueba por omision.
  const ok = cases > 0 && results.every((r) => r.pass);
  return { name, cases, metrics, gates: results, ok, details };
}

function failureMessage(r: EvalReport): string {
  const lines = r.gates.filter((g) => !g.pass).map((g) => `  - ${g.metric} = ${Number.isNaN(g.value) ? 'no medible' : round3(g.value)} (se exige ${g.op} ${g.threshold}): ${g.why}`);
  if (r.cases === 0) lines.unshift('  - el evaluador no recibio ningun caso');
  return `${r.name}: NO APROBADO\n${lines.join('\n')}`;
}

// Lanza EvalFailure si el informe no aprobo; si aprobo, lo devuelve tal cual.
export function assertPasses(report: EvalReport): EvalReport {
  if (!report.ok) throw new EvalFailure(report);
  return report;
}

export function formatReport(r: EvalReport): string {
  const head = `${r.name} — ${r.cases} caso(s) — ${r.ok ? 'APROBADO' : 'NO APROBADO'}`;
  const rows = r.gates.map((g) => `  ${g.pass ? 'ok ' : 'MAL'}  ${g.metric.padEnd(30)} ${Number.isNaN(g.value) ? 'n/d' : String(round3(g.value)).padStart(6)}   (${g.op} ${g.threshold})`);
  return [head, ...rows, ...(r.details.length ? ['', ...r.details.map((d) => '  · ' + d)] : [])].join('\n');
}
