import type { Metadata, Viewport } from 'next';
import { OfflineIndicator } from '@/components/offline/OfflineIndicator';
import { InstallPrompt } from '@/components/offline/InstallPrompt';
import './globals.css';

const APP_NAME = 'Stud.ia';
const APP_DEFAULT_TITLE = 'Stud.ia · Tu compañero de aprendizaje';
const APP_TITLE_TEMPLATE = '%s · Stud.ia';
const APP_DESCRIPTION = 'Aprende con Toñito, tu mascota IA. Gamificación, lecciones adaptativas y diversión en cada paso.';

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_DEFAULT_TITLE,
    template: APP_TITLE_TEMPLATE,
  },
  description: APP_DESCRIPTION,
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: APP_DEFAULT_TITLE,
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: 'website',
    siteName: APP_NAME,
    title: { default: APP_DEFAULT_TITLE, template: APP_TITLE_TEMPLATE },
    description: APP_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: { default: APP_DEFAULT_TITLE, template: APP_TITLE_TEMPLATE },
    description: APP_DESCRIPTION,
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#6C5CE7',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
        <OfflineIndicator />
        <InstallPrompt />
      </body>
    </html>
  );
}
