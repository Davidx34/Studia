'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { parseRecoveryLink, validateNewPassword, describeResetError, MIN_PASSWORD_LENGTH } from '@/lib/auth/recovery';

type Estado = 'verificando' | 'listo' | 'invalido';


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
    <AuthShell subtitle="Crea tu contraseña nueva" themeable>
      {estado === 'verificando' && (
        <p role="status" className="text-fg-muted text-center py-6">
          Verificando tu enlace...
        </p>
      )}

      {estado === 'invalido' && (
        <div role="alert">
          <h2 className="text-2xl font-semibold text-fg mb-3">Enlace no válido</h2>
          <p className="text-fg-muted">{motivoInvalido}</p>
          <Link
            href="/forgot-password"
            className="mt-6 inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-accent text-on-accent font-semibold hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Pedir un enlace nuevo
          </Link>
        </div>
      )}

      {estado === 'listo' && hecho && (
        <p role="status" className="text-fg text-center py-6">
          ¡Listo! Tu contraseña cambió. Entrando...
        </p>
      )}

      {estado === 'listo' && !hecho && (
        <>
          <h2 className="text-2xl font-semibold text-fg mb-2">Contraseña nueva</h2>
          <p className="text-fg-muted text-sm mb-6">Elige una contraseña de al menos {MIN_PASSWORD_LENGTH} caracteres.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field
              label="Contraseña nueva"
              type={mostrar ? 'text' : 'password'}
              name="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              endAdornment={
                <button
                  type="button"
                  onClick={() => setMostrar((m) => !m)}
                  aria-pressed={mostrar}
                  className="min-h-[36px] px-3 rounded-lg text-xs font-medium text-fg-muted hover:text-fg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {mostrar ? 'Ocultar' : 'Mostrar'}
                </button>
              }
            />

            <Field label="Repite la contraseña" type={mostrar ? 'text' : 'password'} name="confirm" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />

            {error && (
              <div role="alert" className="rounded-xl p-3 text-sm text-fg border border-danger/40 bg-danger/10">
                {error}
              </div>
            )}

            <Button type="submit" variant="accent" size="lg" loading={loading} className="w-full">
              {loading ? 'Guardando...' : 'Guardar contraseña'}
            </Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
