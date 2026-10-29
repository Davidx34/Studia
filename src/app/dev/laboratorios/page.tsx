import { redirect } from 'next/navigation';
import { requireDevSession } from '@/lib/devAuth';
import LaboratoriosClient from './LaboratoriosClient';

// Visor de laboratorios del panel de desarrollo: abre cada plantilla tal como la ve el estudiante, con su ficha por defecto, y muestra lo que el laboratorio le manda a la app.
export default async function DevLaboratoriosPage() {
  if (!(await requireDevSession())) redirect('/dev/login');

  return <LaboratoriosClient />;
}
