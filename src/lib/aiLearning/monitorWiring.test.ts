import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadMonitorReport } from './monitorLoader';

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n');

// Cliente falso: tablas -> filas. Soporta select/eq/in/order/limit/range encadenados.
function fakeDb(tables: Record<string, any[]>, opts: { failOn?: string } = {}) {
  return {
    from(t: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        limit: async () => (t === opts.failOn ? { data: null, error: { message: 'x' } } : { data: tables[t] ?? [], error: null }),
        range: async () => (t === opts.failOn ? { data: null, error: { message: 'x' } } : { data: tables[t] ?? [], error: null }),
        then: (res: any) => res(t === opts.failOn ? { data: null, error: { message: 'x' } } : { data: tables[t] ?? [], error: null }),
      };
      return q;
    },
  };
}
const d = (day: number) => new Date(Date.UTC(2026, 9, day)).toISOString();
const rows = (day: number, status: string, n: number, reason: string | null = null) => Array.from({ length: n }, () => ({ created_at: d(day), review_status: status, review_reason: reason, reviewed_by: 'ai_judge' }));

describe('loadMonitorReport', () => {
  it('sin cliente o ante cualquier fallo devuelve null (la tarjeta simplemente no aparece)', async () => {
    expect(await loadMonitorReport(null, 'c')).toBeNull();
    expect(await loadMonitorReport(fakeDb({}, { failOn: 'ai_playbooks' }), 'c')).toBeNull();
    expect(await loadMonitorReport(fakeDb({ ai_playbooks: [], content_modules: [{ id: 'm' }] }, { failOn: 'lesson_questions' }), 'c')).toBeNull();
    expect(await loadMonitorReport({ from: () => { throw new Error('boom'); } }, 'c')).toBeNull();
  });
  it('arma el informe con un cuaderno activo y detecta una regresion clara en datos de ejemplo', async () => {
    const db = fakeDb({
      ai_playbooks: [{ id: 'a', version: 1, status: 'active', activated_at: d(10) }],
      content_modules: [{ id: 'm' }],
      lesson_questions: [...rows(1, 'approved', 100), ...rows(12, 'approved', 20), ...rows(12, 'rejected', 80, 'La respuesta marcada es incorrecta: el calculo esta mal')],
      ai_feedback_events: [],
    });
    const r = await loadMonitorReport(db, 'c');
    expect(r?.watch?.level).toBe('regresion');
    expect(r?.alerts.map((a) => a.id)).toContain('cuaderno_regresion');
  });
});

describe('el monitor propone, nunca actua solo', () => {
  it('el nucleo y el cargador no escriben nada ni activan/desactivan cuadernos', () => {
    for (const f of ['src/lib/aiLearning/regressionMonitor.ts', 'src/lib/aiLearning/monitorLoader.ts']) {
      const s = read(f);
      expect(s).not.toMatch(/\.(insert|update|delete|upsert)\(/);
      expect(s).not.toContain('activatePlaybook');
      expect(s).not.toContain('deactivatePlaybook');
    }
  });
  it('el script de linea de comandos es de solo lectura y no publica nombres de clase en la foto', () => {
    const s = read('scripts/quality-monitor.ts');
    expect(s).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(s).toContain('clase-${i + 1}');
    expect(s.slice(s.indexOf('salida.push'))).not.toContain('c.name');
  });
  it('revertir usa SOLO las acciones existentes del profesor (activar version previa o desactivar)', () => {
    const s = read('src/app/(teacher)/teacher/classrooms/[id]/playbook/QualityWatch.tsx');
    expect(s).toContain('activatePlaybook(classroomId, toId)');
    expect(s).toContain('deactivatePlaybook(classroomId)');
    expect(s).toContain('Solo te avisa y propone');
  });
  it('la pagina lee el informe con llave de servicio solo DESPUES de comprobar que la clase es del profesor', () => {
    const s = read('src/app/(teacher)/teacher/classrooms/[id]/playbook/page.tsx');
    expect(s.indexOf(".eq('teacher_id', user.id)")).toBeGreaterThan(-1);
    expect(s.indexOf(".eq('teacher_id', user.id)")).toBeLessThan(s.indexOf('loadMonitorReport(createAdminSupabase()'));
  });
  it('la tarjeta se muestra en la pantalla de estilo', () => {
    expect(read('src/app/(teacher)/teacher/classrooms/[id]/playbook/PlaybookClient.tsx')).toContain('<QualityWatch');
  });
});
