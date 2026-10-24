import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Guarda de la migracion 071: la racha cuenta ESTUDIO, no visitas. El comportamiento real (suma al responder o repasar,
// una sola vez por dia, dia de gracia, reinicio, y que un fallo de la racha no impide guardar la respuesta) se verifico en
// produccion con una simulacion en transaccion revertida. Esto evita que alguien deshaga el diseño sin darse cuenta.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const code = (src: string) =>
  src
    .split('\n')
    .filter((l) => !l.trim().startsWith('--') && !l.trim().startsWith('//'))
    .join('\n');

describe('migracion 071: la racha cuenta estudio', () => {
  const sql = code(read('supabase/migrations/071_streak_counts_study.sql'));

  it('un disparador en question_attempts y otro en student_card_state llaman a la racha', () => {
    expect(sql).toMatch(/AFTER INSERT ON public\.question_attempts[\s\S]*EXECUTE FUNCTION public\.touch_streak_on_study\(\)/);
    expect(sql).toMatch(/AFTER INSERT OR UPDATE ON public\.student_card_state[\s\S]*EXECUTE FUNCTION public\.touch_streak_on_study\(\)/);
    expect(sql).toContain('PERFORM public._check_and_update_streak_impl(NEW.student_id);');
  });

  it('un fallo de la racha no impide guardar la respuesta', () => {
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]*RETURN NEW;/);
  });

  it('la funcion del disparador no es ejecutable por la app y fija el search_path', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.touch_streak_on_study() FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
  });
});

describe('abrir pantallas ya no cuenta como actividad', () => {
  it('el layout del estudiante no llama a check_and_update_streak', () => {
    const layout = code(read('src/app/(student)/layout.tsx'));
    expect(layout).not.toContain('check_and_update_streak');
  });
});
