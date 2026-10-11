import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { INVITE_EXPLANATION, PENDING_ROW_NOTE } from './constants';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const DIR = 'src/app/(teacher)/teacher/classrooms/[id]/students/';

// La app no envia correos y el registro es por invitacion del administrador: la pantalla debe decirlo y no prometer
// lo contrario ("se inscribiran automaticamente cuando hagan signup", "inmediato").
describe('textos de invitaciones: dicen la verdad', () => {
  it('la explicacion aclara que no se envian correos y que el registro lo autoriza el administrador', () => {
    expect(INVITE_EXPLANATION).toMatch(/no envía correos/);
    expect(INVITE_EXPLANATION).toMatch(/administrador/);
    expect(PENDING_ROW_NOTE).toMatch(/abrir su inicio/);
  });

  it('el formulario y la lista de pendientes usan esos textos y no prometen lo anterior', () => {
    const form = read(DIR + 'InviteStudentsForm.tsx');
    const page = read(DIR + 'page.tsx');
    expect(form).toContain('{INVITE_EXPLANATION}');
    expect(form).toContain('Nadie recibió un correo');
    expect(page).toContain('{PENDING_ROW_NOTE}');
    for (const src of [form, page]) {
      expect(src).not.toContain('automáticamente cuando hagan signup');
      expect(src).not.toContain('Pendientes de signup');
    }
  });
});
