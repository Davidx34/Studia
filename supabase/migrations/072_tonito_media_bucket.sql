-- Bucket PUBLICO para los activos de marca de Toñito (clips y posters). Ver docs/TONITO_MEDIOS_Y_ALMACENAMIENTO.md.
--
-- Es publico a proposito: lo que contiene (clips de las cinematicas y sus imagenes) lo ve cualquier estudiante en la app y se sirve
-- desde el CDN de Supabase sin URLs firmadas. NUNCA debe guardar datos de estudiantes ni de profesores (para eso estan
-- teaching-materials y class-media, que son privados).
--
-- Seguridad (verificada con una simulacion en transaccion revertida, ver el PR):
--   - LEER un objeto por su URL publica no necesita politica: lo permite el indicador `public` del bucket.
--   - NO se crea ninguna politica sobre storage.objects para este bucket. Con RLS activo eso significa que ni `anon` ni
--     `authenticated` pueden subir, borrar, actualizar NI LISTAR archivos de este bucket. Solo escribe el service role
--     (el script `npm run media:upload`, con la clave de servicio del dueño del proyecto), que ignora RLS.
--   - Las 8 politicas existentes sobre storage.objects filtran por bucket_id (class-media y teaching-materials): ninguna alcanza a este.
--   - Tope de 5 MB por archivo y solo MP4, JPEG y WebP: un clip pesa ~215 KB y un poster, menos de 60 KB; lo demas es un error.
--
-- Orden de despliegue: esta migracion NO rompe nada (solo crea un bucket vacio que ningun codigo usa todavia), asi que se puede
-- aplicar antes o despues de mergear el PR.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tonito-media',
  'tonito-media',
  true,
  5242880, -- 5 MB por archivo
  ARRAY['video/mp4', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
