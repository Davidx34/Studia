'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
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

  const linkClass =
    'inline-flex min-h-[44px] items-center font-medium text-accent-text underline-offset-4 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <AuthShell subtitle="Recupera tu acceso" themeable>
      {paso === 'correo' ? (
        <>
          <h2 className="text-2xl font-semibold text-fg mb-2">¿Olvidaste tu contraseña?</h2>
          <p className="text-fg-muted text-sm mb-6">
            Escribe el correo de tu cuenta y te enviaremos un código para crear una contraseña nueva.
          </p>

          <form onSubmit={handleSubmitCorreo} className="space-y-4">
            <Field label="Email" type="email" name="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" />

            {error && (
              <div role="alert" className="rounded-xl p-3 text-sm text-fg border border-danger/40 bg-danger/10">
                {error}
              </div>
            )}

            <Button type="submit" variant="accent" size="lg" loading={enviando} className="w-full">
              {enviando ? 'Enviando...' : 'Enviarme el código'}
            </Button>
          </form>
        </>
      ) : (
        <>
          <h2 className="text-2xl font-semibold text-fg mb-2">Escribe el código 📬</h2>
          <p className="text-fg-muted text-sm mb-6">
            Si hay una cuenta con <span className="text-accent-text font-medium">{email.trim()}</span>, te enviamos un correo con un código de
            verificación. Puede tardar un par de minutos; mira también en spam.
          </p>

          <form onSubmit={handleSubmitCodigo} className="space-y-4">
            <Field
              label="Código de verificación"
              name="codigo"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              maxLength={OTP_MAX_LENGTH + 4}
              value={codigo}
              onChange={(e) => setCodigo(sanitizeOtp(e.target.value))}
              placeholder="000000"
              hint="¿El correo trae un botón en vez de un código? Ábrelo desde ahí."
              className="text-center text-2xl font-mono tabular-nums tracking-[0.35em]"
            />

            {error && (
              <div role="alert" className="rounded-xl p-3 text-sm text-fg border border-danger/40 bg-danger/10">
                {error}
              </div>
            )}

            <Button type="submit" variant="accent" size="lg" loading={verificando} className="w-full">
              {verificando ? 'Verificando...' : 'Verificar código'}
            </Button>
          </form>

          <div className="mt-4 flex flex-col gap-2">
            <Button type="button" variant="secondary" onClick={handleReenviar} disabled={enviando || cooldown > 0} className="w-full">
              {cooldown > 0 ? `Reenviar el código en ${cooldown} s` : enviando ? 'Enviando...' : 'Reenviar el código'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={usarOtroCorreo} className="text-fg-muted">
              Usar otro correo
            </Button>
          </div>
        </>
      )}

      <p className="text-center mt-6">
        <Link href="/login" className={linkClass}>
          ← Volver a iniciar sesión
        </Link>
      </p>
    </AuthShell>
  );
}
