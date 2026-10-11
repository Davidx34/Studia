import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { extractYoutubeId, isSafeCaptionUrl } from '@/lib/materials/processYoutube';

// Guarda de la migracion 058. El comportamiento real (anon intentando volcar perfiles o auto-invitarse como
// profesor, un estudiante tocando la racha o los logros de otro) se verifico en produccion con una simulacion en
// transaccion revertida, porque solo la base real aplica EXECUTE y RLS. Esto evita que alguien quite las defensas.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const sql = read('supabase/migrations/058_security_rpc_exposure.sql')
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');

describe('migracion 058: funciones expuestas', () => {
  it('las funciones dev_* solo las ejecuta service_role', () => {
    for (const fn of ['dev_add_pending_registration(text, text)', 'dev_analytics_summary()', 'dev_delete_pending_registration(uuid)', 'dev_list_pending_registrations()', 'dev_list_recent_profiles(integer)']) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`);
    }
  });

  it('racha, corazones y logros exigen ser ese usuario (o service_role) y las originales quedan cerradas', () => {
    expect(sql.match(/IF auth\.role\(\) IS DISTINCT FROM 'service_role' AND p_user_id IS DISTINCT FROM auth\.uid\(\) THEN/g)!.length).toBe(3);
    for (const impl of ['_check_and_update_streak_impl', '_recover_hearts_impl', '_evaluate_achievements_impl']) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${impl}(uuid) FROM PUBLIC, anon, authenticated;`);
    }
    // current_user dentro de SECURITY DEFINER es el dueño: no sirve para saber quien llama.
    expect(sql).not.toMatch(/current_user/);
  });

  it('la cache de lecciones es del profesor de la clase; los fragmentos, de profesor o inscritos', () => {
    expect(sql).toMatch(/invalidate_lesson_cache[\s\S]*c\.teacher_id = auth\.uid\(\)/);
    expect(sql.match(/ce\.student_id = auth\.uid\(\)/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('ninguna de esas funciones queda con EXECUTE anonimo (check_pending_registration se mantiene: el registro por invitacion la usa sin sesion)', () => {
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*\bTO\b[^;]*\banon\b/);
    expect(sql).not.toContain('check_pending_registration');
  });

  it('la inscripcion directa del estudiante se elimina y el profesor solo inscribe en su clase firmando como el', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "Students pueden inscribirse" ON public.class_enrollments;');
    expect(sql).toMatch(/Profesor inscribe en su clase[\s\S]*teacher_id = auth\.uid\(\)[\s\S]*c\.teacher_id = auth\.uid\(\)/);
  });

  it('el panel /dev llama las funciones con la llave de servicio (no con la anon, que es publica)', () => {
    for (const f of ['analytics/route.ts', 'pending-registrations/route.ts', 'pending-registrations/[id]/route.ts', 'system-health/route.ts']) {
      const src = read(`src/app/api/dev/${f}`);
      expect(src).toContain('createAdminSupabase');
      expect(src).not.toContain('createAnonSupabase');
    }
    expect(fs.existsSync(path.join(process.cwd(), 'src/lib/supabase/anon.ts'))).toBe(false);
  });
});

describe('YouTube: el servidor solo consulta youtube.com', () => {
  it('rechaza hosts que solo CONTIENEN "youtube.com"', () => {
    for (const u of [
      'https://youtube.com.atacante.net/watch?v=dQw4w9WgXcQ',
      'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
      'https://evil.com/youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com@evil.com/watch?v=dQw4w9WgXcQ',
    ]) {
      expect(extractYoutubeId(u)).toBeNull();
    }
  });

  it('acepta los hosts legitimos', () => {
    expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('el ID debe tener el formato real (11 caracteres seguros)', () => {
    expect(extractYoutubeId('https://www.youtube.com/watch?v=../../etc/passwd')).toBeNull();
    expect(extractYoutubeId('https://www.youtube.com/watch?v=abc')).toBeNull();
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ&x=1')).toBeNull();
    expect(extractYoutubeId('javascript:alert(1)')).toBeNull();
    expect(extractYoutubeId('ftp://youtu.be/dQw4w9WgXcQ')).toBeNull();
  });

  it('los subtitulos solo se descargan de youtube.com por https', () => {
    expect(isSafeCaptionUrl('https://www.youtube.com/api/timedtext?v=x&lang=es')).toBe(true);
    for (const u of ['http://www.youtube.com/api/timedtext', 'https://169.254.169.254/latest/meta-data', 'https://localhost/x', 'https://youtube.com.evil.net/x', 'https://user:pw@www.youtube.com/x', 'https://www.youtube.com:8443/x', 'file:///etc/passwd', 'no es url']) {
      expect(isSafeCaptionUrl(u)).toBe(false);
    }
  });
});
