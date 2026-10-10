import type { Metadata, Viewport } from 'next';
import { OfflineIndicator } from '@/components/offline/OfflineIndicator';
import { InstallPrompt } from '@/components/offline/InstallPrompt';
import { Inter } from 'next/font/google';
import { THEME_INIT_SCRIPT } from '@/lib/design/theme';
import './globals.css';

// Tipografia propia (antes: Arial). Se sirve desde el mismo dominio y con font-display: swap.
const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

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
  viewportFit: 'cover',
};

// data-theme lo pone el script de arranque (THEME_INIT_SCRIPT) antes de pintar. NO va en el JSX de <html>: si una
// hidratacion falla, React re-renderiza el arbol y reescribiria el atributo, pisando el tema que el usuario eligio.
// Sin atributo = oscuro.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Aplica el tema elegido antes de pintar, para que no parpadee. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
        <OfflineIndicator />
        <InstallPrompt />
      </body>
    </html>
  );
}
