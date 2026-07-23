'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

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
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* Fondo animado */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-600 via-purple-600 to-cyan-500" />
      <div className="absolute inset-0 -z-10 opacity-30">
        <div className="absolute top-20 left-20 w-72 h-72 bg-pink-400 rounded-full mix-blend-multiply filter blur-3xl animate-blob" />
        <div className="absolute top-40 right-20 w-72 h-72 bg-yellow-300 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000" />
        <div className="absolute bottom-20 left-1/2 w-72 h-72 bg-cyan-300 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000" />
      </div>

      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-white tracking-tight">
            Stud<span className="text-yellow-300">.</span>ia
          </h1>
          <p className="text-white/70 mt-2">Tu compañero de aprendizaje</p>
        </div>

        {/* Card glassmorphism */}
        <div className="backdrop-blur-2xl bg-white/10 border border-white/20 rounded-3xl p-8 shadow-2xl">
          <h2 className="text-2xl font-semibold text-white mb-6">¡Hola de nuevo!</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-transparent transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Contraseña
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-transparent transition"
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
              className="w-full py-3 bg-gradient-to-r from-yellow-400 to-orange-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Entrando...' : 'Entrar a Stud.ia'}
            </button>
          </form>

          <p className="text-center text-white/60 text-sm mt-6">
            ¿Aún no tienes cuenta?{' '}
            <Link href="/signup" className="text-yellow-300 hover:text-yellow-200 font-medium">
              Regístrate aquí
            </Link>
          </p>
        </div>

        <p className="text-center text-white/40 text-xs mt-6">
          Hecho con 💙 por el equipo de Stud.ia
        </p>
      </div>

      <style jsx>{`
        @keyframes blob {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
        }
        .animate-blob { animation: blob 7s infinite; }
        .animation-delay-2000 { animation-delay: 2s; }
        .animation-delay-4000 { animation-delay: 4s; }
      `}</style>
    </div>
  );
}
