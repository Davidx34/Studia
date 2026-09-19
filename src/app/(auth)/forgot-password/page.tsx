'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AuthShell } from '@/components/auth/AuthShell';
import {
  describeRequestError,
  describeOtpError,
  sanitizeOtp,
  validateOtp,
  OTP_MAX_LENGTH,
} from '@/lib/auth/recovery';

// Supabase limita los correos de recuperacion por usuario (~1 por minuto).
// El cooldown evita que el boton invite a spamear y a toparse con ese 429.
const COOLDOWN_SECONDS = 60;

type Paso = 'correo' | 'codigo';

const INPUT_CLASS =
  'premium-focus w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 transition-all duration-300 ease-out focus:bg-white/[0.07] focus:border-white/20';

const GOLD_BUTTON_STYLE = { background: 'linear-gradient(135deg, var(--premium-gold) 0%, #e8a87c 100%)' };

export default function ForgotPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [paso, setPaso] = useState<Paso>('correo');
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Pide el correo. Devuelve true si salio. La pantalla responde igual exista o
  // no la cuenta (Supabase tampoco lo revela): no se filtra quien tiene cuenta.
  const enviarCorreo = async (): Promise<boolean> => {
    setEnviando(true);
    setError(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      // Solo se usa si la persona abre el enlace del correo en vez de escribir
      // el codigo; el camino principal ya no depende de ningun enlace.
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setEnviando(false);
    if (resetError) {
      setError(describeRequestError(resetError));
      return false;
    }
    setCooldown(COOLDOWN_SECONDS);
    return true;
  };

  const handleSubmitCorreo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    if (await enviarCorreo()) {
      setCodigo('');
      setPaso('codigo');
    }
  };

  const handleReenviar = async () => {
    if (enviando || cooldown > 0) return;
    if (await enviarCorreo()) setCodigo('');
  };

  // Verificar el codigo NO usa ningun enlace: no hay nada que un escaner de
  // correo (Microsoft Safe Links, etc.) pueda abrir o gastar por adelantado.
  const handleSubmitCodigo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verificando) return;

    const problema = validateOtp(codigo);
    if (problema) {
      setError(problema);
      return;
    }

    setVerificando(true);
    setError(null);
    const { error: otpError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: codigo,
      type: 'recovery',
    });
    setVerificando(false);

    if (otpError) {
      setError(describeOtpError(otpError));
      return;
    }
    // Ya hay una sesion de recuperacion: /reset-password la detecta y muestra
    // el formulario de la contraseña nueva.
    router.push('/reset-password');
  };

  const usarOtroCorreo = () => {
    setPaso('correo');
    setCodigo('');
    setError(null);
    setCooldown(0);
  };

  return (
    <AuthShell subtitle="Recupera tu acceso">
      {paso === 'correo' ? (
        <>
          <h2 className="text-2xl font-semibold text-white mb-2">¿Olvidaste tu contraseña?</h2>
          <p className="text-white/60 text-sm mb-6">
            Escribe el correo de tu cuenta y te enviaremos un código para crear una contraseña nueva.
          </p>

          <form onSubmit={handleSubmitCorreo} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-white/70 mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className={INPUT_CLASS}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-xl p-3 text-sm text-white border premium-fade-in-up"
                style={{ background: 'rgba(243, 139, 160, 0.12)', borderColor: 'rgba(243, 139, 160, 0.3)' }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={enviando}
              className="premium-btn premium-focus w-full py-3 text-slate-900 font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
              style={GOLD_BUTTON_STYLE}
            >
              {enviando ? 'Enviando...' : 'Enviarme el código'}
            </button>
          </form>
        </>
      ) : (
        <>
          <h2 className="text-2xl font-semibold text-white mb-2">Escribe el código 📬</h2>
          <p className="text-white/60 text-sm mb-6">
            Si hay una cuenta con <span style={{ color: 'var(--premium-gold)' }}>{email.trim()}</span>, te enviamos un
            correo con un código de verificación. Puede tardar un par de minutos; mira también en spam.
          </p>

          <form onSubmit={handleSubmitCodigo} className="space-y-4">
            <div>
              <label htmlFor="codigo" className="block text-sm font-medium text-white/70 mb-2">
                Código de verificación
              </label>
              <input
                id="codigo"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                maxLength={OTP_MAX_LENGTH + 4}
                value={codigo}
                onChange={(e) => setCodigo(sanitizeOtp(e.target.value))}
                placeholder="000000"
                aria-describedby="codigo-ayuda"
                className={`${INPUT_CLASS} text-center text-2xl font-mono tabular-nums tracking-[0.35em]`}
              />
              <p id="codigo-ayuda" className="text-xs text-white/40 mt-2">
                ¿El correo trae un botón en vez de un código? Ábrelo desde ahí.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-xl p-3 text-sm text-white border premium-fade-in-up"
                style={{ background: 'rgba(243, 139, 160, 0.12)', borderColor: 'rgba(243, 139, 160, 0.3)' }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={verificando}
              className="premium-btn premium-focus w-full py-3 text-slate-900 font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
              style={GOLD_BUTTON_STYLE}
            >
              {verificando ? 'Verificando...' : 'Verificar código'}
            </button>
          </form>

          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={handleReenviar}
              disabled={enviando || cooldown > 0}
              className="premium-focus w-full py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 transition-all duration-300 ease-out hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cooldown > 0 ? `Reenviar el código en ${cooldown} s` : enviando ? 'Enviando...' : 'Reenviar el código'}
            </button>
            <button
              type="button"
              onClick={usarOtroCorreo}
              className="premium-focus text-sm text-white/50 hover:text-white/80 transition-colors duration-200 rounded"
            >
              Usar otro correo
            </button>
          </div>
        </>
      )}

      <p className="text-center text-white/50 text-sm mt-6">
        <Link
          href="/login"
          className="premium-focus font-medium transition-colors duration-200 rounded"
          style={{ color: 'var(--premium-gold)' }}
        >
          ← Volver a iniciar sesión
        </Link>
      </p>
    </AuthShell>
  );
}
