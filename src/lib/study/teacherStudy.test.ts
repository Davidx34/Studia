import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { claimJob, runJob, cardsFailureMessage, cardsPartialNote, explainFailures, STALE_GENERATING_MS, RETRY_COOLDOWN_MS } from './jobs';
import { chipState, buildQueue, pendingIds, hasStudyContent, outcomeNotice, summarize, formatElapsed, isActive } from './panelState';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- base de datos simulada
interface Row { [k: string]: any }
function fakeAdmin(init: { gen?: Row | null; chunks?: Row[] } = {}) {
  const log: { op: string; table: string; payload?: any; filters?: any }[] = [];
  let genRow: Row | null = init.gen ?? null;
  const chunks = init.chunks ?? [];
  const from = (table: string) => {
    const filters: any = {};
    const api: any = {
      select: () => api,
      eq: (k: string, v: any) => ((filters[k] = v), api),
      in: (k: string, v: any) => ((filters[k] = v), api),
      order: () => api,
      maybeSingle: async () => ({ data: table.endsWith('generation') ? genRow : null }),
      then: (res: any) => res({ data: table === 'material_chunks' ? chunks : [] }),
      insert: async (payload: any) => {
        log.push({ op: 'insert', table, payload });
        if (table.endsWith('generation')) {
          if (genRow) return { error: { message: 'duplicate' } };
          genRow = { ...payload };
        }
        return { error: null };
      },
      update: (payload: any) => {
        const u: any = {
          eq: (k: string, v: any) => ((filters[k] = v), u),
          select: async () => {
            log.push({ op: 'update', table, payload, filters });
            // compare-and-set: solo gana quien conoce el estado y started_at actuales
            if (genRow && filters.status === genRow.status && filters.started_at === genRow.started_at) {
              genRow = { ...genRow, ...payload };
              return { data: [{ material_id: 'm' }] };
            }
            return { data: [] };
          },
          then: (res: any) => {
            log.push({ op: 'update', table, payload, filters });
            if (genRow) genRow = { ...genRow, ...payload };
            return res({ data: null });
          },
        };
        return u;
      },
      delete: () => {
        const d: any = { eq: () => d, in: () => d, then: (res: any) => (log.push({ op: 'delete', table }), res({ data: null })) };
        return d;
      },
    };
    return api;
  };
  return { from, log, get gen(): Row { return genRow as Row; } };
}

describe('claimJob', () => {
  const NOW = new Date('2026-10-12T12:00:00Z').getTime();

  it('sin fila previa reclama; una segunda peticion simultanea no puede ganar', async () => {
    const admin = fakeAdmin();
    expect((await claimJob(admin, 'cards', 'm', false, NOW)).state).toBe('claimed');
    expect((await claimJob(admin, 'cards', 'm', false, NOW)).state).toBe('busy');
  });

  it('lo ya listo no se regenera salvo force (el profesor lo pide a proposito)', async () => {
    const gen = { status: 'ready', started_at: new Date(NOW - 5e5).toISOString(), finished_at: new Date(NOW - 4e5).toISOString(), card_count: 30 };
    expect(await claimJob(fakeAdmin({ gen }), 'cards', 'm', false, NOW)).toEqual({ state: 'ready', cards: 30 });
    expect((await claimJob(fakeAdmin({ gen }), 'cards', 'm', true, NOW)).state).toBe('claimed');
  });

  it('en curso -> ocupado; en curso pero VIEJO (la funcion murio) -> se puede reclamar', async () => {
    const fresh = { status: 'generating', started_at: new Date(NOW - 60_000).toISOString(), finished_at: null, card_count: 0 };
    const stale = { ...fresh, started_at: new Date(NOW - STALE_GENERATING_MS - 1000).toISOString() };
    expect((await claimJob(fakeAdmin({ gen: fresh }), 'cards', 'm', false, NOW)).state).toBe('busy');
    expect((await claimJob(fakeAdmin({ gen: stale }), 'cards', 'm', false, NOW)).state).toBe('claimed');
  });

  it('tras fallar espera un minuto antes de reintentar y devuelve el motivo', async () => {
    const failed = { status: 'failed', started_at: new Date(NOW - 90_000).toISOString(), finished_at: new Date(NOW - RETRY_COOLDOWN_MS + 10_000).toISOString(), card_count: 0, error: 'La IA no respondió' };
    expect(await claimJob(fakeAdmin({ gen: failed }), 'cards', 'm', false, NOW)).toEqual({ state: 'cooldown', error: 'La IA no respondió' });
    const old = { ...failed, finished_at: new Date(NOW - RETRY_COOLDOWN_MS - 1000).toISOString() };
    expect((await claimJob(fakeAdmin({ gen: old }), 'cards', 'm', false, NOW)).state).toBe('claimed');
  });

  it('usa la tabla de estado que corresponde a cada tipo', async () => {
    const a = fakeAdmin();
    await claimJob(a, 'infographics', 'm', false, NOW);
    expect(a.log.find((l) => l.op === 'insert')!.table).toBe('study_infographic_generation');
  });
});

