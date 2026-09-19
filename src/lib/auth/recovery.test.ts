import { describe, it, expect } from 'vitest';
import { parseRecoveryLink, validateNewPassword, describeResetError, describeRequestError, MIN_PASSWORD_LENGTH } from './recovery';
import { isAuthPage, isPublicPage } from './routes';

const BASE = 'https://studia-ebon.vercel.app/reset-password';

describe('parseRecoveryLink', () => {
  it('reconoce el formato con tokens en el fragmento (el del boton "Send password recovery" del panel)', () => {
    const r = parseRecoveryLink(`${BASE}#access_token=AAA&expires_in=3600&refresh_token=RRR&token_type=bearer&type=recovery`);
    expect(r).toEqual({ kind: 'implicit', accessToken: 'AAA', refreshToken: 'RRR' });
  });

  it('reconoce token_hash de una plantilla de correo propia', () => {
    expect(parseRecoveryLink(`${BASE}?token_hash=HASH&type=recovery`)).toEqual({ kind: 'token_hash', tokenHash: 'HASH' });
  });

  it('reconoce el codigo PKCE', () => {
    expect(parseRecoveryLink(`${BASE}?code=abc123`)).toEqual({ kind: 'code' });
  });

  it('un enlace vencido llega como error en el fragmento y se distingue de otros errores', () => {
    const vencido = parseRecoveryLink(`${BASE}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    expect(vencido).toEqual({ kind: 'error', reason: 'expired' });
    expect(parseRecoveryLink(`${BASE}#error=server_error&error_code=unexpected_failure`)).toEqual({ kind: 'error', reason: 'other' });
  });

  it('el error tiene prioridad sobre cualquier otro parametro', () => {
    expect(parseRecoveryLink(`${BASE}?code=abc#error=access_denied&error_code=otp_expired`).kind).toBe('error');
  });

  it('NO trata como recuperacion un enlace de otro tipo (p.ej. magic link o confirmacion de correo)', () => {
    expect(parseRecoveryLink(`${BASE}#access_token=AAA&refresh_token=RRR&type=magiclink`).kind).toBe('none');
    expect(parseRecoveryLink(`${BASE}?token_hash=HASH&type=signup`).kind).toBe('none');
  });

  it('exige access_token Y refresh_token: con solo uno no hay sesion que restaurar', () => {
    expect(parseRecoveryLink(`${BASE}#access_token=AAA&type=recovery`).kind).toBe('none');
  });

  it('sin parametros, o con una URL invalida, es "none" y no lanza', () => {
    expect(parseRecoveryLink(BASE)).toEqual({ kind: 'none' });
    expect(parseRecoveryLink('esto no es una url')).toEqual({ kind: 'none' });
  });
});

describe('validateNewPassword', () => {
  it('acepta una contraseña valida que coincide', () => {
    expect(validateNewPassword('una-clave-larga', 'una-clave-larga')).toBeNull();
  });

  it('rechaza menos del minimo de caracteres', () => {
    expect(validateNewPassword('12345', '12345')).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it('el limite es exacto: justo el minimo pasa', () => {
    const justa = 'a'.repeat(MIN_PASSWORD_LENGTH);
    expect(validateNewPassword(justa, justa)).toBeNull();
  });

  it('rechaza cuando la confirmacion no coincide', () => {
    expect(validateNewPassword('clave-uno', 'clave-dos')).toBe('Las contraseñas no coinciden.');
  });

  it('el largo se valida antes que la coincidencia', () => {
    expect(validateNewPassword('abc', 'xyz')).toContain('al menos');
  });
});

describe('describeResetError', () => {
  it('misma contraseña que la anterior', () => {
    const r = describeResetError({ code: 'same_password' });
    expect(r.linkInvalid).toBe(false);
    expect(r.message).toContain('diferente');
  });

  it('contraseña debil: no invalida el enlace, el usuario puede reintentar', () => {
    expect(describeResetError({ code: 'weak_password' }).linkInvalid).toBe(false);
  });

  it('enlace vencido o sesion inexistente: hay que pedir otro', () => {
    for (const code of ['otp_expired', 'session_not_found', 'bad_jwt']) {
      expect(describeResetError({ code }).linkInvalid).toBe(true);
    }
    expect(describeResetError({ status: 401 }).linkInvalid).toBe(true);
  });

  it('un error desconocido no acusa al enlace ni expone el mensaje crudo de Supabase', () => {
    const r = describeResetError({ code: 'algo_raro', message: 'detalle interno de supabase' });
    expect(r.linkInvalid).toBe(false);
    expect(r.message).not.toContain('supabase');
  });

  it('tolera null/undefined', () => {
    expect(describeResetError(null).linkInvalid).toBe(false);
    expect(describeResetError(undefined).message.length).toBeGreaterThan(0);
  });
});

describe('describeRequestError', () => {
  it('distingue el limite de correos del resto de fallos', () => {
    expect(describeRequestError({ status: 429 })).toContain('demasiados');
    expect(describeRequestError({ code: 'over_email_send_rate_limit' })).toContain('demasiados');
    expect(describeRequestError({ code: 'network' })).toContain('conexión');
  });
});

// El middleware mandaba a /login a cualquiera sin sesion que entrara a una
// ruta que no fuera /login, /signup u /offline: las paginas de recuperacion
// habrian estado muertas al llegar, justo para quien las necesita.
describe('rutas publicas del middleware', () => {
  it('las paginas de recuperacion son accesibles sin sesion', () => {
    expect(isPublicPage('/forgot-password')).toBe(true);
    expect(isPublicPage('/reset-password')).toBe(true);
    expect(isPublicPage('/offline')).toBe(true);
  });

  it('/reset-password NO es pagina de auth: con la sesion de recuperacion no se debe redirigir al dashboard', () => {
    expect(isAuthPage('/reset-password')).toBe(false);
    expect(isAuthPage('/forgot-password')).toBe(false);
  });

  it('login y signup siguen siendo paginas de auth y no publicas', () => {
    expect(isAuthPage('/login')).toBe(true);
    expect(isAuthPage('/signup')).toBe(true);
    expect(isPublicPage('/login')).toBe(false);
  });

  it('las rutas protegidas no se volvieron publicas por accidente', () => {
    for (const ruta of ['/dashboard', '/teacher/dashboard', '/teacher/classrooms', '/lesson/abc', '/reset-password/extra']) {
      expect(isPublicPage(ruta)).toBe(false);
    }
  });
});
