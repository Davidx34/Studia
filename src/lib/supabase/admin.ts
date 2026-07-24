import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Cliente con service role: bypasea RLS. Solo para uso server-side en
// contextos sin sesion de usuario (ej. el cron de reintento automatico de
// materiales de YouTube en src/app/api/cron/retry-youtube-materials), donde
// se necesita escribir en teaching_materials de cualquier profesor. NUNCA
// exponer este cliente ni la key al navegador.
export function createAdminSupabase() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
