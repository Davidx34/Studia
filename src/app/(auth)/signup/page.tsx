'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';

const PENDING_JOIN_CODE_KEY = 'studia_pending_join_code';
const PENDING_REGISTRATION_EMAIL_KEY = 'studia_pending_registration_email';

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      setLoading(false);
      return;
    }

    // Registro por invitación: el email debe estar pre-registrado por el administrador. La regla la hace cumplir la
    // base de datos al crear la cuenta (migración 063): antes se consultaba aquí, en el navegador, y quien llamaba
    // directamente al servicio de Auth se la saltaba.
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, full_name: fullName },
      },
    });

    if (signUpError) {
      // Auth responde "Database error saving new user" cuando la base rechaza el alta: es el caso de un correo sin
      // invitación (no se distingue de otro fallo de base de datos, a propósito: no revela qué correos están invitados).
      const message = signUpError.message.toLowerCase();
      setError(
        message.includes('already')
          ? 'Ya existe una cuenta con ese email.'
          : message.includes('database error')
          ? 'No pudimos crear tu cuenta. Si tu email no ha sido invitado, pide que te inviten primero.'
          : 'No pudimos crear tu cuenta. Intenta de nuevo.'
      );
      setLoading(false);
      return;
    }

    const trimmedCode = joinCode.trim();

    if (!data.session) {
      // El proyecto requiere confirmar el email: no hay sesión todavía.
      // Guardamos el join_code y el email pendiente (para asignar el rol)
      // para aplicarlos en el primer login.
      if (trimmedCode) localStorage.setItem(PENDING_JOIN_CODE_KEY, trimmedCode);
      localStorage.setItem(PENDING_REGISTRATION_EMAIL_KEY, email);
      setCheckEmail(true);
      setLoading(false);
      return;
    }

    const { data: appliedRole } = await supabase.rpc('apply_pending_registration', { p_email: email });

    if (trimmedCode && appliedRole !== 'teacher') {
      await supabase.rpc('join_classroom_by_code', { p_join_code: trimmedCode });
    }

    router.push(appliedRole === 'teacher' ? '/teacher/dashboard' : '/dashboard');
    router.refresh();
  };

  const linkClass =
    'inline-flex min-h-[44px] items-center font-medium text-accent-text underline-offset-4 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  if (checkEmail) {
    return (
      <AuthShell themeable>
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-fg mb-3">¡Ya casi! 📬</h2>
          <p className="text-fg-muted">
            Te enviamos un correo a <span className="text-accent-text font-medium">{email}</span> para confirmar tu cuenta. Ábrelo y luego inicia sesión.
          </p>
          <Link href="/login" className={`${linkClass} mt-4`}>
            Ir a iniciar sesión
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell subtitle="¡Empieza tu aventura de aprendizaje!" themeable>
      <h2 className="text-2xl font-semibold text-fg mb-6">Crear cuenta</h2>

      <form onSubmit={handleSignup} className="space-y-4">
        <Field label="Tu nombre" name="name" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="¿Cómo te llamas?" />

        <Field
          label="Nombre de usuario"
          name="username"
          autoComplete="username"
          required
          pattern="[a-zA-Z0-9_]+"
          hint="Solo letras, números y guion bajo."
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          placeholder="ej: super_estudiante"
        />

        <Field label="Email" type="email" name="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" />

        <Field
          label="Contraseña"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={6}
          hint="Mínimo 6 caracteres."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <Field
          label="Código de clase (opcional)"
          name="join-code"
          autoComplete="off"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          placeholder="ej: ANA5A26"
          className="uppercase"
        />

        {error && (
          <div role="alert" className="rounded-xl p-3 text-sm text-fg border border-danger/40 bg-danger/10">
            {error}
          </div>
        )}

        <Button type="submit" variant="accent" size="lg" loading={loading} className="w-full">
          {loading ? 'Creando tu cuenta...' : '¡Empezar mi aventura!'}
        </Button>
      </form>

      <p className="text-center text-fg-muted text-sm mt-6">
        ¿Ya tienes cuenta?{' '}
        <Link href="/login" className={linkClass}>
          Inicia sesión
        </Link>
      </p>
    </AuthShell>
  );
}
