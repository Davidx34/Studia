'use client';

import { useEffect, useState } from 'react';
import { Download, X, Share } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const STORAGE_KEY = 'studia-install-dismissed';

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showCard, setShowCard] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Detectar si ya está instalada
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // @ts-ignore - Safari iOS
      window.navigator.standalone === true;
    setIsStandalone(standalone);

    if (standalone) return;

    // Detectar iOS (no soporta beforeinstallprompt)
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(iOS);

    // Si ya fue dismisseado en las últimas 7 días, no mostrar
    const dismissedAt = localStorage.getItem(STORAGE_KEY);
    if (dismissedAt) {
      const daysSince = (Date.now() - parseInt(dismissedAt)) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) return;
    }

    // Capturar el evento de instalación (Chrome/Edge/Android)
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Mostrar la card después de 30 segundos para no ser intrusivo
      setTimeout(() => setShowCard(true), 30000);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Para iOS, mostrar tras 60 segundos si no hay otro evento
    if (iOS) {
      const t = setTimeout(() => setShowCard(true), 60000);
      return () => {
        clearTimeout(t);
        window.removeEventListener('beforeinstallprompt', handler);
      };
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setShowCard(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowCard(false);
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
  };

  if (isStandalone || !showCard) return null;

  return (
    <div className="fixed bottom-24 left-4 right-4 z-[140] max-w-sm mx-auto md:left-auto md:right-6 animate-slide-up">
      <div className="backdrop-blur-2xl bg-gradient-to-br from-violet-500/90 to-purple-700/90 border border-white/30 rounded-3xl p-5 shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center flex-shrink-0">
            <Download className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-white text-base">¡Instala Stud.ia!</h3>
            <p className="text-xs text-white/80 mt-0.5">
              Acceso instantáneo, modo offline y notificaciones
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 w-7 h-7 rounded-md hover:bg-white/15 flex items-center justify-center text-white/60 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isIOS ? (
          <div className="bg-black/20 rounded-xl p-3 text-xs text-white/90 space-y-1">
            <div className="font-semibold mb-1">Para instalar en iPhone:</div>
            <div className="flex items-center gap-2">
              <span>1.</span>
              <Share className="w-3 h-3" />
              <span>Toca el botón Compartir</span>
            </div>
            <div>2. Elige "Añadir a pantalla de inicio"</div>
            <div>3. Toca "Añadir"</div>
          </div>
        ) : (
          <button
            onClick={handleInstall}
            className="w-full py-3 bg-white text-violet-700 font-bold rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition shadow-lg"
          >
            Instalar ahora
          </button>
        )}
      </div>

      <style jsx>{`
        @keyframes slide-up {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
      `}</style>
    </div>
  );
}
