import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth-options';
import { getClusters, getPublicClusters } from '@/app/actions/clusters';
import DashboardClient from './dashboard-client';

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/auth/login');

  const userId = Number((session.user as { id?: string }).id);
  const userEmail = session.user.email ?? '';
  const username = session.user.name ?? userEmail;
  const clusters = await getClusters(userId);
  const publicClusters = await getPublicClusters(userId);

  return (
    <DashboardClient
      userEmail={userEmail}
      username={username}
      initialClusters={clusters}
      initialPublicClusters={publicClusters}
    />
  );
}
