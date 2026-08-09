// Protocolo 7.1.1: tipo compartido para funciones que reciben un cliente
// de Supabase ya creado (por processYoutubeMaterial, chunkEmbedAndStore,
// etc.) en vez de crearlo ellas mismas -- evita `supabase: any` en cada
// firma. Los 4 factories (server/client/admin/anon) devuelven variantes de
// este mismo tipo generico (createServerClient/createBrowserClient de
// @supabase/ssr envuelven @supabase/supabase-js), asi que es seguro
// aceptar este tipo en cualquier funcion que no le importe el mecanismo de
// sesion/cookies del cliente, solo las tablas a las que puede consultar.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type TypedSupabaseClient = SupabaseClient<Database>;
