import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'supabase/migrations');
const sql = fs.readFileSync(path.join(dir, '085_course_blueprints.sql'), 'utf8').replace(/\r\n/g, '\n');
// Sin comentarios: las reglas se comprueban sobre el SQL que se ejecuta, no sobre lo que dicen los comentarios.
const code = sql.replace(/^--.*$/gm, '');

describe('migracion 085 (plan del curso por cortes): seguridad', () => {
  it('es la siguiente despues de la 084', () => {
    const files = fs.readdirSync(dir).filter((f) => /^\d{3}_/.test(f)).sort();
    expect(files.indexOf('085_course_blueprints.sql')).toBe(files.indexOf('084_finish_lesson.sql') + 1);
  });
  it('las dos tablas tienen RLS activado', () => {
    expect(code).toMatch(/ALTER TABLE public\.course_blueprints ENABLE ROW LEVEL SECURITY/);
    expect(code).toMatch(/ALTER TABLE public\.exam_attempts ENABLE ROW LEVEL SECURITY/);
  });
  it('NADIE escribe desde el navegador: se revoca todo y solo se concede SELECT', () => {
    for (const t of ['course_blueprints', 'exam_attempts']) {
      expect(code).toContain(`REVOKE ALL ON TABLE public.${t} FROM anon, authenticated;`);
      expect(code).toContain(`GRANT SELECT ON TABLE public.${t} TO authenticated;`);
    }
    const grants = code.match(/GRANT [^;]+;/g) ?? [];
    expect(grants.length).toBe(2);
    for (const g of grants) {
      expect(g, g).toMatch(/^GRANT SELECT ON TABLE/);
      expect(g).not.toMatch(/\banon\b|PUBLIC/);
    }
  });
  it('ninguna politica de escritura (ni INSERT, ni UPDATE, ni DELETE, ni ALL): solo SELECT', () => {
    const policies = code.match(/CREATE POLICY [\s\S]*?;/g) ?? [];
    expect(policies.length).toBe(4);
    for (const p of policies) {
      expect(p, p).toMatch(/FOR SELECT/);
      expect(p).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
    }
  });
  it('el estudiante solo ve planes PUBLICADOS de clases donde esta matriculado, y solo sus intentos', () => {
    const student = code.match(/CREATE POLICY course_blueprints_student_select[\s\S]*?;/)![0];
    expect(student).toContain("status = 'published'");
    expect(student).toContain('class_enrollments');
    expect(student).toContain('ce.student_id = auth.uid()');
    expect(code.match(/CREATE POLICY exam_attempts_student_select[\s\S]*?;/)![0]).toContain('student_id = auth.uid()');
  });
  it('el profesor solo ve lo de las clases de las que es dueño', () => {
    for (const name of ['course_blueprints_teacher_select', 'exam_attempts_teacher_select']) {
      const p = code.match(new RegExp(`CREATE POLICY ${name}[\\s\\S]*?;`))![0];
      expect(p).toContain('c.teacher_id = auth.uid()');
    }
  });
  it('sin SECURITY DEFINER (nada se ejecuta con privilegios de otro) y toda funcion fija su search_path', () => {
    expect(code).not.toMatch(/SECURITY DEFINER/i);
    const fns = code.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g) ?? [];
    expect(fns.length).toBe(3);
    for (const f of fns) expect(f, f.slice(0, 80)).toContain('SET search_path = public, pg_temp');
  });
  it('las funciones no quedan ejecutables por PUBLIC', () => {
    for (const f of ['course_blueprints_guard', 'exam_attempts_before_insert', 'exam_attempts_immutable']) {
      expect(code).toContain(`REVOKE ALL ON FUNCTION public.${f}() FROM PUBLIC;`);
    }
  });
  it('es ADITIVA: no modifica ni borra ninguna tabla existente', () => {
    expect(code).not.toMatch(/ALTER TABLE\s+(?!public\.(course_blueprints|exam_attempts)\b)/i);
    expect(code).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|UPDATE public\./i);
    // los unicos DROP son de objetos propios (triggers y politicas de esta migracion) para que sea re-ejecutable
    for (const d of code.match(/DROP [A-Z]+ IF EXISTS [^\s]+/g) ?? []) expect(d).toMatch(/DROP (TRIGGER|POLICY) IF EXISTS (course_blueprints_|exam_attempts_)/);
  });
});

