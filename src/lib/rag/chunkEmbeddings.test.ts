import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const sql = read('supabase/migrations/070_chunk_embeddings_by_profile.sql')
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');

// El comportamiento real (relleno 197 vs 197, disparador, perfil de 1.024 dimensiones, dimensiones incompatibles sin error,
// acceso de ajeno/anon) se verifico en produccion con una transaccion revertida. Esto evita que alguien quite las defensas.
describe('migracion 070: un vector por fragmento y por perfil', () => {
  it('la tabla de dimension libre queda cerrada para la app (solo servidor y funciones SECURITY DEFINER)', () => {
    expect(sql).toContain('embedding vector NOT NULL');
    expect(sql).toContain('CONSTRAINT embedding_dims_match CHECK (vector_dims(embedding) = dims)');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON public.material_chunk_embeddings FROM PUBLIC, anon, authenticated');
    expect(sql).not.toMatch(/GRANT (SELECT|INSERT|UPDATE|ALL) ON (TABLE )?public\.material_chunk_embeddings/);
    expect(sql).toContain('PRIMARY KEY (chunk_id, profile)');
    expect(sql).toContain('ON DELETE CASCADE');
  });

  it('el disparador mantiene la tabla sincronizada con la columna vieja y no es invocable por la app', () => {
    expect(sql).toContain('AFTER INSERT OR UPDATE OF embedding, embedding_model ON public.material_chunks');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.sync_chunk_embedding() FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('ON CONFLICT (chunk_id, profile) DO UPDATE');
  });

  it('el relleno copia lo existente sin borrar nada', () => {
    expect(sql).toContain('INSERT INTO public.material_chunk_embeddings');
    expect(sql).not.toMatch(/DELETE FROM public\.material_chunks|DROP TABLE|TRUNCATE|DROP COLUMN/);
  });

  it('la busqueda acepta cualquier dimension, apaga la parte vectorial si no cuadra y conserva el control de acceso', () => {
    expect(sql).toContain('query_embedding vector DEFAULT NULL');
    expect(sql).toContain('vector_profile text DEFAULT NULL');
    expect(sql).toContain('IF v_pdims IS NULL OR v_pdims <> v_qdims THEN query_embedding := NULL; END IF;');
    expect(sql).toContain('IF v_qdims <> 768 THEN query_embedding := NULL; END IF;');
    expect(sql).toContain("auth.role() = 'service_role'");
    expect(sql).toContain('c.teacher_id = auth.uid()');
    expect(sql).toContain('ce.student_id = auth.uid()');
    expect(sql.match(/FROM PUBLIC, anon/g)!.length).toBeGreaterThanOrEqual(2);
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*\banon\b/);
  });

  it('los llamadores anteriores (sin perfil) siguen funcionando: el perfil es el ultimo parametro y tiene valor por defecto', () => {
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.match_material_chunks_hybrid'));
    const params = fn.slice(fn.indexOf('(') + 1, fn.indexOf('RETURNS TABLE'));
    expect(params.trim().endsWith('vector_profile text DEFAULT NULL\n)')).toBe(true);
    for (const p of ['match_count integer DEFAULT 20', 'vector_weight double precision DEFAULT 1.0', 'text_weight double precision DEFAULT 1.0']) expect(params).toContain(p);
  });

  it('el codigo actual no depende todavia de la tabla nueva (el flujo no cambia hasta el paso 4)', () => {
    expect(read('src/lib/rag/retrieve.ts')).not.toContain('material_chunk_embeddings');
    expect(read('src/lib/materials/textProcessing.ts')).not.toContain('material_chunk_embeddings');
  });
});
