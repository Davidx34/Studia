// Fuentes web de las plantillas con tema. Se declaran con preload: false, asi el navegador SOLO descarga una cuando una ficha de verdad la usa (el resto de la
// app no paga nada). Los demas estilos usan fuentes del sistema. Mismo mecanismo que la fuente de la app (Inter, en app/layout.tsx).

import { Baloo_2, Playfair_Display } from 'next/font/google';
import type { FichaFont } from '@/lib/study/fichaThemes';

// Redondeada y amigable: estilos infantiles.
const baloo = Baloo_2({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-baloo' });
// Serif de contraste alto: editorial, libro y archivo historico.
const playfair = Playfair_Display({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-playfair' });

// Clase que define la variable CSS de la fuente (la usa --f-font-head del tema). '' si el tema solo usa fuentes del sistema.
export const fontClass = (f: FichaFont): string => (f === 'baloo' ? baloo.variable : f === 'playfair' ? playfair.variable : '');
