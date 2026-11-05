-- 090: mueve pg_trgm y pg_net de `public` al esquema `extensions` (aviso "extension_in_public" del linter de Supabase; la 081 ya hizo lo mismo con pgvector).
--
-- Estado verificado en produccion (solo lectura, 2026-11-05) antes de escribir esto:
--   - pg_trgm 1.6 en `public`; es REUBICABLE: basta ALTER EXTENSION ... SET SCHEMA. Ningun indice usa gin_trgm_ops/gist_trgm_ops y ninguna funcion propia llama a similarity/word_similarity
--     ni usa el operador %: las ~30 funciones de `public` con "trgm"/"similarity" son las de la propia extension.
--   - pg_net 0.20.0 en `public`; NO es reubicable (extrelocatable = false): se hace DROP + CREATE ... WITH SCHEMA extensions. Sus funciones viven en el esquema `net` (net.http_post...),
--     que no cambia: el codigo que llama net.http_post sigue igual. net.http_request_queue tiene 0 filas (nada en cola que se pierda), no hay disparadores ni funciones propias que usen net.*
--     y cron.job esta vacio (la migracion 038, que programaba net.http_post, NO esta programada en produccion).
--   - Probado en una transaccion revertida: ambos movimientos, similarity() desde `extensions` y 12 funciones en `net` despues de recrear.
--
-- Para deshacer:
--   ALTER EXTENSION pg_trgm SET SCHEMA public;
--   DROP EXTENSION pg_net; CREATE EXTENSION pg_net WITH SCHEMA public;
--
-- Si algun dia se programa un cron con net.http_post, sigue funcionando (esquema `net`). Quien use similarity()/% en SQL nuevo debe tener `extensions` en el search_path o calificar extensions.similarity().

CREATE SCHEMA IF NOT EXISTS extensions;

ALTER EXTENSION pg_trgm SET SCHEMA extensions;

DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

NOTIFY pgrst, 'reload schema';
