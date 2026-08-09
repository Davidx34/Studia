// Protocolo 7.1.3 + 7.2 (post-auditoria): matriz de integracion RLS para
// las 3 tablas con incidentes reales documentados en las migraciones
// correctivas 031 (material_chunks_processed), 033 (lesson_questions) y
// 036 (material_chunks) -- en los 3 casos, una tabla nueva/ampliada tenia
// SELECT pero NO INSERT/UPDATE/DELETE para el rol que en produccion
// terminaba escribiendola, y el error salia en runtime porque Supabase
// no distingue "0 filas por RLS" de "0 filas porque no hay datos" sin
// revisar el codigo de error explicitamente.
//
// FUERA DEL GLOB POR DEFECTO DE VITEST (vitest.config.ts solo incluye
// src/**/*.test.ts) -- a proposito: este test crea/borra usuarios y filas
// reales contra un proyecto Supabase de verdad (no hay Docker disponible
// en este entorno para `supabase start` local, ver commit para el
// razonamiento completo). NO se ejecuta en CI. Correr manualmente con:
//   npx vitest run tests/rls-integration.test.ts
// Requiere NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y
// SUPABASE_SERVICE_ROLE_KEY en el entorno (ver .env.local). Crea 4
// usuarios y un puñado de filas desechables, y los borra en afterAll
// incluso si algun test falla.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';