describe('runJob: resultado y motivo claros', () => {
  const long = 'La utilidad marginal decrece cuando consumimos mas unidades del mismo bien y la satisfaccion adicional baja. '.repeat(8);
  const chunks = [{ chunk_index: 0, content: `[Sección: Unidad 1]\n\n${long}` }];
  const material = { id: 'm', display_name: 'Microeconomía' };
  const goodCards = JSON.stringify({
    ficha: { titulo: 'Utilidad marginal', idea_principal: 'La utilidad marginal decrece cuando consumimos mas unidades del bien.', puntos_clave: ['La satisfaccion adicional baja al consumir mas.', 'Aplica al mismo bien consumido.'], terminos: [], pregunta_reflexion: '' },
    flashcards: [{ pregunta: 'Que pasa con la utilidad marginal al consumir mas unidades?', respuesta: 'La utilidad marginal decrece al consumir mas unidades del bien.' }],
  });

  it('exito: queda "ready" con el conteo y sin aviso', async () => {
    const admin = fakeAdmin({ chunks, gen: { status: 'generating', started_at: 'x' } });
    await runJob(admin, 'cards', material, { call: async () => goodCards });
    expect(admin.gen).toMatchObject({ status: 'ready', card_count: 2, error: null });
    expect(admin.log.some((l) => l.op === 'insert' && l.table === 'study_cards')).toBe(true);
  });

  it('la IA no responde -> failed, y el motivo dice que no respondio y que reintente', async () => {
    const admin = fakeAdmin({ chunks, gen: { status: 'generating', started_at: 'x' } });
    await runJob(admin, 'cards', material, { call: async () => null });
    expect(admin.gen.status).toBe('failed');
    expect(admin.gen.error).toMatch(/no respondió/);
    expect(admin.gen.error).toMatch(/Reintenta/);
    expect(admin.log.some((l) => l.op === 'insert' && l.table === 'study_cards')).toBe(false);
  });

  it('la IA responde con contenido ajeno al material -> failed con ese motivo (no se guarda nada)', async () => {
    const invented = JSON.stringify({ flashcards: [{ pregunta: 'Quien escribio La riqueza de las naciones?', respuesta: 'Adam Smith en Escocia durante 1776 publicando.' }] });
    const admin = fakeAdmin({ chunks, gen: { status: 'generating', started_at: 'x' } });
    await runJob(admin, 'cards', material, { call: async () => invented });
    expect(admin.gen.status).toBe('failed');
    expect(admin.gen.error).toMatch(/no se apoyaba en el material/);
  });

  it('material sin texto -> failed con motivo', async () => {
    const admin = fakeAdmin({ chunks: [], gen: { status: 'generating', started_at: 'x' } });
    await runJob(admin, 'cards', material, { call: async () => goodCards });
    expect(admin.gen).toMatchObject({ status: 'failed' });
    expect(admin.gen.error).toMatch(/no tiene texto suficiente/);
  });

  it('un error inesperado se registra como failed (nunca deja "generando" para siempre) y no lanza', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const admin = fakeAdmin({ chunks, gen: { status: 'generating', started_at: 'x' } });
    await expect(runJob(admin, 'cards', material, { call: async () => { throw new Error('boom'); } })).resolves.toBeUndefined();
    expect(admin.gen.status).toBe('failed');
    expect(admin.gen.error).toMatch(/Error inesperado/);
    err.mockRestore();
  });

  it('infografias: un material que "no se presta" queda listo, sin infografias y con la explicacion (no es un error)', async () => {
    const admin = fakeAdmin({ chunks, gen: { status: 'generating', started_at: 'x' } });
    await runJob(admin, 'infographics', material, { call: async () => JSON.stringify({ infografia: null }) });
    expect(admin.gen).toMatchObject({ status: 'ready', card_count: 0 });
    expect(admin.gen.error).toMatch(/no tiene datos que se presten/);
  });

  it('infografias: si la IA no responde SI es un fallo', async () => {
    const admin = fakeAdmin({ chunks, gen: { status: 'generating', started_at: 'x' } });
    await runJob(admin, 'infographics', material, { call: async () => null });
    expect(admin.gen.status).toBe('failed');
    expect(admin.gen.error).toMatch(/no respondió/);
  });

  it('el limite de tiempo corta con elegancia: lo no procesado se reporta como "se acabó el tiempo"', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ chunk_index: i, content: `[Sección: S${i}]\n\n${long.repeat(6)}` }));
    const admin = fakeAdmin({ chunks: many, gen: { status: 'generating', started_at: 'x' } });
    let t = 0;
    // El reloj salta 10 minutos tras la primera lectura: ningun bloque alcanza a abrirse.
    await runJob(admin, 'cards', material, { call: async () => goodCards, now: () => ((t += 1), t === 1 ? 0 : 10 * 60 * 1000) });
    expect(admin.gen.status).toBe('failed');
    expect(admin.gen.error).toMatch(/se acabó el tiempo/);
  });
});

