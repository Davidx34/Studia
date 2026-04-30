'use client';

import { useNotificationStore, type Toast, type ToastVariant } from '@/stores/useNotificationStore';
import { Zap, Coins, Flame, Target, Heart, Info, AlertCircle, X } from 'lucide-react';

const VARIANT_CONFIG: Record<
  ToastVariant,
  { icon: any; gradient: string; iconBg: string; ring: string }
> = {
  xp: {
    icon: Zap,
    gradient: 'from-violet-500/30 to-purple-600/30',
    iconBg: 'from-violet-400 to-purple-500',
    ring: 'ring-violet-300/40',
  },
  coins: {
    icon: Coins,
    gradient: 'from-yellow-500/30 to-amber-600/30',
    iconBg: 'from-yellow-400 to-amber-500',
    ring: 'ring-yellow-300/40',
  },
  streak: {
    icon: Flame,
    gradient: 'from-orange-500/30 to-red-600/30',
    iconBg: 'from-orange-400 to-red-500',
    ring: 'ring-orange-300/40',
  },
  mission: {
    icon: Target,
    gradient: 'from-pink-500/30 to-rose-600/30',
    iconBg: 'from-pink-400 to-rose-500',
    ring: 'ring-pink-300/40',
  },
  heart: {
    icon: Heart,
    gradient: 'from-red-500/30 to-pink-600/30',
    iconBg: 'from-red-400 to-pink-500',
    ring: 'ring-red-300/40',
  },
  info: {
    icon: Info,
    gradient: 'from-cyan-500/30 to-blue-600/30',
    iconBg: 'from-cyan-400 to-blue-500',
    ring: 'ring-cyan-300/40',
  },
  error: {
    icon: AlertCircle,
    gradient: 'from-rose-500/30 to-red-700/30',
    iconBg: 'from-rose-400 to-red-600',
    ring: 'ring-rose-300/40',
  },
};

export function ToastContainer() {
  const toasts = useNotificationStore((s) => s.toasts);
  const dismissToast = useNotificationStore((s) => s.dismissToast);

  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 pointer-events-none w-full max-w-sm px-4">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const config = VARIANT_CONFIG[toast.variant];
  const Icon = config.icon;

  return (
    <div
      className={`pointer-events-auto backdrop-blur-2xl bg-gradient-to-r ${config.gradient} border border-white/30 rounded-2xl p-3 shadow-2xl ring-2 ${config.ring} animate-toast-in`}
    >
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div
          className={`relative flex-shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br ${config.iconBg} flex items-center justify-center shadow-lg`}
        >
          <Icon className="w-5 h-5 text-white" strokeWidth={2.5} />
          {/* Sparkle decoration */}
          <div className="absolute -top-1 -right-1 w-2 h-2 bg-white rounded-full animate-sparkle" />
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white text-sm truncate">{toast.title}</span>
            {toast.amount !== undefined && (
              <span className="font-bold text-yellow-200 text-sm flex-shrink-0">
                +{toast.amount}
              </span>
            )}
          </div>
          {toast.subtitle && (
            <div className="text-xs text-white/80 truncate">{toast.subtitle}</div>
          )}
        </div>

        {/* Close */}
        <button
          onClick={onDismiss}
          className="flex-shrink-0 w-6 h-6 rounded-md hover:bg-white/15 flex items-center justify-center text-white/60 hover:text-white transition"
          aria-label="Cerrar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <style jsx>{`
        @keyframes toast-in {
          0% {
            opacity: 0;
            transform: translateY(-12px) scale(0.95);
          }
          60% {
            transform: translateY(2px) scale(1.02);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes sparkle {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.6); }
        }
        .animate-toast-in { animation: toast-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .animate-sparkle { animation: sparkle 1.5s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