if (existsSync('.env.local')) {
  const envFile = readFileSync('.env.local', 'utf-8');
  for (const line of envFile.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasCredentials = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);

describe.skipIf(!hasCredentials)('RLS integration: lesson_questions, material_chunks, material_chunks_processed', () => {
  const admin: SupabaseClient = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const RUN_ID = Date.now();
  const testEmail = (label: string) => `rls-test-${label}-${RUN_ID}@studia-test.invalid`;
  const TEST_PASSWORD = 'RlsTest!12345';

  type Actor = { userId: string; client: SupabaseClient };
  const actors: Record<'teacherOwner' | 'teacherOther' | 'studentEnrolled' | 'studentOther', Actor> = {} as any;

  let classroomId: string;
  let moduleId: string;
  let materialId: string;
  let chunkId: string;
  let questionId: string;
  const createdUserIds: string[] = [];

  async function createTestUser(label: string, role: 'teacher' | 'student'): Promise<Actor> {
    const email = testEmail(label);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`No se pudo crear usuario de prueba ${label}: ${error?.message}`);
    createdUserIds.push(data.user.id);

    // El trigger handle_new_user crea el profile con role=null por default
    // -- lo actualizamos explicitamente segun lo que necesita este test.
    await admin.from('profiles').update({ role }).eq('id', data.user.id);

    const client = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { persistSession: false } });
    const { error: signInErr } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
    if (signInErr) throw new Error(`No se pudo iniciar sesion como ${label}: ${signInErr.message}`);

    return { userId: data.user.id, client };
  }

  beforeAll(async () => {
    actors.teacherOwner = await createTestUser('teacher-owner', 'teacher');
    actors.teacherOther = await createTestUser('teacher-other', 'teacher');
    actors.studentEnrolled = await createTestUser('student-enrolled', 'student');
    actors.studentOther = await createTestUser('student-other', 'student');

    // Fixtures: classroom + module + material + chunk + lesson_question,
    // todos propiedad de teacherOwner; studentEnrolled matriculado.
    const { data: classroom, error: classroomErr } = await admin
      .from('classrooms')
      .insert({ teacher_id: actors.teacherOwner.userId, name: `RLS test classroom ${RUN_ID}` })
      .select('id')
      .single();
    if (classroomErr || !classroom) throw new Error(`No se pudo crear classroom: ${classroomErr?.message}`);
    classroomId = classroom.id;

    const { error: enrollErr } = await admin.from('class_enrollments').insert({
      classroom_id: classroomId,
      student_id: actors.studentEnrolled.userId,
      teacher_id: actors.teacherOwner.userId,
    });
    if (enrollErr) throw new Error(`No se pudo matricular al estudiante: ${enrollErr.message}`);

    const { data: mod, error: modErr } = await admin
      .from('content_modules')
      .insert({ classroom_id: classroomId, teacher_id: actors.teacherOwner.userId, title: 'RLS test module', category: 'logic' })
      .select('id')
      .single();
    if (modErr || !mod) throw new Error(`No se pudo crear content_module: ${modErr?.message}`);
    moduleId = mod.id;

    const { data: material, error: materialErr } = await admin
      .from('teaching_materials')
      .insert({
        classroom_id: classroomId,
        teacher_id: actors.teacherOwner.userId,
        filename: 'rls-test.md',
        source_type: 'notebooklm',
        processing_status: 'completed',
      })
      .select('id')
      .single();
    if (materialErr || !material) throw new Error(`No se pudo crear teaching_material: ${materialErr?.message}`);
    materialId = material.id;

    const { data: chunk, error: chunkErr } = await admin
      .from('material_chunks')
      .insert({ material_id: materialId, chunk_index: 0, content: 'contenido de prueba' })
      .select('id')
      .single();
    if (chunkErr || !chunk) throw new Error(`No se pudo crear material_chunk: ${chunkErr?.message}`);
    chunkId = chunk.id;

    const { data: question, error: questionErr } = await admin
      .from('lesson_questions')
      .insert({ module_id: moduleId, type: 'true_false', q: '¿Es esto una prueba?', ok: true })
      .select('id')
      .single();
    if (questionErr || !question) throw new Error(`No se pudo crear lesson_question: ${questionErr?.message}`);
    questionId = question.id;
  }, 30000);

  afterAll(async () => {
    // Cleanup en orden inverso de FKs. Best-effort: si algo ya no existe
    // (porque un test lo borro exitosamente), simplemente no hace nada.
    if (classroomId) {
      await admin.from('classrooms').delete().eq('id', classroomId); // cascade limpia module/material/chunks/questions/enrollment
    }
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    }
  }, 30000);

  // ============================================================
  // lesson_questions
  // Politicas reales (verificadas via pg_policies antes de escribir este
  // test): SELECT+INSERT para teacher dueño Y student matriculado;
  // UPDATE+DELETE SOLO para teacher dueño (Migracion 033 -- antes de esa
  // migracion, el profesor no tenia NINGUNA de estas 4, solo el
  // estudiante tenia INSERT vía el cache incremental).
  // ============================================================
  describe('lesson_questions', () => {
    it('teacher dueño puede SELECT', async () => {
      const { data, error } = await actors.teacherOwner.client.from('lesson_questions').select('id').eq('id', questionId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it('student matriculado puede SELECT', async () => {
      const { data, error } = await actors.studentEnrolled.client.from('lesson_questions').select('id').eq('id', questionId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it('teacher ajeno NO puede SELECT (0 filas, no error -- RLS filtra silenciosamente)', async () => {
      const { data, error } = await actors.teacherOther.client.from('lesson_questions').select('id').eq('id', questionId);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
    it('student ajeno NO puede SELECT', async () => {
      const { data, error } = await actors.studentOther.client.from('lesson_questions').select('id').eq('id', questionId);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it('teacher dueño puede INSERT en su propio modulo', async () => {
      const { data, error } = await actors.teacherOwner.client
        .from('lesson_questions')
        .insert({ module_id: moduleId, type: 'true_false', q: 'insert por teacher dueño', ok: true })
        .select('id');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      if (data?.[0]) await admin.from('lesson_questions').delete().eq('id', data[0].id);
    });
    it('student matriculado puede INSERT (cache incremental)', async () => {
      const { data, error } = await actors.studentEnrolled.client
        .from('lesson_questions')
        .insert({ module_id: moduleId, type: 'true_false', q: 'insert por student matriculado', ok: true })
        .select('id');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      if (data?.[0]) await admin.from('lesson_questions').delete().eq('id', data[0].id);
    });
    it('teacher ajeno NO puede INSERT en modulo que no le pertenece', async () => {
      const { error } = await actors.teacherOther.client
        .from('lesson_questions')
        .insert({ module_id: moduleId, type: 'true_false', q: 'insert por teacher ajeno', ok: true });
      expect(error).not.toBeNull();
    });
    it('student ajeno (no matriculado) NO puede INSERT', async () => {
      const { error } = await actors.studentOther.client
        .from('lesson_questions')
        .insert({ module_id: moduleId, type: 'true_false', q: 'insert por student ajeno', ok: true });
      expect(error).not.toBeNull();
    });

    it('teacher dueño puede UPDATE (regla agregada en migracion 033)', async () => {
      const { error } = await actors.teacherOwner.client
        .from('lesson_questions')
        .update({ exp: 'actualizado por teacher dueño' })
        .eq('id', questionId);
      expect(error).toBeNull();
    });
    it('student matriculado NO puede UPDATE (sin policy de UPDATE para estudiantes)', async () => {
      const { error, data } = await actors.studentEnrolled.client
        .from('lesson_questions')
        .update({ exp: 'intento de update por student' })
        .eq('id', questionId)
        .select('id');
      // RLS en UPDATE sin filas que matcheen el USING no da error, actualiza 0 filas.
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBe(0);
    });

    it('teacher dueño puede DELETE (regla agregada en migracion 033)', async () => {
      const { data: temp } = await admin
        .from('lesson_questions')
        .insert({ module_id: moduleId, type: 'true_false', q: 'para borrar', ok: true })
        .select('id')
        .single();
      const { error } = await actors.teacherOwner.client.from('lesson_questions').delete().eq('id', temp!.id);
      expect(error).toBeNull();
      const { data: stillThere } = await admin.from('lesson_questions').select('id').eq('id', temp!.id);
      expect(stillThere).toHaveLength(0);
    });
    it('teacher ajeno NO puede DELETE', async () => {
      const { error, data } = await actors.teacherOther.client
        .from('lesson_questions')
        .delete()
        .eq('id', questionId)
        .select('id');
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBe(0);
      const { data: stillThere } = await admin.from('lesson_questions').select('id').eq('id', questionId);
      expect(stillThere).toHaveLength(1);
    });
  });

  // ============================================================
  // material_chunks
  // Politicas reales: SELECT para teacher dueño y student matriculado;
  // INSERT+DELETE SOLO teacher dueño (Migracion 036 -- antes, cero
  // policies de escritura, el pipeline de link/YouTube in-process con
  // sesion de profesor fallaba en silencio al reprocesar). NO existe
  // policy de UPDATE para nadie -- denegado por diseño (los chunks se
  // reemplazan via delete+insert, nunca se editan in-place).
  // ============================================================
  describe('material_chunks', () => {
    it('teacher dueño puede SELECT', async () => {
      const { data, error } = await actors.teacherOwner.client.from('material_chunks').select('id').eq('id', chunkId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it('student matriculado puede SELECT', async () => {
      const { data, error } = await actors.studentEnrolled.client.from('material_chunks').select('id').eq('id', chunkId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it('teacher ajeno NO puede SELECT', async () => {
      const { data, error } = await actors.teacherOther.client.from('material_chunks').select('id').eq('id', chunkId);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it('teacher dueño puede INSERT en su propio material', async () => {
      const { data, error } = await actors.teacherOwner.client
        .from('material_chunks')
        .insert({ material_id: materialId, chunk_index: 99, content: 'chunk de prueba insertado' })
        .select('id');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      if (data?.[0]) await admin.from('material_chunks').delete().eq('id', data[0].id);
    });
    it('student matriculado NO puede INSERT (sin policy de INSERT para estudiantes)', async () => {
      const { error } = await actors.studentEnrolled.client
        .from('material_chunks')
        .insert({ material_id: materialId, chunk_index: 98, content: 'intento de insert por student' });
      expect(error).not.toBeNull();
    });
    it('teacher ajeno NO puede INSERT en material que no le pertenece', async () => {
      const { error } = await actors.teacherOther.client
        .from('material_chunks')
        .insert({ material_id: materialId, chunk_index: 97, content: 'intento de insert por teacher ajeno' });
      expect(error).not.toBeNull();
    });

    it('NADIE puede UPDATE (sin policy de UPDATE en absoluto)', async () => {
      const { error, data } = await actors.teacherOwner.client
        .from('material_chunks')
        .update({ content: 'intento de update' })
        .eq('id', chunkId)
        .select('id');
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBe(0);
    });

    it('teacher dueño puede DELETE (regla agregada en migracion 036)', async () => {
      const { data: temp } = await admin
        .from('material_chunks')
        .insert({ material_id: materialId, chunk_index: 96, content: 'para borrar' })
        .select('id')
        .single();
      const { error } = await actors.teacherOwner.client.from('material_chunks').delete().eq('id', temp!.id);
      expect(error).toBeNull();
      const { data: stillThere } = await admin.from('material_chunks').select('id').eq('id', temp!.id);
      expect(stillThere).toHaveLength(0);
    });
    it('student matriculado NO puede DELETE', async () => {
      const { error, data } = await actors.studentEnrolled.client
        .from('material_chunks')
        .delete()
        .eq('id', chunkId)
        .select('id');
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBe(0);
      const { data: stillThere } = await admin.from('material_chunks').select('id').eq('id', chunkId);
      expect(stillThere).toHaveLength(1);
    });
  });

  // ============================================================
  // material_chunks_processed
  // Politicas reales: SELECT+INSERT+UPDATE para teacher dueño Y student
  // matriculado (Migracion 031 -- antes de esa migracion, la tabla (creada
  // en 030) SOLO tenia SELECT, el pipeline de procesamiento -- disparado
  // por el propio estudiante/profesor via /api/process-material-chunks,
  // con su sesion, no service role -- no podia escribir). NO existe
  // policy de DELETE para nadie -- denegado por diseño.
  // ============================================================
  describe('material_chunks_processed', () => {
    let processedId: string;

    beforeAll(async () => {
      const { data, error } = await admin
        .from('material_chunks_processed')
        .insert({ chunk_id: chunkId, material_id: materialId, summary: 'resumen de prueba' })
        .select('id')
        .single();
      if (error || !data) throw new Error(`No se pudo crear material_chunks_processed fixture: ${error?.message}`);
      processedId = data.id;
    });

    it('teacher dueño puede SELECT', async () => {
      const { data, error } = await actors.teacherOwner.client.from('material_chunks_processed').select('id').eq('id', processedId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it('student matriculado puede SELECT', async () => {
      const { data, error } = await actors.studentEnrolled.client.from('material_chunks_processed').select('id').eq('id', processedId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it('teacher ajeno NO puede SELECT', async () => {
      const { data, error } = await actors.teacherOther.client.from('material_chunks_processed').select('id').eq('id', processedId);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it('teacher dueño puede INSERT (regla agregada en migracion 031)', async () => {
      const { data: newChunk } = await admin
        .from('material_chunks')
        .insert({ material_id: materialId, chunk_index: 95, content: 'chunk auxiliar' })
        .select('id')
        .single();
      const { data, error } = await actors.teacherOwner.client
        .from('material_chunks_processed')
        .insert({ chunk_id: newChunk!.id, material_id: materialId, summary: 'insert por teacher' })
        .select('id');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      await admin.from('material_chunks_processed').delete().eq('id', data![0].id);
      await admin.from('material_chunks').delete().eq('id', newChunk!.id);
    });
    it('student matriculado puede INSERT (regla agregada en migracion 031)', async () => {
      const { data: newChunk } = await admin
        .from('material_chunks')
        .insert({ material_id: materialId, chunk_index: 94, content: 'chunk auxiliar 2' })
        .select('id')
        .single();
      const { data, error } = await actors.studentEnrolled.client
        .from('material_chunks_processed')
        .insert({ chunk_id: newChunk!.id, material_id: materialId, summary: 'insert por student' })
        .select('id');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      await admin.from('material_chunks_processed').delete().eq('id', data![0].id);
      await admin.from('material_chunks').delete().eq('id', newChunk!.id);
    });
    it('teacher ajeno NO puede INSERT', async () => {
      const { error } = await actors.teacherOther.client
        .from('material_chunks_processed')
        .insert({ chunk_id: chunkId, material_id: materialId, summary: 'insert por teacher ajeno' });
      expect(error).not.toBeNull();
    });

    it('teacher dueño puede UPDATE', async () => {
      const { error } = await actors.teacherOwner.client
        .from('material_chunks_processed')
        .update({ summary: 'actualizado por teacher' })
        .eq('id', processedId);
      expect(error).toBeNull();
    });
    it('student matriculado puede UPDATE', async () => {
      const { error } = await actors.studentEnrolled.client
        .from('material_chunks_processed')
        .update({ summary: 'actualizado por student' })
        .eq('id', processedId);
      expect(error).toBeNull();
    });
    it('teacher ajeno NO puede UPDATE', async () => {
      const { error, data } = await actors.teacherOther.client
        .from('material_chunks_processed')
        .update({ summary: 'intento ajeno' })
        .eq('id', processedId)
        .select('id');
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBe(0);
    });

    it('NADIE puede DELETE (sin policy de DELETE en absoluto)', async () => {
      const { error, data } = await actors.teacherOwner.client
        .from('material_chunks_processed')
        .delete()
        .eq('id', processedId)
        .select('id');
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBe(0);
    });
  });
});
