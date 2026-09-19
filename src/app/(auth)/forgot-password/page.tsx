'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AuthShell } from '@/components/auth/AuthShell';
import { describeRequestError } from '@/lib/auth/recovery';

// Supabase limita los correos de recuperacion por usuario (~1 por minuto).
// El cooldown evita que el boton invite a spamear y a toparse con ese 429.
const COOLDOWN_SECONDS = 60;

const INPUT_CLASS =
  'premium-focus w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 transition-all duration-300 ease-out focus:bg-white/[0.07] focus:border-white/20';

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || cooldown > 0) return;
    setLoading(true);
    setError(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);
    if (resetError) {
      setError(describeRequestError(resetError));
      return;
    }
    // Supabase responde igual exista o no la cuenta, y la pantalla tambien:
    // no se revela quien tiene cuenta en Stud.ia.
    setSent(true);
    setCooldown(COOLDOWN_SECONDS);
  };

  return (
    <AuthShell subtitle="Recupera tu acceso">
      {sent ? (
        <div role="status">
          <h2 className="text-2xl font-semibold text-white mb-3">Revisa tu correo 📬</h2>
          <p className="text-white/60">
            Si hay una cuenta con <span style={{ color: 'var(--premium-gold)' }}>{email.trim()}</span>, te enviamos un
            enlace para crear una contraseña nueva. Puede tardar un par de minutos; mira también en spam.
          </p>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || cooldown > 0}
            className="premium-focus mt-6 w-full py-3 rounded-xl font-medium bg-white/5 border border-white/10 text-white/80 transition-all duration-300 ease-out hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cooldown > 0 ? `Reenviar en ${cooldown} s` : loading ? 'Enviando...' : 'Reenviar el correo'}
          </button>
          {error && (
            <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--premium-danger)' }}>
              {error}
            </p>
          )}
        </div>
      ) : (
        <>
          <h2 className="text-2xl font-semibold text-white mb-2">¿Olvidaste tu contraseña?</h2>
          <p className="text-white/60 text-sm mb-6">Escribe el correo de tu cuenta y te enviaremos un enlace para crear una nueva.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
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
              disabled={loading}
              className="premium-btn premium-focus w-full py-3 text-slate-900 font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, var(--premium-gold) 0%, #e8a87c 100%)' }}
            >
              {loading ? 'Enviando...' : 'Enviarme el enlace'}
            </button>
          </form>
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
