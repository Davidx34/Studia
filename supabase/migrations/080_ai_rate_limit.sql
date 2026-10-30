-- 080: limite de uso de las rutas de IA, POR PROFESOR (y por ruta), con ventanas de tiempo y control ATOMICO en Postgres.
--
-- Problema: /api/memory/build y /api/lab/design gastan cuota de los proveedores de IA (cada pasada de la memoria lee muchos bloques; cada diseño hace de 2 a 4 llamadas). Sin tope, un
-- profesor (o una sesion robada) podia agotar la cuota de TODOS repitiendo la peticion. Un contador en memoria no sirve en Vercel: cada instancia serverless tiene el suyo y se
-- reinicia en frio. Por eso el contador vive en la base.
--
-- Como funciona: ventanas FIJAS (por ejemplo 60 s, 1 h y 24 h a la vez). consume_ai_quota(usuario, ruta, limites) comprueba TODAS las ventanas y, solo si ninguna esta llena,
-- suma 1 a todas. Una peticion rechazada NO consume cupo. Un candado consultivo por (usuario, ruta) serializa las peticiones concurrentes del mismo usuario: dos clics simultaneos no
-- pueden colarse por la misma ranura. Devuelve { allowed, retry_after } con los segundos hasta que se libere la ventana mas restrictiva.
--
-- Seguridad:
--   - La tabla tiene RLS y NINGUNA politica: ni el navegador ni un usuario autenticado pueden leerla ni escribirla (el cupo no se puede borrar ni consultar desde fuera).
--   - La funcion es SECURITY DEFINER con search_path fijo y SOLO la ejecuta service_role: la ruta del servidor la llama DESPUES de comprobar que quien pide es el dueño de la clase.
--   - Se validan los argumentos (ruta con forma fija, 1 a 5 ventanas, segundos 1..86400, limite 1..10000): un error de codigo no puede crear filas absurdas.
--   - Las filas de mas de 2 dias de ese usuario se borran de paso (no hace falta un cron).
--
-- Aditiva: no cambia nada existente. Si la funcion no existe (migracion sin aplicar), la aplicacion usa un limite en memoria de respaldo y lo registra.

CREATE TABLE IF NOT EXISTS public.ai_usage_windows (
  user_id        uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bucket         text        NOT NULL CHECK (bucket ~ '^[a-z][a-z0-9_.-]{0,39}$'),
  window_seconds integer     NOT NULL CHECK (window_seconds BETWEEN 1 AND 86400),
  window_start   timestamptz NOT NULL,
  hits           integer     NOT NULL DEFAULT 0 CHECK (hits >= 0),
  PRIMARY KEY (user_id, bucket, window_seconds, window_start)
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_windows_start ON public.ai_usage_windows (window_start);

ALTER TABLE public.ai_usage_windows ENABLE ROW LEVEL SECURITY;
-- Sin politicas a proposito: solo el servidor (service_role, que ignora RLS) la toca.
REVOKE ALL ON TABLE public.ai_usage_windows FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_ai_quota(p_user uuid, p_bucket text, p_limits jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rule    jsonb;
  secs    integer;
  lim     integer;
  ws      timestamptz;
  used    integer;
  retry   integer := 0;
  now_ts  timestamptz := now();
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'consume_ai_quota: usuario requerido' USING ERRCODE = '22023';
  END IF;
  IF p_bucket IS NULL OR p_bucket !~ '^[a-z][a-z0-9_.-]{0,39}$' THEN
    RAISE EXCEPTION 'consume_ai_quota: ruta invalida' USING ERRCODE = '22023';
  END IF;
  IF p_limits IS NULL OR jsonb_typeof(p_limits) <> 'array' OR jsonb_array_length(p_limits) NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'consume_ai_quota: se esperan de 1 a 5 ventanas' USING ERRCODE = '22023';
  END IF;

  -- Un usuario y una ruta a la vez: las peticiones concurrentes hacen fila.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_bucket, 0));

  -- 1. Comprobar TODAS las ventanas antes de sumar nada.
  FOR rule IN SELECT * FROM jsonb_array_elements(p_limits) LOOP
    IF jsonb_typeof(rule) <> 'object' OR jsonb_typeof(rule->'seconds') <> 'number' OR jsonb_typeof(rule->'limit') <> 'number' THEN
      RAISE EXCEPTION 'consume_ai_quota: ventana invalida' USING ERRCODE = '22023';
    END IF;
    secs := (rule->>'seconds')::integer;
    lim  := (rule->>'limit')::integer;
    IF secs NOT BETWEEN 1 AND 86400 OR lim NOT BETWEEN 1 AND 10000 THEN
      RAISE EXCEPTION 'consume_ai_quota: ventana fuera de rango' USING ERRCODE = '22023';
    END IF;
    ws := to_timestamp(floor(extract(epoch FROM now_ts) / secs) * secs);
    SELECT hits INTO used FROM public.ai_usage_windows
      WHERE user_id = p_user AND bucket = p_bucket AND window_seconds = secs AND window_start = ws;
    IF COALESCE(used, 0) >= lim THEN
      retry := GREATEST(retry, GREATEST(1, ceil(extract(epoch FROM (ws + make_interval(secs => secs) - now_ts)))::integer));
    END IF;
  END LOOP;

  IF retry > 0 THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after', retry);
  END IF;

  -- 2. Ninguna esta llena: se consume UNA en cada ventana.
  FOR rule IN SELECT * FROM jsonb_array_elements(p_limits) LOOP
    secs := (rule->>'seconds')::integer;
    ws := to_timestamp(floor(extract(epoch FROM now_ts) / secs) * secs);
    INSERT INTO public.ai_usage_windows (user_id, bucket, window_seconds, window_start, hits)
      VALUES (p_user, p_bucket, secs, ws, 1)
      ON CONFLICT (user_id, bucket, window_seconds, window_start)
      DO UPDATE SET hits = public.ai_usage_windows.hits + 1;
  END LOOP;

  DELETE FROM public.ai_usage_windows WHERE user_id = p_user AND window_start < now_ts - interval '2 days';

  RETURN jsonb_build_object('allowed', true, 'retry_after', 0);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_quota(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(uuid, text, jsonb) TO service_role;

COMMENT ON TABLE public.ai_usage_windows IS 'Contadores de uso de las rutas de IA por usuario, ruta y ventana de tiempo. Solo el servidor la toca (RLS sin politicas).';
COMMENT ON FUNCTION public.consume_ai_quota(uuid, text, jsonb) IS 'Consume un cupo en varias ventanas a la vez, de forma atomica. Devuelve {allowed, retry_after}. Solo service_role.';
