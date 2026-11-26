import type { Metadata } from 'next';
import { getServerSession } from 'next-auth/next';
import { redirect, notFound } from 'next/navigation';
import { authOptions } from '@/lib/auth-options';
import { getReadableCluster } from '@/app/actions/clusters';
import { resolveGardenNoteSlug } from '@/lib/garden-note-navigation';
import { quartzUrlFromBase, resolveQuartzBaseUrl } from '@/lib/quartz-url';
import { ensureGardenPublicationForView } from '@/lib/quartz-publish';
import { openQuartzViewLease } from '@/lib/quartz-view-lease';
import GardenQuartzFrame from '../../garden-quartz-frame';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Garden page' };

/**
 * One garden page with nothing around it: what a chat's page card opens in
 * its popup. Same access check, publication and Quartz lease as the full
 * garden reader, minus the navbar and assistant.
 */
export default async function GardenPagePreview({
  params,
  searchParams,
}: {
  params: Promise<{ clusterSlug: string }>;
  searchParams: Promise<{ note?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/auth/login');
  const userId = Number((session.user as { id?: string }).id);
  const { clusterSlug } = await params;
  const { note } = await searchParams;
  const cluster = await getReadableCluster(userId, clusterSlug);
  if (!cluster) notFound();

  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  const canonicalNote = (note && contentPath
    ? resolveGardenNoteSlug(contentPath, clusterSlug, note)
    : undefined) ?? note;

  await ensureGardenPublicationForView(userId, clusterSlug);
  const quartzViewId = await openQuartzViewLease(userId);
  const src = canonicalNote
    ? quartzUrlFromBase(resolveQuartzBaseUrl(), clusterSlug, ...canonicalNote.split('/').filter(Boolean))
    : quartzUrlFromBase(resolveQuartzBaseUrl(), clusterSlug);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-950">
      <GardenQuartzFrame src={src} title={cluster.name} quartzViewId={quartzViewId} />
    </div>
  );
}
