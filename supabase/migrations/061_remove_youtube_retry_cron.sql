-- Se elimina el soporte de YouTube (decision del dueño del proyecto: rinde 1-3 fragmentos por video y falla ~1 de
-- cada 4, depende de que YouTube entregue subtitulos a un servidor; la via confiable es NotebookLM -> Markdown).
--
-- Esta migracion solo retira la tarea programada que llamaba cada 5 minutos a /api/cron/retry-youtube-materials
-- (endpoint que ya se elimino y que respondia 405). NO borra datos: los materiales de YouTube existentes, sus
-- columnas (youtube_video_id, transcript_source, auto_retry_count...) y la restriccion de source_type se quedan hasta
-- que el dueño decida que hacer con ellos (13 de esos 18 videos estan vinculados a modulos).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retry-youtube-materials') THEN
    PERFORM cron.unschedule('retry-youtube-materials');
  END IF;
END $$;
