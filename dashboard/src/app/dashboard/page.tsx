import { getServerSession } from 'next-auth/next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth-options';
import { getClusters, getPublicClusters } from '@/app/actions/clusters';
import DashboardClient from './dashboard-client';
import {
  CHATMOCK_TARGET_COOKIE,
  normalizeChatmockTarget,
} from '@/lib/chatmock-target';

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/auth/login');

  const cookieStore = await cookies();
  const userId = Number((session.user as { id?: string }).id);
  const userEmail = session.user.email ?? '';
  const username = session.user.name ?? userEmail;
  const clusters = await getClusters(userId);
  const publicClusters = await getPublicClusters(userId);
  const initialChatmockTarget = normalizeChatmockTarget(
    cookieStore.get(CHATMOCK_TARGET_COOKIE)?.value,
  );

  return (
    <DashboardClient
      userEmail={userEmail}
      username={username}
      initialClusters={clusters}
      initialPublicClusters={publicClusters}
      initialChatmockTarget={initialChatmockTarget}
    />
  );
}
