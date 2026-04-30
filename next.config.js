/** @type {import('next').NextConfig} */
const withSerwistInit = require('@serwist/next').default;

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  cacheOnNavigation: true,
  reloadOnOnline: true,
  // Disable in dev to avoid stale caches while iterating
  disable: process.env.NODE_ENV === 'development',
});

const nextConfig = {
  reactStrictMode: true,
  // Ignorar errores de TypeScript en build (los tipos de joins de Supabase
  // requieren tipos generados con `supabase gen types` para inferencia completa)
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // Required for service worker registration
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
};

module.exports = withSerwist(nextConfig);
