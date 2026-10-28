'use client';

import { memo } from 'react';
import type { TonitoMood, TonitoAnimation } from '@/stores/useTonitoStore';
import { bustoImgStyle, poseSrc, usesBusto } from '@/lib/tonito/poseCrop';

interface TonitoCharacterProps {
  mood: TonitoMood;
  animation: TonitoAnimation;
  gradient: [string, string];
  size?: number;
}

// Una pose de cuerpo entero por estado (public/tonito/poses/<estado>.webp, generadas con `npm run pose:prepare`). En tamaños pequeños se recorta al busto
// con CSS (ver poseCrop.ts); en grandes se muestra el cuerpo entero.
const moodImage: Record<TonitoMood, string> = {
  happy: poseSrc('happy'),
  excited: poseSrc('excited'),
  celebrating: poseSrc('celebrating'),
  thinking: poseSrc('thinking'),
  sad: poseSrc('sad'),
  sleeping: poseSrc('sleeping'),
  surprised: poseSrc('surprised'),
  encouraging: poseSrc('encouraging'),
};

const animClasses: Record<TonitoAnimation, string> = {
  idle: 'tonito-idle',
  bounce: 'tonito-bounce',
  shake: 'tonito-shake',
  spin: 'tonito-spin',
  pulse: 'tonito-pulse',
  sleep: 'tonito-sleep',
  jump: 'tonito-jump',
  supersaiyan: 'tonito-supersaiyan',
};

function TonitoCharacterBase({ mood, animation, gradient, size = 120 }: TonitoCharacterProps) {
  const animClass = animClasses[animation];
  const uid = `${gradient[0]}${gradient[1]}`.replace(/#/g, '');

  return (
    <div className={`tonito-character ${animClass}`} style={{ width: size, height: size, position: 'relative' }}>
      {animation === 'supersaiyan' && (
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle, rgba(255,215,0,0.6) 0%, rgba(255,215,0,0) 70%)`,
            animation: 'tonito-aura-pulse 0.5s ease-in-out infinite',
          }}
        />
      )}

      {usesBusto(size) ? (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 1 }}>
          <img src={moodImage[mood]} alt="Toñito" width={size} height={size} style={bustoImgStyle(size)} />
        </div>
      ) : (
        <img
          src={moodImage[mood]}
          alt="Toñito"
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'contain', position: 'relative', zIndex: 1 }}
        />
      )}

      {(mood === 'celebrating' || mood === 'excited') && (
        <>
          <span className="absolute text-yellow-300" style={{ left: '2%', top: '10%', fontSize: size * 0.12, animation: 'tonito-sparkle 0.6s infinite' }}>✦</span>
          <span className="absolute text-cyan-300" style={{ right: '4%', top: '30%', fontSize: size * 0.1, animation: 'tonito-sparkle 0.7s infinite' }}>✦</span>
        </>
      )}

      {mood === 'sleeping' && (
        <span
          className="absolute font-bold text-white/70"
          style={{ right: '0%', top: '0%', fontSize: size * 0.16, animation: 'tonito-zzz 2s infinite' }}
        >
          z
        </span>
      )}

      <style jsx>{`
        @keyframes tonito-sparkle {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes tonito-zzz {
          0% { opacity: 0.6; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-10px); }
        }
        @keyframes tonito-aura-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
      `}</style>
    </div>
  );
}

export const TonitoCharacter = memo(TonitoCharacterBase);
