'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AuthShell } from '@/components/auth/AuthShell';
import { parseRecoveryLink, validateNewPassword, describeResetError, MIN_PASSWORD_LENGTH } from '@/lib/auth/recovery';

type Estado = 'verificando' | 'listo' | 'invalido';

const INPUT_CLASS =
  'premium-focus w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 transition-all duration-300 ease-out focus:bg-white/[0.07] focus:border-white/20';

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [estado, setEstado] = useState<Estado>('verificando');
  const [motivoInvalido, setMotivoInvalido] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);

  // token_hash NO se verifica al cargar la pagina sino al enviar el formulario.
  // Los correos institucionales suelen pasar los enlaces por un escaner que los
  // abre por adelantado; el token es de un solo uso, asi que verificarlo al
  // cargar lo gastaria antes de que la persona llegue a verlo.
  const tokenHashRef = useRef<string | null>(null);

  const invalidar = (motivo: string) => {
    setMotivoInvalido(motivo);
    setEstado('invalido');
  };

  useEffect(() => {
    let cancelado = false;

    (async () => {
      const link = parseRecoveryLink(window.location.href);

      if (link.kind === 'error') {
        invalidar(link.reason === 'expired' ? 'Este enlace venció. Pide uno nuevo.' : 'Este enlace no es válido. Pide uno nuevo.');
        return;
      }

      if (link.kind === 'token_hash') {
        tokenHashRef.current = link.tokenHash;
        setEstado('listo');
        return;
      }

      if (link.kind === 'implicit') {
        // El cliente de @supabase/ssr usa PKCE y rechaza este formato por su
        // cuenta (auth-js lanza "Not a valid PKCE flow url"); la sesion se
        // restaura a mano.
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: link.accessToken,
          refresh_token: link.refreshToken,
        });
        if (cancelado) return;
        if (sessionError) {
          invalidar('Este enlace venció o ya se usó. Pide uno nuevo.');
          return;
        }
        // Los tokens no deben quedarse en la barra de direcciones ni en el historial.
        window.history.replaceState(null, '', window.location.pathname);
        setEstado('listo');
        return;
      }

      // 'code' o 'none': si el navegador tenia el verificador PKCE, el cliente
      // ya canjeo el codigo al iniciarse; getSession espera esa inicializacion.
      const { data } = await supabase.auth.getSession();
      if (cancelado) return;
      if (data.session) {
        setEstado('listo');
      } else if (link.kind === 'code') {
        invalidar('Abre el enlace en el mismo navegador donde pediste el correo, o pide uno nuevo.');
      } else {
        invalidar('Este enlace no es válido o ya se usó. Pide uno nuevo.');
      }
    })();

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const problema = validateNewPassword(password, confirm);
    if (problema) {
      setError(problema);
      return;
    }

    setLoading(true);
    setError(null);

    if (tokenHashRef.current) {
      const { error: otpError } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHashRef.current });
      if (otpError) {
        const d = describeResetError(otpError);
        if (d.linkInvalid) invalidar(d.message);
        else setError(d.message);
        setLoading(false);
        return;
      }
      tokenHashRef.current = null; // ya es una sesion normal
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      const d = describeResetError(updateError);
      if (d.linkInvalid) invalidar(d.message);
      else setError(d.message);
      setLoading(false);
      return;
    }

    // Si alguien tenia una sesion abierta con la contraseña anterior (la razon
    // habitual para cambiarla), deja de tenerla.
    try {
      await supabase.auth.signOut({ scope: 'others' });
    } catch {
      // Best-effort: la contraseña ya cambio, esto es solo higiene.
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    let destino = '/dashboard';
    if (user) {
      const { data: profile } = (await supabase.from('profiles').select('role').eq('id', user.id).single()) as {
        data: { role: string } | null;
        error: unknown;
      };
      if (profile?.role === 'teacher') destino = '/teacher/dashboard';
    }

    setHecho(true);
    router.push(destino);
    router.refresh();
  };

  return (
    <AuthShell subtitle="Crea tu contraseña nueva">
      {estado === 'verificando' && (
        <p role="status" className="text-white/60 text-center py-6">
          Verificando tu enlace...
        </p>
      )}

      {estado === 'invalido' && (
        <div role="alert">
          <h2 className="text-2xl font-semibold text-white mb-3">Enlace no válido</h2>
          <p className="text-white/60">{motivoInvalido}</p>
          <Link
            href="/forgot-password"
            className="premium-btn premium-focus mt-6 block w-full py-3 text-center text-slate-900 font-semibold rounded-xl"
            style={{ background: 'linear-gradient(135deg, var(--premium-gold) 0%, #e8a87c 100%)' }}
          >
            Pedir un enlace nuevo
          </Link>
        </div>
      )}

      {estado === 'listo' && hecho && (
        <p role="status" className="text-white text-center py-6">
          ¡Listo! Tu contraseña cambió. Entrando...
        </p>
      )}

      {estado === 'listo' && !hecho && (
        <>
          <h2 className="text-2xl font-semibold text-white mb-2">Contraseña nueva</h2>
          <p className="text-white/60 text-sm mb-6">Elige una contraseña de al menos {MIN_PASSWORD_LENGTH} caracteres.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-white/70 mb-2">
                Contraseña nueva
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={mostrar ? 'text' : 'password'}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${INPUT_CLASS} pr-24`}
                />
                <button
                  type="button"
                  onClick={() => setMostrar((m) => !m)}
                  aria-pressed={mostrar}
                  className="premium-focus absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg text-xs font-medium text-white/60 hover:text-white transition-colors duration-200"
                >
                  {mostrar ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-white/70 mb-2">
                Repite la contraseña
              </label>
              <input
                id="confirm"
                type={mostrar ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
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
              {loading ? 'Guardando...' : 'Guardar contraseña'}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