describe('mensajes de motivo', () => {
  it('explainFailures nombra cada causa', () => {
    expect(explainFailures({ noResponse: 2, rejected: 1, skipped: 1 })).toMatch(/no respondió.*no se apoyaba.*tiempo/);
    expect(explainFailures({ noResponse: 0, rejected: 0, skipped: 0 })).toBe('motivo desconocido');
  });
  it('una generacion parcial deja un aviso con el conteo', () => {
    const r: any = { groupsFailed: 2, noResponse: 2, rejected: 0, skipped: 0 };
    expect(cardsPartialNote(r, 10)).toMatch(/2 de 10 secciones no se pudieron procesar/);
    expect(cardsPartialNote({ ...r, groupsFailed: 0 }, 10)).toBeNull();
    expect(cardsFailureMessage({ noResponse: 3, rejected: 0, skipped: 0 } as any, 3)).toMatch(/Reintenta en unos minutos/);
  });
});

describe('estado del panel', () => {
  const NOW = new Date('2026-10-12T12:00:00Z').getTime();
  const row = (p: any) => ({ status: 'ready', started_at: new Date(NOW - 1e5).toISOString(), finished_at: new Date(NOW).toISOString(), card_count: 5, error: null, ...p });

  it('fases: pendiente, en cola, generando, listo, listo con avisos, fallo, interrumpido', () => {
    expect(chipState(null, false, NOW).phase).toBe('none');
    expect(chipState(null, true, NOW).phase).toBe('queued');
    expect(chipState(row({ status: 'generating', finished_at: null }), false, NOW).phase).toBe('running');
    expect(chipState(row({}), false, NOW).phase).toBe('ready');
    expect(chipState(row({ error: '2 de 10 secciones…' }), false, NOW).phase).toBe('ready_with_notes');
    expect(chipState(row({ status: 'failed', error: 'La IA no respondió' }), false, NOW)).toEqual({ phase: 'failed', note: 'La IA no respondió' });
    expect(chipState(row({ status: 'generating', started_at: new Date(NOW - STALE_GENERATING_MS - 1).toISOString() }), false, NOW).phase).toBe('interrupted');
  });

  it('"en curso" gana sobre "en cola" para lo que ya se esta generando', () => {
    expect(chipState(row({ status: 'generating' }), true, NOW).phase).toBe('running');
  });

  const st = (cards: any, ig: any = { phase: 'none', note: null }) => ({ cards, infographics: ig });
  it('"pendientes" son los que no tienen nada listo ni en curso', () => {
    const items = [
      { id: 'a', status: st({ phase: 'ready', note: null }), fichas: 3, flashcards: 20 },
      { id: 'b', status: st({ phase: 'none', note: null }), fichas: 0, flashcards: 0 },
      { id: 'c', status: st({ phase: 'running', note: null }), fichas: 0, flashcards: 0 },
      { id: 'd', status: st({ phase: 'failed', note: 'x' }), fichas: 0, flashcards: 0 },
    ];
    expect(pendingIds(items)).toEqual(['b', 'd']);
    expect(hasStudyContent(items[0].status, 3, 20)).toBe(true);
    expect(hasStudyContent(items[0].status, 0, 0)).toBe(false);
  });

  it('la cola: un trabajo por material y tipo; lo ya listo se regenera (force); lo activo se omite', () => {
    const status = (id: string) => (id === 'a' ? st({ phase: 'ready', note: null }, { phase: 'none', note: null }) : id === 'b' ? st({ phase: 'running', note: null }) : st({ phase: 'none', note: null }));
    expect(buildQueue(['a', 'b', 'c'], { cards: true, infographics: true }, status)).toEqual([
      { materialId: 'a', kind: 'cards', force: true },
      { materialId: 'a', kind: 'infographics', force: false },
      { materialId: 'b', kind: 'infographics', force: false },
      { materialId: 'c', kind: 'cards', force: false },
      { materialId: 'c', kind: 'infographics', force: false },
    ]);
    expect(buildQueue(['c'], { cards: false, infographics: true }, status)).toEqual([{ materialId: 'c', kind: 'infographics', force: false }]);
  });

  it('avisos de resultado: exito, aviso y error con su motivo', () => {
    const ok = outcomeNotice('Mat', 'cards', row({}) as any, { fichas: 4, flashcards: 24, infographics: 0 });
    expect(ok).toEqual({ tone: 'success', text: '“Mat”: 4 fichas y 24 flashcards listas.' });
    expect(outcomeNotice('Mat', 'cards', row({ error: '2 de 10 secciones no se pudieron procesar' }) as any, { fichas: 1, flashcards: 1, infographics: 0 }).tone).toBe('warning');
    const bad = outcomeNotice('Mat', 'cards', row({ status: 'failed', error: 'La IA no respondió.' }) as any, { fichas: 0, flashcards: 0, infographics: 0 });
    expect(bad.tone).toBe('error');
    expect(bad.text).toContain('La IA no respondió.');
    expect(outcomeNotice('Mat', 'infographics', row({ card_count: 0, error: 'sin datos' }) as any, { fichas: 0, flashcards: 0, infographics: 0 }).tone).toBe('warning');
    expect(summarize([{ tone: 'success' }, { tone: 'error' }, { tone: 'warning' }, { tone: 'success' }])).toEqual({ ok: 2, warn: 1, err: 1 });
  });

  it('cronometro y helpers', () => {
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(-5)).toBe('0:00');
    expect(isActive('queued') && isActive('running') && !isActive('ready')).toBe(true);
  });
});

