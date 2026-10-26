import { redirect } from 'next/navigation';
import { requireDevSession } from '@/lib/devAuth';
import CinematicasClient from './CinematicasClient';

// Visor de cinematicas del panel de desarrollo: reproduce cada escena tal como la ve el estudiante y muestra si usa video.
export default async function DevCinematicasPage() {
  if (!(await requireDevSession())) redirect('/dev/login');

  return <CinematicasClient />;
}
