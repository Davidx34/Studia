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
      <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-violet-600 via-purple-600 to-cyan-500">
        <div className="w-full max-w-md text-center">
          <h1 className="text-5xl font-bold text-white tracking-tight mb-8">
            Stud<span className="text-yellow-300">.</span>ia
          </h1>
          <div className="backdrop-blur-2xl bg-white/10 border border-white/20 rounded-3xl p-8 shadow-2xl">
            <h2 className="text-2xl font-semibold text-white mb-3">¡Ya casi! 📬</h2>
            <p className="text-white/70">
              Te enviamos un correo a <span className="text-yellow-300">{email}</span> para
              confirmar tu cuenta. Ábrelo y luego inicia sesión.
            </p>
            <Link
              href="/login"
              className="inline-block mt-6 text-yellow-300 hover:text-yellow-200 font-medium"
            >
              Ir a iniciar sesión
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-violet-600 via-purple-600 to-cyan-500">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-white tracking-tight">
            Stud<span className="text-yellow-300">.</span>ia
          </h1>
          <p className="text-white/70 mt-2">¡Empieza tu aventura de aprendizaje!</p>
        </div>

        <div className="backdrop-blur-2xl bg-white/10 border border-white/20 rounded-3xl p-8 shadow-2xl">
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
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/40"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Nombre de usuario</label>
              <input
                type="text"
                required
                pattern="[a-zA-Z0-9_]+"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="ej: super_estudiante"
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/40"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/40"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Contraseña</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/40"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Código de clase <span className="text-white/40 font-normal">(opcional)</span>
              </label>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="ej: ANA5A26"
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/40 uppercase"
              />
            </div>

            {error && (
              <div className="bg-red-500/20 border border-red-400/40 rounded-xl p-3 text-sm text-white">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-yellow-400 to-orange-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition disabled:opacity-50"
            >
              {loading ? 'Creando tu cuenta...' : '¡Empezar mi aventura!'}
            </button>
          </form>

          <p className="text-center text-white/60 text-sm mt-6">
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="text-yellow-300 hover:text-yellow-200 font-medium">
              Inicia sesión
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
