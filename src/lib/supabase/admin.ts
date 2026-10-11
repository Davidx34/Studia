import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Cliente con service role: bypasea RLS. Solo para uso server-side en
// contextos sin sesion de usuario o que siguen DESPUES de responder (el
// procesamiento de PDFs en segundo plano, la generacion compartida de fichas e
// infografias, el panel /dev). Quien lo use debe verificar antes la propiedad
// del recurso. NUNCA exponer este cliente ni la key al navegador.
export function createAdminSupabase() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
