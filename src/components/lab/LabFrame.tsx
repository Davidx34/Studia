'use client';

// Incrusta un laboratorio (public/labs/<plantilla>.html) en un iframe AISLADO y conversa con el por postMessage.
//
// Aislamiento: sandbox="allow-scripts allow-downloads" SIN allow-same-origin. El laboratorio corre con origen opaco: no puede leer la sesion, las cookies, el almacenamiento
// ni el DOM de la app, ni llamar a su API con las credenciales del estudiante. Solo puede ejecutar su propio JavaScript y pedir la descarga de su CSV. Todo lo que llega
// por postMessage se valida (protocol.ts) antes de usarse.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildInitMessage, parseLabMessage } from '@/lib/lab/protocol';
import { labThemeVars } from '@/lib/lab/labTheme';
import type { LabAttemptState, ResolvedLab } from '@/lib/lab/types';

export interface LabFrameProps {
  lab: ResolvedLab;
  // Lo que el estudiante ya tenia (para continuar un informe).
  state?: LabAttemptState | null;
  // Solo lectura: el profesor revisa un informe, o el estudiante ya lo entrego.
  readOnly?: boolean;
  // Cada cambio del estudiante (con pausa de medio segundo): para guardar el borrador.
  onState?: (state: LabAttemptState) => void;
  onSubmit?: (state: LabAttemptState) => void;
}

// Cuanto se espera a que el laboratorio avise que esta listo antes de decir que no cargo.
const READY_TIMEOUT_MS = 8000;

export function LabFrame({ lab, state = null, readOnly = false, onState, onSubmit }: LabFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(640);
  const [failed, setFailed] = useState(false);
  const readyRef = useRef(false);
  // El estado inicial se manda UNA vez: despues lo maneja el laboratorio (reenviarlo pisaria lo que el estudiante esta escribiendo).
  const initial = useRef(state);
  const handlers = useRef({ onState, onSubmit });
  handlers.current = { onState, onSubmit };

  const src = useMemo(() => `/labs/${encodeURIComponent(lab.template)}.html`, [lab.template]);

  const sendInit = useCallback(() => {
    const win = ref.current?.contentWindow;
    if (!win) return;
    const read = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v);
    // targetOrigin '*' es necesario: el iframe aislado tiene origen opaco. Lo que se envia no es secreto (la descripcion del experimento).
    win.postMessage(buildInitMessage(lab, initial.current, readOnly, labThemeVars(read)), '*');
  }, [lab, readOnly]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Solo se escucha a ESTE iframe; cualquier otra ventana se ignora.
      if (e.source !== ref.current?.contentWindow) return;
      const msg = parseLabMessage(e.data);
      if (!msg) return;
      if (msg.type === 'ready') {
        readyRef.current = true;
        setFailed(false);
        if (msg.template === lab.template) sendInit();
      } else if (msg.type === 'resize') setHeight(msg.height);
      else if (msg.type === 'state') handlers.current.onState?.(msg.state);
      else if (msg.type === 'submit') handlers.current.onSubmit?.(msg.state);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [lab.template, sendInit]);

  // Si el laboratorio nunca avisa que esta listo (archivo faltante, bloqueado...), se dice con claridad en vez de dejar un recuadro en blanco.
  useEffect(() => {
    readyRef.current = false;
    setFailed(false);
    const timer = setTimeout(() => {
      if (!readyRef.current) setFailed(true);
    }, READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [lab.template]);

  return (
    <div className="relative w-full">
      {failed && (
        <p role="alert" className="mb-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-fg">
          No se pudo cargar el laboratorio. Revisa tu conexión y recarga la página.
        </p>
      )}
      <iframe
        ref={ref}
        src={src}
        title={`Laboratorio: ${lab.title}`}
        sandbox="allow-scripts allow-downloads"
        referrerPolicy="no-referrer"
        className="w-full rounded-2xl border border-line bg-bg"
        style={{ height }}
      />
    </div>
  );
}
