'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { TonitoCharacter } from './TonitoCharacter';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { streamChatWithTonito, loadChatHistory, type ChatMessage } from '@/lib/gemini/chat';
import { Send, X, Sparkles, Loader2 } from 'lucide-react';

const QUICK_PROMPTS = [
  '¿Qué debo estudiar hoy?',
  'Explícame fracciones',
  '¿Cómo va mi progreso?',
  'Cuéntame un chiste',
];

export function TonitoChatWidget() {
  const pathname = usePathname();
  const { mood, animation, message: ambientMessage, skinGradient, isChatOpen, setChatOpen, setMood, setInactive } =
    useTonitoStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detectar si estamos en una lección para pasar moduleId al chat
  const lessonMatch = pathname.match(/\/lesson\/([^/]+)/);
  const currentModuleId = lessonMatch?.[1];

  // ── Cargar historial al abrir por primera vez ──
  useEffect(() => {
    if (isChatOpen && !historyLoaded) {
      loadChatHistory(20).then((history) => {
        setMessages(history);
        setHistoryLoaded(true);
      });
    }
  }, [isChatOpen, historyLoaded]);

  // ── Auto-scroll al fondo cuando hay mensajes nuevos ──
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, streamingText]);

  // ── Focus al input al abrir ──
  useEffect(() => {
    if (isChatOpen && !isStreaming) {
      const t = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }
  }, [isChatOpen, isStreaming]);

  // ── Inactividad del widget colapsado (Toñito se duerme) ──
  useEffect(() => {
    if (isChatOpen) return; // No dormir mientras chatea

    const resetTimer = () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      if (mood === 'sleeping') setInactive(false);
      inactivityTimer.current = setTimeout(() => setInactive(true), 2 * 60 * 1000);
    };

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer));
    resetTimer();

    return () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [mood, setInactive, isChatOpen]);

  // ── Enviar mensaje ──
  const handleSend = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride || input).trim();
      if (!text || isStreaming) return;

      setError(null);
      setInput('');
      setIsStreaming(true);
      setStreamingText('');
      setMood('thinking');

      // Optimistic UI: agregar mensaje del usuario inmediatamente
      const userMsg: ChatMessage = { role: 'user', text, timestamp: Date.now() };
      setMessages((prev) => [...prev, userMsg]);

      await streamChatWithTonito(
        text,
        {
          onChunk: (chunk) => {
            setStreamingText((prev) => prev + chunk);
          },
          onDone: (fullText) => {
            // Mover el mensaje de streaming a la lista permanente
            setMessages((prev) => [
              ...prev,
              { role: 'tonito', text: fullText, timestamp: Date.now() },
            ]);
            setStreamingText('');
            setIsStreaming(false);
            setMood('happy');
          },
          onError: (err) => {
            console.error('Chat error:', err);
            setError('Toñito no puede responder ahora. ¿Intentamos de nuevo?');
            setIsStreaming(false);
            setStreamingText('');
            setMood('sad');
            setTimeout(() => setMood('happy'), 2500);
          },
        },
        {
          moduleId: currentModuleId,
          history: messages.slice(-6), // últimos 6 mensajes para contexto
        }
      );
    },
    [input, isStreaming, messages, currentModuleId, setMood]
  );

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 pointer-events-none">
      {/* Speech bubble ambient (cuando NO está abierto el chat) */}
      {ambientMessage && !isChatOpen && (
        <div className="pointer-events-auto bg-white/95 backdrop-blur-xl rounded-2xl px-4 py-3 shadow-2xl max-w-xs border-2 border-violet-200 animate-bubble-in relative">
          <p className="text-sm font-semibold text-slate-800 leading-snug">{ambientMessage}</p>
          <div className="absolute -bottom-2 right-8 w-4 h-4 bg-white/95 rotate-45 border-r-2 border-b-2 border-violet-200" />
        </div>
      )}

      {/* Ventana del chat expandido */}
      {isChatOpen && (
        <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-2xl border border-white/20 rounded-3xl shadow-2xl w-[340px] sm:w-96 max-h-[70vh] flex flex-col animate-chat-in overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 p-4 border-b border-white/10 bg-gradient-to-r from-violet-500/20 to-cyan-500/20">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative flex-shrink-0">
                <TonitoCharacter mood={mood} animation={animation} gradient={skinGradient} size={42} />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-white text-sm flex items-center gap-1.5">
                  Toñito
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <div className="text-[10px] text-white/60">
                  {currentModuleId ? 'Modo lección' : 'Tu compañero'}
                </div>
              </div>
            </div>
            <button
              onClick={() => setChatOpen(false)}
              className="flex-shrink-0 w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition"
              aria-label="Cerrar chat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Área de mensajes */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]">
            {!historyLoaded && (
              <div className="flex items-center justify-center py-8 text-white/40 text-xs">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Cargando historial...
              </div>
            )}

            {historyLoaded && messages.length === 0 && (
              <div className="text-center py-6 px-3">
                <Sparkles className="w-6 h-6 text-violet-300 mx-auto mb-2" />
                <p className="text-sm text-white/80 font-medium">¡Hola! Soy Toñito 👋</p>
                <p className="text-xs text-white/50 mt-1 mb-4">
                  Pregúntame lo que quieras sobre tus estudios
                </p>
                <div className="grid grid-cols-1 gap-1.5">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => handleSend(prompt)}
                      className="text-left px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-violet-400/40 text-xs text-white/80 transition"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, idx) => (
              <MessageBubble key={`${msg.timestamp}-${idx}`} message={msg} />
            ))}

            {/* Streaming bubble */}
            {isStreaming && (
              <div className="flex justify-start">
                <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-gradient-to-br from-violet-500/25 to-purple-600/25 border border-violet-400/30">
                  {streamingText ? (
                    <p className="text-sm text-white leading-snug whitespace-pre-wrap">
                      {streamingText}
                      <span className="inline-block w-1 h-3 bg-white/60 ml-0.5 animate-cursor" />
                    </p>
                  ) : (
                    <div className="flex gap-1 py-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-typing-dot" style={{ animationDelay: '0s' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-typing-dot" style={{ animationDelay: '0.2s' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-typing-dot" style={{ animationDelay: '0.4s' }} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="px-3 py-2 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200">
                {error}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-3 border-t border-white/10 bg-slate-950/50">
            <div className="flex items-end gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={isStreaming}
                placeholder={isStreaming ? 'Toñito está escribiendo...' : 'Pregúntame algo...'}
                className="flex-1 px-4 py-2.5 bg-white/8 border border-white/15 rounded-xl text-white placeholder-white/40 text-sm focus:outline-none focus:border-violet-400/60 focus:bg-white/10 transition disabled:opacity-50"
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isStreaming}
                className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: input.trim() && !isStreaming
                    ? `linear-gradient(135deg, ${skinGradient[0]}, ${skinGradient[1]})`
                    : 'rgba(255,255,255,0.08)',
                }}
                aria-label="Enviar"
              >
                {isStreaming ? (
                  <Loader2 className="w-4 h-4 text-white animate-spin" />
                ) : (
                  <Send className="w-4 h-4 text-white" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toñito botón (siempre visible cuando el chat está cerrado, FAB cuando está abierto) */}
      {!isChatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="pointer-events-auto group relative hover:scale-110 active:scale-95 transition-transform"
          aria-label="Hablar con Toñito"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-violet-400 to-cyan-400 rounded-full blur-xl opacity-50 group-hover:opacity-80 transition-opacity" />
          <div className="relative bg-white/20 backdrop-blur-xl rounded-full p-2 shadow-2xl border border-white/30">
            <TonitoCharacter mood={mood} animation={animation} gradient={skinGradient} size={72} />
          </div>
          {/* Notification dot si hay mensaje ambient sin leer */}
          {ambientMessage && (
            <span className="absolute top-1 right-1 w-3 h-3 bg-rose-500 rounded-full border-2 border-white animate-pulse" />
          )}
        </button>
      )}

      <style jsx>{`
        @keyframes bubble-in {
          0% { opacity: 0; transform: translateY(8px) scale(0.9); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes chat-in {
          0% { opacity: 0; transform: translateY(20px) scale(0.95); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes typing-dot {
          0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-3px); }
        }
        @keyframes cursor {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .animate-bubble-in { animation: bubble-in 0.3s ease-out; }
        .animate-chat-in { animation: chat-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .animate-typing-dot { animation: typing-dot 1.2s infinite ease-in-out; }
        .animate-cursor { animation: cursor 0.8s infinite; }
      `}</style>
    </div>
  );
}

// ── Componente de burbuja individual ──
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-msg-in`}>
      <div
        className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl ${
          isUser
            ? 'rounded-br-md bg-white/15 border border-white/20'
            : 'rounded-bl-md bg-gradient-to-br from-violet-500/25 to-purple-600/25 border border-violet-400/30'
        }`}
      >
        <p className="text-sm text-white leading-snug whitespace-pre-wrap">{message.text}</p>
      </div>
      <style jsx>{`
        @keyframes msg-in {
          0% { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .animate-msg-in { animation: msg-in 0.25s ease-out; }
      `}</style>
    </div>
  );
}
