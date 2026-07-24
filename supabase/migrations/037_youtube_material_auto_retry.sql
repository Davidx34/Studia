-- Migration 037: reintento automatico en segundo plano para materiales de
-- YouTube que fallan por bloqueos transitorios de YouTube/Gemini (rate
-- limiting). Los reintentos sincronos (dentro del request de subir/
-- reintentar) ya absorben algunos casos, pero cuando el bloqueo dura mas de
-- unos segundos no alcanzan. Este mecanismo reintenta en segundo plano,
-- espaciado en el tiempo (via pg_cron), hasta un limite de intentos.

ALTER TABLE teaching_materials
  ADD COLUMN IF NOT EXISTS auto_retry_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN teaching_materials.auto_retry_count IS
  'Cuantas veces el cron de reintento automatico (retry-youtube-materials) ya intento procesar este material sin exito. Se deja de reintentar automaticamente al llegar al limite configurado en /api/cron/retry-youtube-materials.';

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
