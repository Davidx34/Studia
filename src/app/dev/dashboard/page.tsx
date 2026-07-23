import { redirect } from 'next/navigation';
import { requireDevSession } from '@/lib/devAuth';
import DevDashboardClient from './DevDashboardClient';

export default async function DevDashboardPage() {
  if (!(await requireDevSession())) redirect('/dev/login');

  return <DevDashboardClient />;
}
