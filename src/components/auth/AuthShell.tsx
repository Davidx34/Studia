'use client';

// Marco visual de las paginas de recuperacion de contraseña: el mismo fondo y
// la misma tarjeta que login/signup, para que se sientan parte del producto.
// login/signup tienen este marco copiado dentro de cada pagina; aqui vive una
// sola vez (migrarlas queda como limpieza aparte, para no mezclarla con esto).
export function AuthShell({ subtitle, children }: { subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden bg-slate-950">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-slate-950 via-violet-950 to-slate-950" />
      <div className="absolute inset-0 -z-10 opacity-25" aria-hidden="true">
        <div className="absolute top-20 left-20 w-72 h-72 bg-fuchsia-500 rounded-full mix-blend-screen filter blur-3xl animate-blob" />
        <div className="absolute top-40 right-20 w-72 h-72 bg-amber-300 rounded-full mix-blend-screen filter blur-3xl animate-blob animation-delay-2000" />
        <div className="absolute bottom-20 left-1/2 w-72 h-72 bg-cyan-400 rounded-full mix-blend-screen filter blur-3xl animate-blob animation-delay-4000" />
      </div>

      <div className="w-full max-w-md premium-fade-in-up">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-white tracking-tight">
            Stud<span style={{ color: 'var(--premium-gold)' }}>.</span>ia
          </h1>
          {subtitle && <p className="text-white/60 mt-2">{subtitle}</p>}
        </div>

        <div className="premium-card backdrop-blur-2xl bg-white/[0.04] rounded-3xl p-8 shadow-2xl">{children}</div>
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
        /* La review 360 encontro cero soporte de prefers-reduced-motion en toda la app. */
        @media (prefers-reduced-motion: reduce) {
          .animate-blob { animation: none; }
        }
      `}</style>
    </div>
  );
}
