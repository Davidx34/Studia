-- Que clip de video usa cada cinematica de Toñito, guardado en la base y no en el codigo.
--
-- Antes: "esta escena usa este video" estaba escrito en el codigo (clips.ts y CinematicScene.tsx), asi que cada cinematica nueva
-- costaba un PR y un despliegue. Ahora el comando `npm run clip:publish` convierte el video, lo sube al bucket tonito-media y
-- escribe/actualiza AQUI la fila de la escena; la app la lee al cargar (cache corta) y la cinematica aparece sin redesplegar.
--
-- Una fila por escena (la escena es la clave: una escena tiene un solo clip a la vez). `active = false` apaga el clip de esa escena
-- sin tocar codigo (la escena vuelve a la pose animada). Los archivos del bucket son inmutables y versionados (.v1, .v2): publicar
-- un video nuevo crea archivos nuevos y cambia la fila; los viejos no se tocan.
--
-- Seguridad: TODO el mundo puede LEER (son rutas relativas a un bucket que ya es publico, no hay nada secreto); nadie puede escribir
-- desde la app: solo la clave de servicio (que se salta la RLS) usada desde el script en la maquina del dueño. Los CHECK impiden
-- que una fila mal escrita apunte fuera de clips/ o rompa la pagina.
--
-- Orden de despliegue: el codigo funciona SIN esta migracion (si la tabla no existe, la app usa el clip que trae en el codigo), asi que
-- puede aplicarse antes o despues del PR.

CREATE TABLE IF NOT EXISTS public.tonito_scene_clips (
  scene      text PRIMARY KEY CHECK (scene ~ '^[a-z_]+$'),
  clip_id    text NOT NULL CHECK (clip_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  src        text NOT NULL CHECK (src ~ '^clips/[a-z0-9-]+\.v[0-9]+\.mp4$'),
  poster     text NOT NULL CHECK (poster ~ '^clips/[a-z0-9-]+\.v[0-9]+\.(jpg|webp)$'),
  width      integer NOT NULL CHECK (width BETWEEN 64 AND 4096),
  height     integer NOT NULL CHECK (height BETWEEN 64 AND 4096),
  loop       boolean NOT NULL DEFAULT false,
  active     boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tonito_scene_clips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tonito_scene_clips_read ON public.tonito_scene_clips;
CREATE POLICY tonito_scene_clips_read ON public.tonito_scene_clips
  FOR SELECT TO anon, authenticated USING (true);

REVOKE ALL ON public.tonito_scene_clips FROM anon, authenticated;
GRANT SELECT ON public.tonito_scene_clips TO anon, authenticated;

-- El clip que ya esta publicado (celebracion, PR #130).
INSERT INTO public.tonito_scene_clips (scene, clip_id, src, poster, width, height, loop, active)
VALUES ('module_complete_good', 'celebracion', 'clips/celebracion.v1.mp4', 'clips/celebracion.v1.jpg', 720, 1280, false, true)
ON CONFLICT (scene) DO NOTHING;
