import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Cliente con service role: bypasea RLS. Solo para uso server-side en
// contextos sin sesion de usuario o que siguen DESPUES de responder (el
// procesamiento de PDFs en segundo plano, la generacion compartida de fichas e
// infografias, el panel /dev). Quien lo use debe verificar antes la propiedad
// del recurso. NUNCA exponer este cliente ni la key al navegador.
export const MISSING_SERVICE_KEY_MESSAGE =
  'Falta SUPABASE_SERVICE_ROLE_KEY en las variables de entorno del servidor (Vercel → Settings → Environment Variables). Sin ella no se pueden generar fichas/infografías, procesar PDFs en segundo plano ni usar el panel /dev.';

// ¿Esta configurada la llave de servicio en ESTE entorno? Se pregunta antes de usarla para poder responder con un
// motivo claro (o caer a un camino que no la necesita) en vez de reventar con "supabaseKey is required".
export function hasServiceRoleKey(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function createAdminSupabase() {
  if (!hasServiceRoleKey()) throw new Error(MISSING_SERVICE_KEY_MESSAGE);
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
