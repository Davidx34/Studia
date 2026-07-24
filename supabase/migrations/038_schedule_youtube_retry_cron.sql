-- Migration 038: programa el reintento automatico en segundo plano de
-- materiales de YouTube sin transcripcion, cada 5 minutos. Llama al
-- endpoint /api/cron/retry-youtube-materials de la app Next.js (donde vive
-- la logica probada de Innertube+Gemini), autenticado con un secreto
-- guardado en Supabase Vault (nunca en texto plano en el codigo/migraciones).
--
-- IMPORTANTE si se re-ejecuta esta migracion en otro ambiente: primero hay
-- que crear el secreto en Vault con el mismo valor que CRON_SECRET en
-- Vercel:
--   select vault.create_secret('<valor-de-CRON_SECRET>', 'cron_retry_youtube_materials_secret', '...');

select cron.schedule(
  'retry-youtube-materials',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://studia-theta.vercel.app/api/cron/retry-youtube-materials',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'cron_retry_youtube_materials_secret'
      ),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
