import type { HealthTracker } from './health';
import type { FailureKind } from './types';

// Salud PERSISTENTE de los proveedores, solo para los bloqueos LARGOS.
//
// Problema: el cortacircuito vive en la memoria de cada instancia de Vercel. Cuando un proveedor agota su cuota DIARIA (se reinicia a medianoche
// UTC), cada instancia fria lo descubre de nuevo con una llamada real fallida, y hay muchas instancias y arranques en frio por dia. Con la cuota
// gratuita de Gemini (decenas de peticiones al dia) cada llamada desperdiciada cuenta.
//
// Solucion ligera: cuando un fallo aparta a un candidato por una causa LARGA (cuota diaria, sin credito, llave invalida, modelo inexistente) se
// guarda en la tabla ai_provider_health (migracion 083); antes de ordenar la cadena, cada instancia lee los bloqueos vigentes (con una cache de
// SYNC_TTL_MS para no consultar la base en cada llamada) y los aplica a su cortacircuito local. NO se persiste lo corto (429 por minuto, 5xx,
// tiempos agotados): eso se aprende en pocas llamadas y guardarlo seria escribir en la base en cada parpadeo.
//
// Es OPT-IN (AI_HEALTH_PERSIST=1): sin la variable no hay ninguna consulta nueva. Si la tabla no existe o la base falla, todo sigue como antes
// (solo memoria): nunca lanza ni bloquea una llamada de IA.

type Env = Record<string, string | undefined>;

export interface PersistedBlock {
  key: string; // proveedor:modelo (o embed:proveedor:perfil)
  openUntil: number; // epoch ms
  kind: FailureKind;
}

export interface HealthStore {
  // Bloqueos vigentes (openUntil > now).
  load(now: number): Promise<PersistedBlock[]>;
  save(block: PersistedBlock): Promise<void>;
}

// Causas que se comparten entre instancias: todas apartan al candidato por una hora o mas.
export const PERSISTABLE_KINDS: ReadonlySet<FailureKind> = new Set<FailureKind>(['rate_daily', 'payment', 'auth', 'not_found']);

// Cada cuanto como maximo una instancia vuelve a leer la tabla.
export const SYNC_TTL_MS = 30_000;
// Una escritura que tarda mas que esto se abandona: guardar la salud nunca debe retrasar la respuesta al usuario.
export const SAVE_TIMEOUT_MS = 1500;

export const persistenceEnabled = (env: Env = process.env): boolean => env.AI_HEALTH_PERSIST?.trim() === '1';

// ¿Este fallo merece guardarse? Solo si aparto al candidato y la causa es larga.
export function shouldPersist(kind: FailureKind, openMs: number): boolean {
  return openMs > 0 && PERSISTABLE_KINDS.has(kind);
}

const lastSync = new WeakMap<HealthStore, number>();

// Lee los bloqueos vigentes y los aplica al cortacircuito local. Como mucho una lectura cada SYNC_TTL_MS por almacen (el instante se anota ANTES de
// leer: varias llamadas simultaneas no hacen varias lecturas). Nunca lanza. Devuelve cuantos bloqueos aplico.
export async function syncPersistedHealth(health: HealthTracker, store: HealthStore | null, now: number): Promise<number> {
  if (!store) return 0;
  const last = lastSync.get(store);
  if (last !== undefined && now - last < SYNC_TTL_MS) return 0;
  lastSync.set(store, now);
  try {
    const blocks = await store.load(now);
    return health.hydrate(blocks.map((b) => ({ key: b.key, openUntil: b.openUntil })));
  } catch {
    return 0; // sin tabla o sin red: se sigue solo con la memoria
  }
}

// Guarda un bloqueo largo. Nunca lanza y nunca espera mas de SAVE_TIMEOUT_MS.
export async function persistBlock(store: HealthStore | null, block: PersistedBlock, openMs: number): Promise<boolean> {
  if (!store || !shouldPersist(block.kind, openMs)) return false;
  try {
    await Promise.race([store.save(block), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), SAVE_TIMEOUT_MS))]);
    return true;
  } catch {
    return false;
  }
}

// ---- Almacen en Postgres (Supabase, con la llave de servicio: la tabla no tiene politicas) ----

// Lo minimo del cliente de Supabase que se usa (para poder simularlo en las pruebas).
export interface HealthDb {
  from(table: 'ai_provider_health'): {
    select(columns: string): { gt(column: string, value: string): PromiseLike<{ data: any[] | null; error: { message?: string } | null }> };
    upsert(row: Record<string, unknown>, opts: { onConflict: string }): PromiseLike<{ error: { message?: string } | null }>;
    delete(): { lt(column: string, value: string): PromiseLike<{ error: { message?: string } | null }> };
  };
}

const DAY = 86_400_000;

export function createSupabaseHealthStore(db: HealthDb, now: () => number = Date.now): HealthStore {
  return {
    async load(t) {
      const { data, error } = await db.from('ai_provider_health').select('key, kind, open_until').gt('open_until', new Date(t).toISOString());
      if (error) throw new Error(error.message ?? 'error');
      const out: PersistedBlock[] = [];
      for (const r of data ?? []) {
        const openUntil = Date.parse(String(r?.open_until));
        if (typeof r?.key === 'string' && PERSISTABLE_KINDS.has(r?.kind) && Number.isFinite(openUntil)) out.push({ key: r.key, kind: r.kind, openUntil });
      }
      return out;
    },
    async save(b) {
      const { error } = await db
        .from('ai_provider_health')
        .upsert({ key: b.key, kind: b.kind, open_until: new Date(b.openUntil).toISOString(), updated_at: new Date(now()).toISOString() }, { onConflict: 'key' });
      if (error) throw new Error(error.message ?? 'error');
      // De paso se borran los bloqueos vencidos hace mas de un dia (no hace falta un cron).
      await db.from('ai_provider_health').delete().lt('open_until', new Date(now() - DAY).toISOString());
    },
  };
}

let shared: HealthStore | null | undefined;

// Almacen por defecto: solo con AI_HEALTH_PERSIST=1 y la llave de servicio. Se crea una vez por proceso.
export async function defaultHealthStore(env: Env = process.env): Promise<HealthStore | null> {
  if (!persistenceEnabled(env)) return null;
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  if (shared === undefined) {
    try {
      // Import diferido: importar la pasarela no arrastra el cliente de Supabase cuando la persistencia esta apagada.
      const { createAdminSupabase } = await import('@/lib/supabase/admin');
      shared = createSupabaseHealthStore(createAdminSupabase() as unknown as HealthDb);
    } catch {
      shared = null;
    }
  }
  return shared;
}

// Solo para pruebas.
export function resetDefaultHealthStoreForTests(): void {
  shared = undefined;
}
