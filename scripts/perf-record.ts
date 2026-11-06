// Registra una corrida de k6 en la MEMORIA DE RENDIMIENTO (memoria-rendimiento/): guarda un registro compacto en runs/<id>.json y lo agrega a index.json.
//
//   k6 run --summary-export=loadtest/results/mi-corrida.json ...
//   npx tsx scripts/perf-record.ts loadtest/results/mi-corrida.json --id 2026-11-07-prod-03-aula --date 2026-11-07 --target produccion --scenario 03-lesson-flow --profile aula --note "tras #233"
//
// No guarda credenciales ni el resumen crudo: solo metricas compactas y los metadatos que se pasan.
import fs from 'fs';
import path from 'path';
import { compactSummary } from '../src/lib/perfmemory/compact';

const args = process.argv.slice(2);
const file = args[0];
const val = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const need = (f: string) => {
  const v = val(f);
  if (!v) throw new Error(`Falta ${f}`);
  return v;
};

if (!file) throw new Error('Uso: perf-record.ts <resumen-k6.json> --id --date --target --scenario --profile [--note]');
const dir = path.join(process.cwd(), 'memoria-rendimiento');
fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
const record = compactSummary(JSON.parse(fs.readFileSync(file, 'utf8')), { id: need('--id'), date: need('--date'), target: need('--target'), scenario: need('--scenario'), profile: need('--profile'), note: val('--note') });
fs.writeFileSync(path.join(dir, 'runs', `${record.id}.json`), JSON.stringify(record, null, 2) + '\n');

const indexPath = path.join(dir, 'index.json');
const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : { runs: [], optimizations: [], findings: [] };
index.runs = [...index.runs.filter((r: { id: string }) => r.id !== record.id), { id: record.id, date: record.date, target: record.target, scenario: record.scenario, profile: record.profile, vusMax: record.vusMax, failedRate: record.http.failedRate, perSecond: record.http.perSecond, thresholdsFailed: record.thresholdsFailed.length, file: `runs/${record.id}.json`, note: record.note ?? '' }].sort((a: { date: string; id: string }, b: { date: string; id: string }) => (a.date + a.id).localeCompare(b.date + b.id));
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
console.log(`Registrada ${record.id} (${Object.keys(record.timings).length} tiempos, ${record.thresholdsFailed.length} umbrales cruzados).`);
