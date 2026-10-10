'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'Email o contraseña incorrectos. ¿Quieres intentar de nuevo?'
          : 'Algo no salió bien. Intenta otra vez en un momento.'
      );
      setLoading(false);
      return;
    }

    // Si venía de un signup con email sin confirmar en ese momento, el rol
    // pre-registrado (invitación) todavía no se aplicó — lo hacemos ahora
    // que ya hay sesión.
    const pendingRegistrationEmail = localStorage.getItem('studia_pending_registration_email');
    if (pendingRegistrationEmail) {
      await supabase.rpc('apply_pending_registration', { p_email: pendingRegistrationEmail });
      localStorage.removeItem('studia_pending_registration_email');
    }

    // Determinar a dónde redirigir según rol
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single() as { data: { role: string } | null, error: unknown };

    // Si venía de un signup con código de clase pendiente (email sin confirmar
    // en ese momento), lo aplicamos ahora que ya hay sesión.
    const pendingJoinCode = localStorage.getItem('studia_pending_join_code');
    if (pendingJoinCode && profile?.role !== 'teacher') {
      await supabase.rpc('join_classroom_by_code', { p_join_code: pendingJoinCode });
      localStorage.removeItem('studia_pending_join_code');
    }

    router.push(profile?.role === 'teacher' ? '/teacher/dashboard' : '/dashboard');
    router.refresh();
  };

  return (
    <AuthShell subtitle="Tu compañero de aprendizaje" themeable>
      <h2 className="text-2xl font-semibold text-fg mb-6">¡Hola de nuevo!</h2>

      <form onSubmit={handleLogin} className="space-y-4">
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com"
        />

        <div>
          <Field
            label="Contraseña"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          <div className="mt-2 text-right">
            <Link
              href="/forgot-password"
              className="inline-flex min-h-[44px] items-center text-sm font-medium text-accent-text underline-offset-4 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
        </div>

        {error && (
          <div role="alert" className="rounded-xl p-3 text-sm text-fg border border-danger/40 bg-danger/10">
            {error}
          </div>
        )}

        <Button type="submit" variant="accent" size="lg" loading={loading} className="w-full">
          {loading ? 'Entrando...' : 'Entrar a Stud.ia'}
        </Button>
      </form>

      <p className="text-center text-fg-muted text-sm mt-6">
        ¿Aún no tienes cuenta?{' '}
        <Link
          href="/signup"
          className="inline-flex min-h-[44px] items-center font-medium text-accent-text underline-offset-4 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Regístrate aquí
        </Link>
      </p>

      <p className="text-center text-fg-muted/80 text-xs mt-2">Hecho con 💙 por el equipo de Stud.ia</p>
    </AuthShell>
  );
}
