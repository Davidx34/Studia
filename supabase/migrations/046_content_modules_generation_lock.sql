-- Aplica de verdad el bloqueo de generacion de preguntas (y le agrega caducidad).
--
-- Por que existe: la migracion 041 agrego content_modules.is_generating al
-- repositorio pero NUNCA se aplico en produccion (verificado el 2026-09-19:
-- information_schema no tenia la columna). Mientras tanto el codigo
-- (generationLock.ts, desde el mismo cambio) si escribia esa columna, asi que
-- acquireGenerationLock fallaba SIEMPRE con PGRST204 y devolvia "false". La ruta
-- /api/generate-questions interpretaba ese "false" como "ya hay otra generacion
-- en curso" y respondia 202 sin preguntas. Consecuencia: todo modulo con menos de
-- 5 preguntas validas en cache NO se podia generar al abrirlo.
--
-- Ese fallo estuvo enmascarado hasta el PR #54: la pagina del estudiante, ante
-- una respuesta sin preguntas, servia 3 preguntas de relleno ("Pregunta 1 sobre
-- <modulo>", "A. Opcion A"...). Al retirar ese relleno, el fallo se volvio visible.
-- Es muy probable que explique buena parte de los 22 de 36 modulos sin ninguna
-- pregunta que encontro la review 360.
--
-- generation_started_at agrega CADUCIDAD al bloqueo: si una generacion muere sin
-- liberarlo (timeout de la funcion, caida del proceso), el modulo no puede quedar
-- bloqueado para siempre. Sin esto, un solo timeout reproduce el mismo sintoma.
--
-- Idempotente: es seguro aunque 041 se haya aplicado en algun entorno.

ALTER TABLE public.content_modules
  ADD COLUMN IF NOT EXISTS is_generating boolean NOT NULL DEFAULT false;

ALTER TABLE public.content_modules
  ADD COLUMN IF NOT EXISTS generation_started_at timestamptz;

COMMENT ON COLUMN public.content_modules.is_generating IS
  'Bloqueo de generacion en curso (evita que varios estudiantes disparen a la vez la misma generacion). Caduca segun generation_started_at.';
COMMENT ON COLUMN public.content_modules.generation_started_at IS
  'Cuando se tomo el bloqueo de generacion. Un bloqueo mas viejo que el limite del codigo se considera abandonado.';

-- Que PostgREST vea las columnas nuevas sin esperar a su recarga periodica.
NOTIFY pgrst, 'reload schema';
