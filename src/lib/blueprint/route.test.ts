import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// La ruta no se ejecuta aqui (necesita Next y Supabase): se comprueba su CABLEADO, que es lo que la hace segura. La logica de guardar y publicar esta probada en store.test.ts.
const route = readFileSync(join(process.cwd(), 'src/app/api/blueprint/route.ts'), 'utf8');
const idx = (s: string) => route.indexOf(s);

describe('/api/blueprint: cableado', () => {
  it('pide sesion y es el DUEÑO de la clase (si no, 401 / 404) ANTES de usar la llave de servicio', () => {
    expect(route).toContain("if (!user) return fail(401, 'No autenticado');");
    expect(route).toContain(".eq('teacher_id', user.id)");
    expect(route).toContain("if (!classroom) return fail(404, 'Clase no encontrada');");
    expect(idx("fail(401")).toBeLessThan(idx('createAdminSupabase()'));
    expect(idx("fail(404, 'Clase no encontrada')")).toBeLessThan(idx('createAdminSupabase()'));
  });
  it('el dueño sale de la sesion, nunca del cuerpo', () => {
    expect(route).toContain('teacherId: user.id');
    expect(route).not.toMatch(/body\??\.teacherId|body\??\.teacher_id/);
  });
  it('valida accion e id de clase y limita el cuerpo antes de tocar nada', () => {
    expect(route).toContain("if (action !== 'save' && action !== 'publish') return fail(400, 'accion invalida');");
    expect(route).toContain("if (!UUID_RE.test(classroomId)) return fail(400, 'classroomId invalido');");
    expect(route).toContain('if (text.length > MAX_BODY_CHARS) return fail(413');
    expect(idx('MAX_BODY_CHARS)')).toBeLessThan(idx('JSON.parse'));
    expect(idx('JSON.parse')).toBeLessThan(idx('createServerSupabase()'));
  });
  it('guarda y publica solo con las funciones validadas de store.ts, no escribe tablas por su cuenta', () => {
    expect(route).toContain('saveDraft(db, { classroomId, teacherId: user.id }, body?.blueprint)');
    expect(route).toContain('publishDraft(db, { classroomId })');
    expect(route).not.toMatch(/\.from\(['"]course_blueprints['"]\)/);
  });
  it('un error inesperado responde generico, sin filtrar el mensaje de la base', () => {
    expect(route).toContain("return fail(500, 'Error inesperado.');");
    expect(route).not.toMatch(/fail\(500,[^)]*\be\b/);
  });
  it('sin llave de servicio responde 503 con el motivo, no revienta', () => {
    expect(route).toContain('if (!hasServiceRoleKey()) return fail(503, MISSING_SERVICE_KEY_MESSAGE);');
  });
});
