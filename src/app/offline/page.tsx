import Link from 'next/link';

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        {/* Toñito offline SVG inline (sin depender del cliente) */}
        <svg viewBox="0 0 200 200" className="w-40 h-40 mx-auto mb-6">
          <defs>
            <linearGradient id="off-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6C5CE7" />
              <stop offset="100%" stopColor="#00D2D3" />
            </linearGradient>
          </defs>
          <ellipse cx="100" cy="170" rx="44" ry="10" fill="rgba(0,0,0,0.2)" />
          <ellipse cx="100" cy="120" rx="52" ry="44" fill="url(#off-grad)" opacity="0.7" />
          <ellipse cx="100" cy="80" rx="48" ry="44" fill="url(#off-grad)" opacity="0.7" />
          {/* Eyes closed */}
          <line x1="74" y1="80" x2="86" y2="80" stroke="white" strokeWidth="3" strokeLinecap="round" />
          <line x1="114" y1="80" x2="126" y2="80" stroke="white" strokeWidth="3" strokeLinecap="round" />
          {/* Sad mouth */}
          <path d="M 86 100 Q 100 92 114 100" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" />
          {/* Z's */}
          <text x="135" y="60" fill="white" fontSize="14" opacity="0.6" fontWeight="bold">z</text>
          <text x="145" y="48" fill="white" fontSize="18" opacity="0.4" fontWeight="bold">Z</text>
        </svg>

        <h1 className="text-3xl font-bold text-white mb-2">¡Estás sin conexión!</h1>
        <p className="text-white/70 mb-8">
          Toñito se quedó dormido esperando internet. Mientras tanto, puedes seguir
          estudiando los módulos que ya descargaste.
        </p>

        <div className="space-y-3">
          <Link
            href="/dashboard"
            className="block w-full py-3 bg-gradient-to-r from-violet-500 to-purple-600 text-white font-semibold rounded-2xl hover:scale-[1.02] transition shadow-lg"
          >
            Volver al inicio
          </Link>
          <button
            onClick={() => typeof window !== 'undefined' && window.location.reload()}
            className="block w-full py-3 bg-white/10 border border-white/20 text-white font-semibold rounded-2xl hover:bg-white/15 transition"
          >
            Reintentar conexión
          </button>
        </div>

        <p className="text-xs text-white/40 mt-8">
          Cualquier cambio que hagas se sincronizará cuando vuelvas a tener internet.
        </p>
      </div>
    </div>
  );
}
