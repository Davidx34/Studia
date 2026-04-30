'use client';

import { useEffect, useState } from 'react';
import { useOnlineStatus, usePendingActionsCount, useSyncListener } from '@/lib/offline/queue';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { WifiOff, CheckCircle2, CloudUpload } from 'lucide-react';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  const pendingCount = usePendingActionsCount();
  const pushToast = useNotificationStore((s) => s.pushToast);
  const [showReconnected, setShowReconnected] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  // Cuando vuelve la conexión tras estar offline, mostrar mensaje
  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true);
    } else if (wasOffline) {
      setShowReconnected(true);
      pushToast({
        variant: 'info',
        title: '¡De vuelta en línea!',
        subtitle: pendingCount > 0 ? `Sincronizando ${pendingCount} cambios...` : 'Todo al día',
        durationMs: 4000,
      });
      const t = setTimeout(() => setShowReconnected(false), 4000);
      return () => clearTimeout(t);
    }
  }, [isOnline, wasOffline, pendingCount, pushToast]);

  // Escuchar cuando el SW sincroniza algo
  useSyncListener(() => {
    pushToast({
      variant: 'info',
      title: 'Cambio sincronizado',
      subtitle: 'Tu progreso está guardado',
      durationMs: 2500,
    });
  });

  // Banner offline persistente arriba
  if (!isOnline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[150] bg-amber-500/95 backdrop-blur-xl text-amber-950 shadow-lg animate-slide-down">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-center gap-3 text-sm font-semibold">
          <WifiOff className="w-4 h-4" strokeWidth={2.5} />
          <span>Sin conexión · Toñito está guardando tu progreso aquí</span>
          {pendingCount > 0 && (
            <span className="bg-amber-900/30 text-amber-950 px-2 py-0.5 rounded-full text-xs font-bold">
              {pendingCount} pendientes
            </span>
          )}
        </div>
        <style jsx>{`
          @keyframes slide-down {
            0% { transform: translateY(-100%); }
            100% { transform: translateY(0); }
          }
          .animate-slide-down { animation: slide-down 0.3s ease-out; }
        `}</style>
      </div>
    );
  }

  // Si hay acciones pendientes online, mostrar pequeño badge
  if (pendingCount > 0) {
    return (
      <div className="fixed top-20 right-4 z-[150] bg-cyan-500/95 backdrop-blur-xl text-white rounded-full shadow-lg px-3 py-1.5 flex items-center gap-2 text-xs font-semibold animate-fade-in">
        <CloudUpload className="w-3.5 h-3.5 animate-pulse" />
        Sincronizando {pendingCount}...
        <style jsx>{`
          @keyframes fade-in {
            0% { opacity: 0; transform: translateY(-4px); }
            100% { opacity: 1; transform: translateY(0); }
          }
          .animate-fade-in { animation: fade-in 0.3s ease-out; }
        `}</style>
      </div>
    );
  }

  return null;
}
