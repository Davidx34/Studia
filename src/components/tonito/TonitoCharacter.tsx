'use client';

import { memo } from 'react';
import type { TonitoMood, TonitoAnimation } from '@/stores/useTonitoStore';

interface TonitoCharacterProps {
  mood: TonitoMood;
  animation: TonitoAnimation;
  gradient: [string, string];
  size?: number;
}

const eyeStyles: Record<TonitoMood, { type: string }> = {
  happy: { type: 'arc' },
  excited: { type: 'star' },
  thinking: { type: 'think' },
  sad: { type: 'sad' },
  surprised: { type: 'big' },
  sleeping: { type: 'closed' },
  celebrating: { type: 'star' },
  encouraging: { type: 'warm' },
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
  const e = eyeStyles[mood];
  const animClass = animClasses[animation];
  const uid = `${gradient[0]}${gradient[1]}`.replace(/#/g, '');

  return (
    <div className={`tonito-character ${animClass}`} style={{ width: size, height: size, position: 'relative' }}>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <linearGradient id={`bodyGrad-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={gradient[0]} />
            <stop offset="100%" stopColor={gradient[1]} />
          </linearGradient>
          <filter id={`glow-${uid}`}>
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id={`shine-${uid}`} cx="35%" cy="30%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.4)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          {animation === 'supersaiyan' && (
            <radialGradient id={`aura-${uid}`} cx="50%" cy="50%" r="60%">
              <stop offset="0%" stopColor="rgba(255,215,0,0.6)">
                <animate
                  attributeName="stopColor"
                  values="rgba(255,215,0,0.6);rgba(255,165,0,0.8);rgba(255,215,0,0.6)"
                  dur="0.5s"
                  repeatCount="indefinite"
                />
              </stop>
              <stop offset="100%" stopColor="rgba(255,215,0,0)" />
            </radialGradient>
          )}
        </defs>

        {animation === 'supersaiyan' && (
          <ellipse cx="50" cy="52" rx="42" ry="44" fill={`url(#aura-${uid})`}>
            <animate attributeName="rx" values="42;46;42" dur="0.3s" repeatCount="indefinite" />
            <animate attributeName="ry" values="44;48;44" dur="0.3s" repeatCount="indefinite" />
          </ellipse>
        )}

        <ellipse cx="50" cy="88" rx="22" ry="5" fill="rgba(0,0,0,0.12)">
          <animate attributeName="rx" values="22;20;22" dur="2s" repeatCount="indefinite" />
        </ellipse>

        <ellipse cx="68" cy="68" rx="10" ry="8" fill={`url(#bodyGrad-${uid})`} opacity="0.8">
          <animate attributeName="cx" values="68;70;68" dur="1.5s" repeatCount="indefinite" />
          <animate attributeName="cy" values="68;66;68" dur="2s" repeatCount="indefinite" />
        </ellipse>

        <ellipse cx="50" cy="60" rx="26" ry="22" fill={`url(#bodyGrad-${uid})`} filter={`url(#glow-${uid})`}>
          <animate attributeName="ry" values="22;23;22" dur="1.8s" repeatCount="indefinite" />
        </ellipse>

        <ellipse cx="50" cy="40" rx="24" ry="22" fill={`url(#bodyGrad-${uid})`} filter={`url(#glow-${uid})`}>
          <animate attributeName="ry" values="22;21.5;22" dur="1.2s" repeatCount="indefinite" />
        </ellipse>

        <ellipse cx="50" cy="38" rx="22" ry="20" fill={`url(#shine-${uid})`} />

        {/* Left Eye */}
        {e.type === 'arc' && <path d="M 38 40 Q 40 34 42 40" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" />}
        {e.type === 'star' && <text x="38" y="40" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">★</text>}
        {e.type === 'think' && <circle cx="39" cy="38" r="4.5" fill="white"><circle cx="39" cy="38" r="2" fill={gradient[0]} /></circle>}
        {e.type === 'sad' && <path d="M 36 39 L 39 36 L 42 39" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />}
        {e.type === 'big' && (
          <circle cx="39" cy="37" r="5" fill="white">
            <animate attributeName="r" values="5;5.5;5" dur="0.8s" repeatCount="indefinite" />
          </circle>
        )}
        {e.type === 'closed' && <line x1="35" y1="40" x2="43" y2="40" stroke="white" strokeWidth="2.5" strokeLinecap="round" />}
        {e.type === 'warm' && (
          <>
            <circle cx="39" cy="38" r="4.5" fill="white" />
            <circle cx="40" cy="37" r="2" fill={gradient[0]} />
          </>
        )}

        {/* Right Eye */}
        {e.type === 'arc' && <path d="M 56 40 Q 58 34 60 40" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" />}
        {e.type === 'star' && <text x="60" y="40" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">★</text>}
        {e.type === 'think' && <line x1="55" y1="39" x2="63" y2="39" stroke="white" strokeWidth="2.5" strokeLinecap="round" />}
        {e.type === 'sad' && <path d="M 56 39 L 59 36 L 62 39" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />}
        {e.type === 'big' && (
          <circle cx="59" cy="37" r="5" fill="white">
            <animate attributeName="r" values="5;5.5;5" dur="0.8s" repeatCount="indefinite" />
          </circle>
        )}
        {e.type === 'closed' && <line x1="55" y1="40" x2="63" y2="40" stroke="white" strokeWidth="2.5" strokeLinecap="round" />}
        {e.type === 'warm' && (
          <>
            <circle cx="59" cy="38" r="4.5" fill="white" />
            <circle cx="60" cy="37" r="2" fill={gradient[0]} />
          </>
        )}

        {(mood === 'happy' || mood === 'excited' || mood === 'celebrating') && (
          <>
            <ellipse cx="33" cy="45" rx="4" ry="2.5" fill="rgba(255,150,150,0.4)" />
            <ellipse cx="65" cy="45" rx="4" ry="2.5" fill="rgba(255,150,150,0.4)" />
          </>
        )}

        {(mood === 'happy' || mood === 'excited' || mood === 'celebrating' || mood === 'encouraging') && (
          <path d="M 44 48 Q 49 54 56 48" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
        )}
        {mood === 'thinking' && <line x1="45" y1="50" x2="55" y2="50" stroke="white" strokeWidth="2" strokeLinecap="round" />}
        {mood === 'sad' && <path d="M 44 52 Q 49 47 56 52" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />}
        {mood === 'surprised' && <ellipse cx="50" cy="50" rx="4" ry="5" fill="white" opacity="0.9" />}
        {mood === 'sleeping' && <line x1="47" y1="49" x2="53" y2="49" stroke="white" strokeWidth="1.5" strokeLinecap="round" />}

        {mood === 'sleeping' && (
          <>
            <text x="65" y="28" fill="white" fontSize="8" opacity="0.6" fontWeight="bold">
              z
              <animate attributeName="y" values="28;22" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;0" dur="2s" repeatCount="indefinite" />
            </text>
            <text x="72" y="20" fill="white" fontSize="10" opacity="0.4" fontWeight="bold">
              Z
              <animate attributeName="y" values="20;12" dur="2.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0" dur="2.5s" repeatCount="indefinite" />
            </text>
          </>
        )}

        {(mood === 'celebrating' || mood === 'excited') && (
          <>
            <text x="20" y="20" fontSize="8" fill="#FFD700">
              ✦
              <animate attributeName="opacity" values="1;0;1" dur="0.6s" repeatCount="indefinite" />
            </text>
            <text x="80" y="40" fontSize="7" fill="#00D2D3">
              ✦
              <animate attributeName="opacity" values="1;0;1" dur="0.7s" repeatCount="indefinite" />
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

export const TonitoCharacter = memo(TonitoCharacterBase);
