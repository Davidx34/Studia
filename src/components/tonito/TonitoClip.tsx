'use client';

// Reproductor de los clips de Toñito (cinematicas a pantalla completa). Ver src/lib/tonito/clips.ts y
// docs/TONITO_PRUEBA_DE_CONCEPTO.md.
//
// - Es DECORATIVO: el texto de la escena es lo que comunica; el video va oculto a los lectores de pantalla.
// - Muestra el poster (imagen fija) debajo y deja ver el video cuando ya puede reproducirse: sin parpadeos al cargar.
// - Sin sonido y con playsInline (condicion de iOS para reproducir solo, sin pantalla completa).
// - Se pausa si la pestaña se oculta o el video sale de pantalla (no gasta bateria ni datos de decodificacion).
// - Cualquier fallo (archivo no encontrado, formato no soportado, reproduccion bloqueada) avisa con onFailed: quien lo usa vuelve a
//   su version de siempre. NUNCA debe dejar al estudiante con una pantalla en blanco.

import { useEffect, useRef, useState } from 'react';
import { planClip, readClipEnvironment, type ClipPlan, type TonitoClipDef } from '@/lib/tonito/clips';
import { mediaUrl } from '@/lib/tonito/media';

// null mientras no se ha montado (en el servidor no hay DOM): se trata como "todavia no" y se muestra la version de siempre.
export function useClipPlan(): ClipPlan | null {
  const [plan, setPlan] = useState<ClipPlan | null>(null);
  useEffect(() => {
    setPlan(planClip(readClipEnvironment()));
  }, []);
  return plan;
}

export function TonitoClip({
  clip,
  className = '',
  onEnded,
  onFailed,
}: {
  clip: TonitoClipDef;
  className?: string;
  onEnded?: () => void;
  onFailed?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    // Reproduccion bloqueada por el navegador: se avisa para usar la version de siempre.
    v.play().catch(() => onFailed?.());

    const onVisibility = () => {
      if (document.hidden) v.pause();
      else void v.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisibility);

    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) void v.play().catch(() => {});
        else v.pause();
      });
      observer.observe(v);
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`relative overflow-hidden ${className}`} role="presentation" style={{ aspectRatio: `${clip.width} / ${clip.height}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mediaUrl(clip.poster)} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />
      <video
        ref={ref}
        muted
        playsInline
        autoPlay
        loop={clip.loop}
        preload="auto"
        disablePictureInPicture
        aria-hidden="true"
        tabIndex={-1}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 motion-reduce:transition-none ${ready ? 'opacity-100' : 'opacity-0'}`}
        onCanPlay={() => setReady(true)}
        onEnded={onEnded}
        onError={() => onFailed?.()}
      >
        {/* El error de un <source> no sube al <video>: se escucha aqui tambien. */}
        <source src={mediaUrl(clip.src)} type="video/mp4" onError={() => onFailed?.()} />
      </video>
    </div>
  );
}
