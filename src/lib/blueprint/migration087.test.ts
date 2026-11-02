import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'supabase/migrations');
const sql = fs.readFileSync(path.join(dir, '087_blueprint_module_links.sql'), 'utf8').replace(/\r\n/g, '\n');
// Sin comentarios: las reglas se comprueban sobre el SQL que se ejecuta, no sobre lo que dicen los comentarios.
const code = sql.replace(/^--.*$/gm, '');

// El comportamiento real de esta migracion se verifico contra la base de produccion DENTRO de una transaccion que se revirtio (15 comprobaciones: enlace valido, nodo inexistente,
// modulo de otra clase, repetidos, edicion, RLS de profesor / estudiante / no matriculado, plan archivado, cascada). Estas pruebas fijan lo que no debe cambiar sin volver a verificarlo.
describe('migracion 087 (enlace plan <-> modulos reales): seguridad', () => {
  it('es la siguiente despues de la 086', () => {
    const files = fs.readdirSync(dir).filter((f) => /^\d{3}_/.test(f)).sort();
    expect(files.indexOf('087_blueprint_module_links.sql')).toBe(files.indexOf('086_contraer_escrituras_de_estudiante.sql') + 1);
  });
  it('la tabla tiene RLS activado', () => {
    expect(code).toMatch(/ALTER TABLE public\.blueprint_module_links ENABLE ROW LEVEL SECURITY/);
  });
  it('NADIE escribe desde el navegador: se revoca todo y solo se concede SELECT', () => {
    expect(code).toContain('REVOKE ALL ON TABLE public.blueprint_module_links FROM anon, authenticated;');
    expect(code).toContain('GRANT SELECT ON TABLE public.blueprint_module_links TO authenticated;');
    expect(code.match(/GRANT [^;]+;/g)!.length).toBe(1);
    expect(code).not.toMatch(/CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/);
  });
  it('las funciones no son SECURITY DEFINER y no se pueden llamar a mano', () => {
    expect(code).not.toMatch(/SECURITY DEFINER/i);
    expect(code).toContain('REVOKE ALL ON FUNCTION public.blueprint_module_links_guard() FROM PUBLIC;');
    expect(code).toContain('REVOKE ALL ON FUNCTION public.blueprint_module_links_immutable() FROM PUBLIC;');
    for (const f of code.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g) ?? []) expect(f).toContain('SET search_path = public, pg_temp');
  });
  it('es ADITIVA: no toca ninguna tabla existente ni borra nada', () => {
    expect(code).not.toMatch(/ALTER TABLE public\.(?!blueprint_module_links\b)/);
    expect(code).not.toMatch(/\b(DROP TABLE|TRUNCATE|DELETE FROM|UPDATE public\.)/i);
    expect(code).not.toMatch(/INSERT INTO/i);
  });
  it('la guardia comprueba plan, estado, clase del modulo y existencia del nodo como MODULO', () => {
    expect(code).toContain("bp.status = 'archived'");
    expect(code).toContain('module_class IS DISTINCT FROM NEW.classroom_id');
    expect(code).toContain("jsonb_path_exists(bp.doc, '$.periods[*].objectives[*].modules[*] ? (@.id == $nid)'");
    // la comprobacion es incondicional: si el nodo no esta en el documento, se rechaza (no hay atajos como "IF false AND ...")
    expect(code).toMatch(/IF NOT \(\s*CASE WHEN jsonb_typeof\(bp\.doc -> 'periods'\) = 'array'\s*THEN jsonb_path_exists[\s\S]*?ELSE false END\s*\) THEN\s*RAISE EXCEPTION 'El modulo no existe en el plan'/);
    expect(code).toMatch(/IF module_class IS DISTINCT FROM NEW\.classroom_id THEN\s*RAISE EXCEPTION/);
    expect(code).toMatch(/IF bp\.status = 'archived' THEN\s*RAISE EXCEPTION/);
    // el id llega como VARIABLE del jsonpath (no concatenado): no hay forma de inyectar en la consulta
    expect(code).toContain("jsonb_build_object('nid', NEW.node_id)");
    expect(code).not.toMatch(/\|\| NEW\.node_id/);
  });
  it('un nodo, un modulo real, y el formato del id estan acotados', () => {
    expect(code).toContain('UNIQUE (blueprint_id, node_id)');
    expect(code).toContain('UNIQUE (blueprint_id, content_module_id)');
    expect(code).toContain("CHECK (node_id ~ '^[A-Za-z0-9_-]{1,40}$')");
  });
  it('si se borra el plan o el modulo real, el enlace se va con ellos (sin enlaces huerfanos)', () => {
    expect(code).toContain('REFERENCES public.content_modules(id) ON DELETE CASCADE');
    expect(code).toContain('REFERENCES public.course_blueprints (id, classroom_id) ON DELETE CASCADE');
  });
  it('un enlace no se edita', () => {
    expect(code).toMatch(/CREATE TRIGGER blueprint_module_links_immutable\s+BEFORE UPDATE/);
  });
  it('el estudiante solo ve enlaces de un plan PUBLICADO de una clase donde esta matriculado', () => {
    const p = /CREATE POLICY blueprint_module_links_student_select[\s\S]*?\);\n\n/.exec(code)![0];
    expect(p).toContain("b.status = 'published'");
    expect(p).toContain('class_enrollments');
    expect(p).toContain('ce.student_id = auth.uid()');
  });
});
