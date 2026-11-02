import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'supabase/migrations');
const sql = fs.readFileSync(path.join(dir, '088_exam_questions.sql'), 'utf8').replace(/\r\n/g, '\n');
// Sin comentarios: las reglas se comprueban sobre el SQL que se ejecuta, no sobre lo que dicen los comentarios.
const code = sql.replace(/^--.*$/gm, '');

// El comportamiento real se verifico contra la base de produccion DENTRO de una transaccion revertida (28 comprobaciones: pregunta valida; modulo que no ensena la comprension, inexistente o con
// caracteres raros; material de otra clase; nace aprobada; enunciado repetido; forma de la clave por tipo; explicacion y cita cortas; revision sin fecha; editar contenido, clave y veredicto;
// RLS de profesor / ESTUDIANTE con plan publicado y pregunta aprobada (0 filas) / otro usuario / anon; escribir desde el navegador; plan archivado; cascada). Estas pruebas fijan lo que no
// debe cambiar sin volver a verificarlo.
describe('migracion 088 (banco de preguntas de examen): seguridad', () => {
  it('es la siguiente despues de la 087', () => {
    const files = fs.readdirSync(dir).filter((f) => /^\d{3}_/.test(f)).sort();
    expect(files.indexOf('088_exam_questions.sql')).toBe(files.indexOf('087_blueprint_module_links.sql') + 1);
  });
  it('la tabla tiene RLS activado', () => {
    expect(code).toMatch(/ALTER TABLE public\.exam_questions ENABLE ROW LEVEL SECURITY/);
  });
  it('NADIE escribe desde el navegador: se revoca todo y solo se concede SELECT', () => {
    expect(code).toContain('REVOKE ALL ON TABLE public.exam_questions FROM anon, authenticated;');
    expect(code).toContain('GRANT SELECT ON TABLE public.exam_questions TO authenticated;');
    expect(code.match(/GRANT [^;]+;/g)!.length).toBe(1);
    expect(code).not.toMatch(/CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/);
  });
  it('un ESTUDIANTE no tiene ninguna politica (la tabla tiene las claves): la unica politica es la del profesor dueño', () => {
    const policies = code.match(/CREATE POLICY \w+/g) ?? [];
    expect(policies).toEqual(['CREATE POLICY exam_questions_teacher_select']);
    expect(code).not.toMatch(/class_enrollments|student/i);
    const p = /CREATE POLICY exam_questions_teacher_select[\s\S]*?;\n/.exec(code)![0];
    expect(p).toContain('c.teacher_id = auth.uid()');
    expect(p).toContain('FOR SELECT');
  });
  it('las funciones no son SECURITY DEFINER y no se pueden llamar a mano', () => {
    expect(code).not.toMatch(/SECURITY DEFINER/i);
    expect(code).toContain('REVOKE ALL ON FUNCTION public.exam_questions_guard() FROM PUBLIC;');
    expect(code).toContain('REVOKE ALL ON FUNCTION public.exam_questions_content_immutable() FROM PUBLIC;');
    for (const f of code.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g) ?? []) expect(f).toContain('SET search_path = public, pg_temp');
  });
  it('es ADITIVA: no toca ninguna tabla existente ni borra nada', () => {
    expect(code).not.toMatch(/ALTER TABLE public\.(?!exam_questions\b)/);
    expect(code).not.toMatch(/\b(DROP TABLE|TRUNCATE|DELETE FROM|UPDATE public\.)/i);
    expect(code).not.toMatch(/INSERT INTO/i);
  });
  it('la guardia comprueba plan, estado, que el modulo ENSENE esa comprension, y que el material sea de la misma clase', () => {
    expect(code).toMatch(/IF bp\.status = 'archived' THEN\s*RAISE EXCEPTION/);
    expect(code).toContain("jsonb_path_exists(bp.doc, '$.periods[*].objectives[*] ? (@.modules[*].id == $nid && @.outcomeIds[*] == $oid)'");
    // los ids llegan como VARIABLES del jsonpath (no concatenados): no hay forma de inyectar en la consulta
    expect(code).toContain("jsonb_build_object('nid', NEW.node_id, 'oid', NEW.outcome_id)");
    expect(code).not.toMatch(/\|\| NEW\.(node_id|outcome_id)/);
    expect(code).toMatch(/IF NOT \(\s*CASE WHEN jsonb_typeof\(bp\.doc -> 'periods'\) = 'array'\s*THEN jsonb_path_exists[\s\S]*?ELSE false END\s*\) THEN\s*RAISE EXCEPTION/);
    expect(code).toMatch(/IF material_class IS DISTINCT FROM NEW\.classroom_id THEN\s*RAISE EXCEPTION/);
  });
  it('una pregunta nueva nace PENDIENTE (nadie la inserta aprobada)', () => {
    expect(code).toMatch(/IF NEW\.review_status <> 'pending' OR NEW\.reviewed_by IS NOT NULL THEN\s*RAISE EXCEPTION/);
    expect(code).toContain("review_status      text NOT NULL DEFAULT 'pending'");
  });
  it('el CONTENIDO (incluidas las claves, el material y el veredicto del juez) no se edita; solo la revision', () => {
    expect(code).toMatch(/CREATE TRIGGER exam_questions_content_immutable\s+BEFORE UPDATE/);
    const fn = /exam_questions_content_immutable\(\)[\s\S]*?\$\$;/.exec(code)![0];
    for (const col of ['q', 'opts', 'ok', 'answers', 'keywords', 'pairs', 'exp', 'source_material_id', 'source_chunk', 'source_quote', 'judge_verdict', 'judge_problems', 'outcome_id', 'node_id', 'type']) expect(fn).toContain(`NEW.${col}`);
    // la revision NO esta entre lo inmutable
    expect(fn).not.toContain('NEW.review_status');
    expect(fn).not.toContain('NEW.reviewed_at');
  });
  it('revisada <=> tiene fecha de revision', () => {
    expect(code).toContain("CHECK ((review_status = 'pending') = (reviewed_at IS NULL))");
  });
  it('la forma de la clave la exige la base segun el tipo, y los tipos son solo los que el servidor califica', () => {
    expect(code).toContain("CHECK (type IN ('multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'match'))");
    const shape = /exam_questions_key_shape CHECK \([\s\S]*?\n  \)\n\);/.exec(code)![0];
    for (const t of ['multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'match']) expect(shape).toContain(`WHEN '${t}'`);
    expect(shape).toContain('ELSE false');
    expect(shape).toContain('< jsonb_array_length(opts)');
  });
  it('explicacion de fondo y cita tienen largo minimo, y todo texto/jsonb esta acotado', () => {
    expect(code).toContain('CHECK (char_length(exp) BETWEEN 40 AND 1200)');
    expect(code).toContain('CHECK (char_length(source_quote) BETWEEN 25 AND 400)');
    expect(code).toContain('CHECK (char_length(q) BETWEEN 1 AND 600)');
    expect(code.match(/pg_column_size\(/g)!.length).toBeGreaterThanOrEqual(5);
  });
  it('los ids tienen el formato de parseBlueprint (sin caracteres raros)', () => {
    expect(code).toContain("CHECK (outcome_id ~ '^[A-Za-z0-9_-]{1,40}$')");
    expect(code).toContain("CHECK (node_id ~ '^[A-Za-z0-9_-]{1,40}$')");
  });
  it('un mismo enunciado no se guarda dos veces en un plan', () => {
    expect(code).toContain('CREATE UNIQUE INDEX IF NOT EXISTS exam_questions_unique_q ON public.exam_questions (blueprint_id, md5(q))');
  });
  it('si se borra el plan o el material, las preguntas se van con ellos (sin preguntas sin respaldo)', () => {
    expect(code).toContain('REFERENCES public.teaching_materials(id) ON DELETE CASCADE');
    expect(code).toContain('REFERENCES public.course_blueprints (id, classroom_id) ON DELETE CASCADE');
  });
});
