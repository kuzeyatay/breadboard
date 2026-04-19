import { getServerSession } from 'next-auth/next';
import { redirect, notFound } from 'next/navigation';
import { authOptions } from '@/lib/auth-options';
import { getReadableCluster } from '@/app/actions/clusters';

export default async function ChatPage({
  params,
}: {
  params: Promise<{ clusterSlug: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/auth/login');

  const userId = Number((session.user as { id?: string }).id);
  const { clusterSlug } = await params;

  const cluster = await getReadableCluster(userId, clusterSlug);
  if (!cluster) notFound();

  redirect(`/garden/${clusterSlug}?chat=1`);
}
