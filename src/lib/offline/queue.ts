'use client';

import { useEffect, useState } from 'react';

// ── Hook para detectar online/offline ──
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // Estado inicial
    if (typeof navigator !== 'undefined') {
      setIsOnline(navigator.onLine);
    }

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

// ── Hook para escuchar eventos de sync del SW ──
export function useSyncListener(onSync: (info: { url: string; method: string }) => void) {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'SYNC_SUCCESS') {
        onSync({ url: event.data.url, method: event.data.method });
      }
    };

    navigator.serviceWorker.addEventListener('message', handler);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handler);
    };
  }, [onSync]);
}

// ── IndexedDB para acciones pendientes (complementa al BackgroundSyncPlugin) ──
// Esto registra acciones del usuario para que la UI las muestre como "pendientes"
// mientras el SW las sincroniza por su cuenta.

interface PendingAction {
  id: string;
  type: 'lesson_completion' | 'xp_earned' | 'progress_update' | 'mission_progress';
  payload: any;
  createdAt: number;
}

const DB_NAME = 'studia-offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending-actions';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

export async function queueOfflineAction(
  type: PendingAction['type'],
  payload: any
): Promise<string> {
  const db = await openDB();
  const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const action: PendingAction = { id, type, payload, createdAt: Date.now() };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(action);
    req.onsuccess = () => resolve(id);
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingActions(): Promise<PendingAction[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as PendingAction[]);
    req.onerror = () => reject(req.error);
  });
}

export async function removePendingAction(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearPendingActions(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Hook para mostrar contador de acciones pendientes en la UI ──
export function usePendingActionsCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (typeof indexedDB === 'undefined') return;

    let mounted = true;
    const refresh = async () => {
      try {
        const actions = await getPendingActions();
        if (mounted) setCount(actions.length);
      } catch {
        if (mounted) setCount(0);
      }
    };

    refresh();

    // Escuchar eventos de sync para refrescar el contador
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'SYNC_SUCCESS') refresh();
    };
    navigator.serviceWorker?.addEventListener('message', handler);

    // Refresh periódico
    const interval = setInterval(refresh, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
      navigator.serviceWorker?.removeEventListener('message', handler);
    };
  }, []);

  return count;
}
