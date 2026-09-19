// Logica pura del flujo "olvide mi contraseña", separada de las paginas para
// poder testearla sin navegador ni red.

export const MIN_PASSWORD_LENGTH = 6; // igual que el signup; el servidor tiene su propio minimo

// Los tres formatos en que puede llegar el usuario desde el correo. Hacen falta
// los tres porque @supabase/ssr usa PKCE y NO acepta el formato con tokens en el
// fragmento (auth-js lanza "Not a valid PKCE flow url"), que es el que genera,
// por ejemplo, el boton "Send password recovery" del panel de Supabase.
export type RecoveryLink =
  | { kind: 'implicit'; accessToken: string; refreshToken: string } // #access_token=...&refresh_token=...&type=recovery
  | { kind: 'token_hash'; tokenHash: string } //                       ?token_hash=...&type=recovery (plantilla de correo propia)
  | { kind: 'code' } //                                                ?code=... (PKCE; solo sirve en el mismo navegador que pidio el reseteo)
  | { kind: 'error'; reason: 'expired' | 'other' } //                  #error=access_denied&error_code=otp_expired
  | { kind: 'none' };

export function parseRecoveryLink(href: string): RecoveryLink {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { kind: 'none' };
  }
  const search = url.searchParams;
  const hash = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  const pick = (key: string) => hash.get(key) ?? search.get(key);

  // Supabase devuelve los errores (enlace vencido, ya usado) en el fragmento.
  if (pick('error') || pick('error_code') || pick('error_description')) {
    return { kind: 'error', reason: pick('error_code') === 'otp_expired' ? 'expired' : 'other' };
  }

  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  if (accessToken && refreshToken && hash.get('type') === 'recovery') {
    return { kind: 'implicit', accessToken, refreshToken };
  }

  const tokenHash = search.get('token_hash');
  if (tokenHash && search.get('type') === 'recovery') {
    return { kind: 'token_hash', tokenHash };
  }

  if (search.get('code')) return { kind: 'code' };

  return { kind: 'none' };
}

export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (password !== confirm) return 'Las contraseñas no coinciden.';
  return null;
}

type AuthErrorLike = { code?: string; message?: string; status?: number } | null | undefined;

// Al guardar la contraseña nueva. `linkInvalid` = hay que pedir otro enlace.
export function describeResetError(err: AuthErrorLike): { message: string; linkInvalid: boolean } {
  const code = err?.code ?? '';
  if (code === 'same_password') {
    return { message: 'La contraseña nueva debe ser diferente a la anterior.', linkInvalid: false };
  }
  if (code === 'weak_password') {
    return {
      message: 'Esa contraseña es demasiado fácil de adivinar. Prueba con una más larga, o con números y símbolos.',
      linkInvalid: false,
    };
  }
  if (code === 'otp_expired' || code === 'session_not_found' || code === 'bad_jwt' || err?.status === 401 || err?.status === 403) {
    return { message: 'Este enlace venció o ya se usó. Pide uno nuevo.', linkInvalid: true };
  }
  return { message: 'No pudimos guardar tu contraseña. Intenta de nuevo.', linkInvalid: false };
}

// Al pedir el correo de recuperacion.
export function describeRequestError(err: AuthErrorLike): string {
  const code = err?.code ?? '';
  if (err?.status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return 'Pediste demasiados correos seguidos. Espera unos minutos e intenta de nuevo.';
  }
  return 'No pudimos enviar el correo. Revisa tu conexión e intenta de nuevo.';
}

// ---------------------------------------------------------------------------
// Codigo de un solo uso (OTP) enviado por correo.
//
// Por que existe: un flujo que exige HACER CLIC en un enlace del correo es
// fragil para cualquiera con correo corporativo. Microsoft 365 (Safe Links),
// Google Workspace y otros escaneres abren o reescriben los enlaces: si abren
// el de Supabase (/auth/v1/verify), gastan el token de un solo uso antes de que
// llegue la persona; si lo reescriben mal, el clic ni llega a Supabase. Caso
// real (2026-09-19, buzon @urosario.edu.co): outlook.cloud.microsoft/mail/
// safelink.html?url=null -- "We can't check the safety of this website".
// Un codigo que la persona ESCRIBE no tiene enlace que un escaner pueda tocar.
// ---------------------------------------------------------------------------

// Supabase permite configurar el largo del OTP entre 6 (por defecto) y 10.
export const OTP_MIN_LENGTH = 6;
export const OTP_MAX_LENGTH = 10;

// La gente pega el codigo con espacios o guiones ("123 456", "123-456") o con
// un salto de linea al final: solo interesan los digitos.
export function sanitizeOtp(input: string): string {
  return input.replace(/\D/g, '').slice(0, OTP_MAX_LENGTH);
}

export function validateOtp(code: string): string | null {
  if (code.length < OTP_MIN_LENGTH) return `El código tiene al menos ${OTP_MIN_LENGTH} dígitos.`;
  return null;
}

// Supabase no distingue "codigo incorrecto" de "codigo vencido" (ambos son
// otp_expired), asi que el mensaje cubre los dos.
export function describeOtpError(err: AuthErrorLike): string {
  const code = err?.code ?? '';
  const status = err?.status;
  if (status === 429 || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
    return 'Demasiados intentos seguidos. Espera unos minutos e intenta de nuevo.';
  }
  if (code === 'otp_expired' || code === 'validation_failed' || status === 400 || status === 401 || status === 403 || status === 422) {
    return 'El código no es correcto o ya venció. Revísalo, o pide uno nuevo.';
  }
  return 'No pudimos verificar el código. Revisa tu conexión e intenta de nuevo.';
}