describe('quien puede generar y que ve el estudiante', () => {
  it('la ruta solo deja generar al profesor dueño del material (un estudiante recibe 404)', () => {
    const route = read('src/app/api/study/generate/route.ts');
    expect(route).toContain('auth.getUser()');
    expect(route).toContain(".eq('teacher_id', user.id)");
    expect(route).toContain("status: 404");
    expect(route).toContain("processing_status !== 'completed'");
    expect(route).toContain('runInBackground(runJob(');
    expect(fs.existsSync(path.join(process.cwd(), 'src/app/api/study/infographics/route.ts'))).toBe(false);
  });

  it('el reclamo es atomico y hay espera tras fallar', () => {
    const jobs = read('src/lib/study/jobs.ts');
    expect(jobs).toContain(".eq('started_at', current.started_at)");
    expect(jobs).toContain('RETRY_COOLDOWN_MS');
  });

  it('el estudiante NO tiene ningun control de generacion', () => {
    const client = read('src/app/(student)/my-classes/[id]/study/StudyClient.tsx');
    expect(client).not.toMatch(/\/api\/study\/generate|Generar fichas|Generar infograf|GenerateCard/);
    expect(client).toContain('Tu profesor aún no ha preparado material de estudio');
  });

  it('el estudiante solo ve los materiales que ya tienen contenido', () => {
    const page = read('src/app/(student)/my-classes/[id]/study/page.tsx');
    expect(page).toContain('.filter((m) => m.fichas + m.flashcards + m.infographics > 0)');
  });

  it('la pestaña del profesor es la ULTIMA de las opciones de su curso', () => {
    const tabs = read('src/app/(teacher)/teacher/classrooms/[id]/ClassroomTabs.tsx');
    const labels = Array.from(tabs.matchAll(/label: '([^']+)'/g)).map((m) => m[1]);
    expect(labels[labels.length - 1]).toBe('Material de estudio');
    expect(labels).toContain('Materiales');
  });

  it('el panel del profesor avisa resultado y motivo, y pide confirmacion antes de reemplazar', () => {
    const panel = read('src/app/(teacher)/teacher/classrooms/[id]/study/StudyGeneratorClient.tsx');
    expect(panel).toContain('Seleccionar pendientes');
    expect(panel).toContain('Visible para los estudiantes');
    expect(panel).toContain('aria-live');
    expect(panel).toContain("role={n.tone === 'error' ? 'alert' : 'status'}");
    expect(panel).toMatch(/confirm\(/);
    expect(panel).toContain('perderán su progreso de repaso');
  });

  it('el codigo del panel (navegador) no importa nada de servidor', () => {
    const panel = read('src/app/(teacher)/teacher/classrooms/[id]/study/StudyGeneratorClient.tsx');
    expect(panel).not.toMatch(/from '@\/lib\/study\/(jobs|generate)'|supabase\/admin|openrouter/);
    expect(read('src/lib/study/panelState.ts')).not.toMatch(/from '\.\/(jobs|generate)'/);
  });
});

describe('sin llave de servicio (SUPABASE_SERVICE_ROLE_KEY ausente en Vercel)', () => {
  it('hasServiceRoleKey refleja el entorno y createAdminSupabase falla con un mensaje claro', async () => {
    const { hasServiceRoleKey, createAdminSupabase, MISSING_SERVICE_KEY_MESSAGE } = await import('@/lib/supabase/admin');
    const saved = { ...process.env };
    try {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
      expect(hasServiceRoleKey()).toBe(false);
      expect(() => createAdminSupabase()).toThrow(MISSING_SERVICE_KEY_MESSAGE);
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'una-llave';
      expect(hasServiceRoleKey()).toBe(true);
    } finally {
      process.env = saved;
    }
  });

  it('la ruta de generacion responde con el motivo, no con "Error inesperado"', () => {
    const route = read('src/app/api/study/generate/route.ts');
    expect(route).toContain('if (!hasServiceRoleKey())');
    expect(route).toContain('MISSING_SERVICE_KEY_MESSAGE');
  });

  it('subir/reprocesar un PDF cae al camino de antes (en la peticion) si falta la llave, en vez de fallar', () => {
    const src = read('src/lib/actions/materials.ts');
    expect(src.match(/if \(hasServiceRoleKey\(\)\) runInBackground\(processPdfMaterial\(createAdminSupabase\(\)/g)!.length).toBe(2);
    expect(src).toContain('else await processPdfMaterial(supabase, data.id)');
    expect(src).toContain('else await processPdfMaterial(supabase, materialId)');
  });
});
