'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

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

    // Registro por invitación: el email debe estar pre-registrado por un
    // profesor o el administrador antes de poder crear la cuenta.
    const { data: pendingRole, error: pendingError } = await supabase.rpc(
      'check_pending_registration',
      { p_email: email }
    );
    if (pendingError || !pendingRole) {
      setError('Este email no está autorizado para registrarse. Pide que te inviten primero.');
      setLoading(false);
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, full_name: fullName },
      },
    });

    if (signUpError) {
      setError(
        signUpError.message.includes('already')
          ? 'Ya existe una cuenta con ese email.'
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

  if (checkEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-slate-950 bg-gradient-to-br from-slate-950 via-violet-950 to-slate-950">
        <div className="w-full max-w-md text-center premium-fade-in-up">
          <h1 className="text-5xl font-bold text-white tracking-tight mb-8">
            Stud<span style={{ color: 'var(--premium-gold)' }}>.</span>ia
          </h1>
          <div className="premium-card backdrop-blur-2xl bg-white/[0.04] rounded-3xl p-8 shadow-2xl">
            <h2 className="text-2xl font-semibold text-white mb-3">¡Ya casi! 📬</h2>
            <p className="text-white/60">
              Te enviamos un correo a{' '}
              <span style={{ color: 'var(--premium-gold)' }}>{email}</span> para confirmar tu
              cuenta. Ábrelo y luego inicia sesión.
            </p>
            <Link
              href="/login"
              className="premium-focus inline-block mt-6 font-medium rounded transition-colors duration-200"
              style={{ color: 'var(--premium-gold)' }}
            >
              Ir a iniciar sesión
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-950 bg-gradient-to-br from-slate-950 via-violet-950 to-slate-950">
      <div className="w-full max-w-md premium-fade-in-up">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-white tracking-tight">
            Stud<span style={{ color: 'var(--premium-gold)' }}>.</span>ia
          </h1>
          <p className="text-white/60 mt-2">¡Empieza tu aventura de aprendizaje!</p>
        </div>

        <div className="premium-card backdrop-blur-2xl bg-white/[0.04] rounded-3xl p-8 shadow-2xl">
          <h2 className="text-2xl font-semibold text-white mb-6">Crear cuenta</h2>

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Tu nombre</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="¿Cómo te llamas?"
                className="premium-focus w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 transition-all duration-300 ease-out focus:bg-white/[0.07] focus:border-white/20"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">Nombre de usuario</label>
              <input
                type="text"
                required
                pattern="[a-zA-Z0-9_]+"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="ej: super_estudiante"
                className="premium-focus w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 transition-all duration-300 ease-out focus:bg-white/[0.07] focus:border-white/20"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className="premium-focus w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 transition-all duration-300 ease-out focus:bg-white/[0.07] focus:border-white/20"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">Contraseña</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="premium-focus w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 transition-all duration-300 ease-out focus:bg-white/[0.07] focus:border-white/20"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Código de clase <span className="text-white/40 font-normal">(opcional)</span>
              </label>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="ej: ANA5A26"
                className="premium-focus w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 uppercase transition-all duration-300 ease-out focus:bg-white/[0.07] focus:border-white/20"
              />
            </div>

            {error && (
              <div
                className="rounded-xl p-3 text-sm text-white border premium-fade-in-up"
                style={{ background: 'rgba(243, 139, 160, 0.12)', borderColor: 'rgba(243, 139, 160, 0.3)' }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="premium-btn premium-focus w-full py-3 text-slate-900 font-semibold rounded-xl disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--premium-gold) 0%, #e8a87c 100%)' }}
            >
              {loading ? 'Creando tu cuenta...' : '¡Empezar mi aventura!'}
            </button>
          </form>

          <p className="text-center text-white/50 text-sm mt-6">
            ¿Ya tienes cuenta?{' '}
            <Link
              href="/login"
              className="premium-focus font-medium transition-colors duration-200 rounded"
              style={{ color: 'var(--premium-gold)' }}
            >
              Inicia sesión
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