describe('migracion 085: integridad', () => {
  it('el plan: tipo y tamaño del documento, version coherente, un borrador y un publicado por clase', () => {
    expect(code).toContain("jsonb_typeof(doc) = 'object' AND pg_column_size(doc) < 400000");
    expect(code).toContain("CHECK (CASE WHEN jsonb_typeof(doc -> 'version') = 'number' THEN (doc ->> 'version')::numeric = version ELSE false END)");
    expect(code).toMatch(/UNIQUE INDEX IF NOT EXISTS course_blueprints_one_draft ON public\.course_blueprints \(classroom_id\) WHERE status = 'draft'/);
    expect(code).toMatch(/UNIQUE INDEX IF NOT EXISTS course_blueprints_one_published ON public\.course_blueprints \(classroom_id\) WHERE status = 'published'/);
    expect(code).toContain('UNIQUE (classroom_id, version)');
    expect(code).toContain("(status = 'draft') = (published_at IS NULL)");
  });
  it('un plan publicado no se edita, y solo hay transiciones borrador -> publicado -> archivado', () => {
    const fn = code.match(/FUNCTION public\.course_blueprints_guard\(\)[\s\S]*?\$\$;/)![0];
    expect(fn).toContain("OLD.status <> 'draft' AND NEW.doc IS DISTINCT FROM OLD.doc");
    expect(fn).toContain("(OLD.status = 'draft' AND NEW.status = 'published')");
    expect(fn).toContain("(OLD.status = 'published' AND NEW.status = 'archived')");
    // y NINGUNA otra: un plan archivado no vuelve a publicarse ni un publicado a borrador
    expect(fn.match(/OLD\.status = '[a-z]+' AND NEW\.status = '[a-z]+'/g)).toHaveLength(2);
    expect(fn).not.toContain("OLD.status = 'archived'");
    expect(fn).toContain('NEW.classroom_id <> OLD.classroom_id OR NEW.teacher_id <> OLD.teacher_id OR NEW.version <> OLD.version');
    expect(code).toMatch(/CREATE TRIGGER course_blueprints_guard\s+BEFORE UPDATE ON public\.course_blueprints/);
  });
  it('el intento apunta a (plan, clase) y la base garantiza que son de la misma clase', () => {
    expect(code).toContain('CONSTRAINT course_blueprints_id_class UNIQUE (id, classroom_id)');
    expect(code).toContain('FOREIGN KEY (blueprint_id, classroom_id) REFERENCES public.course_blueprints (id, classroom_id) ON DELETE CASCADE');
    expect(code).toContain('student_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE');
  });
  it('la nota del intento es 0-100, el tipo es period/final y la final no lleva corte', () => {
    expect(code).toContain('score_percent  numeric(5, 2) NOT NULL CHECK (score_percent >= 0 AND score_percent <= 100)');
    expect(code).toContain("CHECK (kind IN ('period', 'final'))");
    expect(code).toContain("CONSTRAINT exam_attempts_kind_period CHECK ((kind = 'final') = (period_id IS NULL))");
    expect(code).toContain("period_id ~ '^[A-Za-z0-9_-]{1,40}$'");
  });
  it('un intento solo entra con el plan publicado, el estudiante matriculado y el corte existente', () => {
    const fn = code.match(/FUNCTION public\.exam_attempts_before_insert\(\)[\s\S]*?\$\$;/)![0];
    expect(fn).toContain("bp.status <> 'published'");
    expect(fn).toContain('class_enrollments');
    expect(fn).toContain("jsonb_typeof(bp.doc -> 'periods') = 'array'");
    expect(fn).toContain("p ->> 'id' = NEW.period_id");
    expect(fn).toContain("IF NEW.kind = 'period' AND NOT ("); // la comprobacion esta activa
    expect(fn).toContain('IF NOT EXISTS (SELECT 1 FROM public.class_enrollments ce WHERE ce.classroom_id = NEW.classroom_id AND ce.student_id = NEW.student_id) THEN');
    expect(fn).toContain("IF NOT FOUND OR bp.status <> 'published' THEN");
  });
  it('el numero de intento lo asigna la base bajo un candado, es unico y una evaluacion dominada no se repite', () => {
    const fn = code.match(/FUNCTION public\.exam_attempts_before_insert\(\)[\s\S]*?\$\$;/)![0];
    expect(fn).toContain('pg_advisory_xact_lock');
    expect(fn).toContain('NEW.attempt_number := last_n + 1');
    expect(fn).toContain('bool_or(score_percent >= 100)');
    expect(fn).toMatch(/IF mastered THEN\s+RAISE EXCEPTION 'La evaluacion ya se domino/);
    expect(fn).toContain('period_id IS NOT DISTINCT FROM NEW.period_id');
    expect(code).toContain("(blueprint_id, student_id, kind, COALESCE(period_id, ''), attempt_number)");
  });
  it('los intentos son un historial: un UPDATE se rechaza (el borrado en cascada sigue funcionando)', () => {
    expect(code).toMatch(/CREATE TRIGGER exam_attempts_immutable\s+BEFORE UPDATE ON public\.exam_attempts/);
    expect(code).not.toMatch(/BEFORE (UPDATE OR DELETE|DELETE)/);
  });
  it('el literal 100 % del mensaje esta escapado para RAISE (%%)', () => {
    expect(code).toContain("'La evaluacion ya se domino (100 %%): no se repite'");
  });
});
