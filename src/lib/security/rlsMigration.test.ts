import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Guarda de la migracion 051. El comportamiento real (un estudiante que intenta subirse a profesor, crear
// clases o subir materiales a la clase de otro) se verifico en produccion con una simulacion dentro de una
// transaccion revertida, porque solo la base real aplica el RLS. Esto evita que alguien quite las defensas.
const raw = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/051_security_role_and_ownership.sql'), 'utf8').replace(/\r\n/g, '\n');
// Sin comentarios: la historia de la migracion menciona la politica vieja (FOR ALL) y no debe contar como uso.
const sql = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('migracion 051: rol y propiedad', () => {
  it('el rol no se puede cambiar con la sesion de un usuario, pero si desde una funcion de confianza', () => {
    expect(sql).toContain('BEFORE UPDATE OF role ON public.profiles');
    expect(sql).toMatch(/current_user IN \('authenticated', 'anon'\)/);
    // current_user (no auth.uid()): dentro de una funcion SECURITY DEFINER auth.uid() sigue siendo el usuario.
    expect(sql).not.toMatch(/IF[^;]*auth\.uid\(\)[^;]*RAISE/);
  });

  it('solo un profesor o admin crea clases; ver, editar y borrar siguen siendo del dueño', () => {
    expect(sql).toMatch(/Solo profesores crean clases[\s\S]*role IN \('teacher', 'admin'\)/);
    expect(sql).not.toMatch(/FOR ALL/);
    for (const cmd of ['SELECT', 'UPDATE', 'DELETE']) expect(sql).toContain(`FOR ${cmd} USING (teacher_id = auth.uid())`);
  });

  it('un material solo se inserta o actualiza en una clase PROPIA', () => {
    const own = /EXISTS \(SELECT 1 FROM public\.classrooms c WHERE c\.id = classroom_id AND c\.teacher_id = auth\.uid\(\)\)/g;
    expect(sql.match(own)!.length).toBe(2); // INSERT y UPDATE (WITH CHECK)
  });
});
