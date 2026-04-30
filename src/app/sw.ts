// src/app/sw.ts
// Service Worker para Stud.ia con estrategias diferenciadas por tipo de recurso
// Construido con Serwist (sucesor de next-pwa)

import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import {
  Serwist,
  CacheFirst,
  StaleWhileRevalidate,
  NetworkOnly,
  ExpirationPlugin,
  CacheableResponsePlugin,
  BackgroundSyncPlugin,
} from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// ── Background Sync Plugin para escrituras offline ──
// Las escrituras (POST/PATCH/DELETE) que fallen por estar offline
// se encolan en IndexedDB y se reintentan cuando vuelva la conexión.
const supabaseWriteSyncPlugin = new BackgroundSyncPlugin('studia-writes-queue', {
  maxRetentionTime: 24 * 60, // Reintentar hasta por 24 horas
  onSync: async ({ queue }) => {
    let entry;
    while ((entry = await queue.shiftRequest())) {
      try {
        await fetch(entry.request);
        // Notificar al cliente que se sincronizó algo
        const allClients = await self.clients.matchAll({ type: 'window' });
        for (const client of allClients) {
          client.postMessage({
            type: 'SYNC_SUCCESS',
            url: entry.request.url,
            method: entry.request.method,
          });
        }
      } catch (error) {
        // Si falla, devolver a la cola
        await queue.unshiftRequest(entry);
        throw error;
      }
    }
  },
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // ── 1. App Shell: HTML, JS, CSS de Next.js ──
    // CacheFirst para que la app abra instantáneamente, incluso offline
    {
      matcher: ({ request, url }) =>
        request.destination === 'style' ||
        request.destination === 'script' ||
        url.pathname.startsWith('/_next/'),
      handler: new CacheFirst({
        cacheName: 'studia-app-shell',
        plugins: [
          new ExpirationPlugin({
            maxEntries: 100,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 días
          }),
        ],
      }),
    },

    // ── 2. Imágenes (íconos, avatares, recursos) ──
    {
      matcher: ({ request }) => request.destination === 'image',
      handler: new CacheFirst({
        cacheName: 'studia-images',
        plugins: [
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({
            maxEntries: 200,
            maxAgeSeconds: 7 * 24 * 60 * 60, // 7 días
          }),
        ],
      }),
    },

    // ── 3. Fuentes de Google ──
    {
      matcher: ({ url }) =>
        url.origin === 'https://fonts.googleapis.com' ||
        url.origin === 'https://fonts.gstatic.com',
      handler: new CacheFirst({
        cacheName: 'studia-fonts',
        plugins: [
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({
            maxEntries: 30,
            maxAgeSeconds: 365 * 24 * 60 * 60, // 1 año
          }),
        ],
      }),
    },

    // ── 4. Reads de Supabase REST: contenido + perfiles ──
    // StaleWhileRevalidate: muestra el cache rápido, refresca en background
    {
      matcher: ({ url, request }) =>
        url.hostname.endsWith('.supabase.co') &&
        url.pathname.startsWith('/rest/v1/') &&
        request.method === 'GET',
      handler: new StaleWhileRevalidate({
        cacheName: 'studia-supabase-reads',
        plugins: [
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({
            maxEntries: 100,
            maxAgeSeconds: 24 * 60 * 60, // 24 horas
          }),
        ],
      }),
    },

    // ── 5. Writes de Supabase REST con Background Sync ──
    // Si offline, se encolan y reintentan cuando vuelva conexión
    {
      matcher: ({ url, request }) =>
        url.hostname.endsWith('.supabase.co') &&
        url.pathname.startsWith('/rest/v1/') &&
        (request.method === 'POST' ||
          request.method === 'PATCH' ||
          request.method === 'PUT' ||
          request.method === 'DELETE'),
      handler: new NetworkOnly({
        plugins: [supabaseWriteSyncPlugin],
      }),
    },

    // ── 6. Edge Functions de Gemini: SIEMPRE network-only ──
    // Generar preguntas requiere internet. Si offline, falla controladamente.
    {
      matcher: ({ url }) =>
        url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/functions/v1/'),
      handler: new NetworkOnly(),
    },

    // ── 7. Auth de Supabase: SIEMPRE network-only ──
    // Nunca cachear nada relacionado con autenticación
    {
      matcher: ({ url }) =>
        url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/auth/v1/'),
      handler: new NetworkOnly(),
    },

    // ── 8. Realtime de Supabase: network-only ──
    // WebSockets no se cachean
    {
      matcher: ({ url }) =>
        url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/realtime/'),
      handler: new NetworkOnly(),
    },

    // ── 9. Default: incluir las reglas por defecto de Serwist ──
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher({ request }) {
          return request.destination === 'document';
        },
      },
    ],
  },
});

serwist.addEventListeners();
