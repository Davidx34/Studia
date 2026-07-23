import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Cliente anon "plano" (sin cookies de sesion) para llamadas server-side que
// no dependen de un usuario autenticado con Supabase Auth — usado por las
// rutas del panel de desarrollador, que tienen su propio gate de sesion
// (cookie firmada, ver src/lib/devAuth.ts) y llaman a funciones
// SECURITY DEFINER que ya bypasean RLS por diseño.
export function createAnonSupabase() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
