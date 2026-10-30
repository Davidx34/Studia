-- 083: salud PERSISTENTE de los proveedores de IA, solo para los bloqueos LARGOS.
--
-- Problema: el cortacircuito de la pasarela de IA vive en la memoria de cada instancia de Vercel. Cuando un proveedor agota su cuota DIARIA (que se reinicia a
-- medianoche UTC), cada instancia fria lo descubre de nuevo con una llamada real fallida; con la cuota gratuita de Gemini (decenas de peticiones al dia) cada
-- llamada desperdiciada cuenta.
--
-- Solucion ligera: cuando un fallo aparta a un candidato por una causa larga (cuota diaria, sin credito, llave invalida, modelo inexistente) se guarda aqui una fila
-- (candidato -> hasta cuando); antes de ordenar la cadena, cada instancia lee las filas vigentes y las aplica a su cortacircuito local. Lo corto (429 por minuto,
-- 5xx, tiempos agotados) NO se guarda. Ver src/lib/ai/gateway/persist.ts.
--
-- Seguridad:
--   - La tabla tiene RLS y NINGUNA politica: ni el navegador ni un usuario autenticado pueden leerla ni escribirla. Solo el servidor (service_role, que ignora RLS).
--   - La clave tiene forma fija y longitud acotada, y la causa es una lista cerrada: un error de codigo no puede crear filas absurdas.
--   - Las filas vencidas hace mas de un dia se borran de paso al guardar (no hace falta un cron).
--
-- Aditiva y opt-in: nada cambia hasta poner AI_HEALTH_PERSIST=1. Si la tabla no existe, la aplicacion sigue solo con la memoria de la instancia.

CREATE TABLE IF NOT EXISTS public.ai_provider_health (
  key        text        PRIMARY KEY CHECK (key ~ '^[A-Za-z0-9_.:@/-]{1,200}$'),
  kind       text        NOT NULL CHECK (kind IN ('rate_daily', 'payment', 'auth', 'not_found')),
  open_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_health_open_until ON public.ai_provider_health (open_until);

ALTER TABLE public.ai_provider_health ENABLE ROW LEVEL SECURITY;
-- Sin politicas a proposito: solo el servidor la toca.
REVOKE ALL ON TABLE public.ai_provider_health FROM anon, authenticated;
