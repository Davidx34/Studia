-- 081: mueve la extension pgvector de `public` al esquema `extensions`.
--
-- Problema (aviso "extension_in_public" del linter de Supabase): la extension `vector` esta en `public`, que es el esquema que PostgREST expone como API. Sus ~50 funciones
-- (l2_distance, cosine_distance, vector_add, vector_in, avg, sum...) quedan como RPC invocables por cualquiera con la llave `anon`, que es PUBLICA (va en el JavaScript). Ninguna da
-- datos, pero son superficie de ataque innecesaria y ruido en el esquema de la aplicacion.
--
-- Estado verificado en produccion (solo lectura) antes de escribir esto:
--   - vector v0.8.0 en `public`; la extension es REUBICABLE (extrelocatable = true).
--   - el esquema `extensions` existe y anon, authenticated, service_role y postgres tienen USAGE sobre el.
--   - columnas de tipo vector: material_chunks.embedding y material_chunk_embeddings.embedding. Los tipos se guardan por OID: NO hay que tocar las columnas.
--   - indice HNSW idx_chunks_embedding (vector_cosine_ops): la clase de operadores tambien va por OID: NO se reconstruye.
--   - ninguna vista ni vista materializada depende del tipo.
--   - FUNCIONES PROPIAS que usan `vector` con search_path = public (si solo se moviera la extension, dejarian de encontrar el tipo y los operadores):
--       match_material_chunks, match_material_chunks_hybrid, match_material_chunks_scoped  (busquedas del RAG)
--       sync_chunk_embedding                                                              (disparador trg_sync_chunk_embedding en material_chunks)
--     Por eso aqui se les fija search_path = public, extensions.
--
-- Orden: la extension se mueve y, EN LA MISMA TRANSACCION, se corrigen las cuatro funciones: no hay un instante en que el RAG quede roto.
--
-- Para deshacer (si algo fallara):
--   ALTER EXTENSION vector SET SCHEMA public;
--   ALTER FUNCTION public.match_material_chunks(public.vector, uuid, integer) SET search_path = public;
--   ALTER FUNCTION public.match_material_chunks_hybrid(public.vector, text, uuid, uuid[], integer, text[], integer, double precision, double precision, text) SET search_path = public;
--   ALTER FUNCTION public.match_material_chunks_scoped(public.vector, uuid[], uuid, integer) SET search_path = public;
--   ALTER FUNCTION public.sync_chunk_embedding() SET search_path = public;
--
-- No se toca pg_trgm (tambien esta en public): queda para otra migracion, con su propia verificacion.

CREATE SCHEMA IF NOT EXISTS extensions;

ALTER EXTENSION vector SET SCHEMA extensions;

ALTER FUNCTION public.match_material_chunks(extensions.vector, uuid, integer)
  SET search_path = public, extensions;

ALTER FUNCTION public.match_material_chunks_hybrid(extensions.vector, text, uuid, uuid[], integer, text[], integer, double precision, double precision, text)
  SET search_path = public, extensions;

ALTER FUNCTION public.match_material_chunks_scoped(extensions.vector, uuid[], uuid, integer)
  SET search_path = public, extensions;

ALTER FUNCTION public.sync_chunk_embedding()
  SET search_path = public, extensions;

-- PostgREST guarda en cache el esquema: se le pide recargarlo para que deje de listar las funciones de vector en la API.
NOTIFY pgrst, 'reload schema';
