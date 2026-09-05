import { getServerSession } from 'next-auth/next';
import { redirect, notFound } from 'next/navigation';
import { authOptions } from '@/lib/auth-options';
import BackLink from '@/app/components/back-link';
import { getReadableCluster } from '@/app/actions/clusters';
import NewNoteButton from '@/app/components/new-note-button';
import MarkdownToPdfButton from '@/app/components/markdown-to-pdf-button';
import FastReadButton from '@/app/components/fastread-button';
import NavbarFlowerWind from '@/app/components/navbar-flower-wind';
import { resolveGardenNoteSlug } from '@/lib/garden-note-navigation';
import { resolveQuartzBaseUrl } from '@/lib/quartz-url';
import { openQuartzViewLease } from '@/lib/quartz-view-lease';
import {
  getNavbarFlowers,
  getNavbarShortcuts,
} from '@/lib/profile/navbar-shortcuts-store.ts';
import GardenClient from './garden-client';

export default async function GardenPage({
  params,
  searchParams,
}: {
  params: Promise<{ clusterSlug: string }>;
  searchParams: Promise<{ note?: string; chat?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/auth/login');

  const userId = Number((session.user as { id?: string }).id);
  const { clusterSlug } = await params;
  const { note, chat } = await searchParams;

  const cluster = await getReadableCluster(userId, clusterSlug);
  if (!cluster) notFound();

  // Older search cards stored only the filename while newer cards carry the
  // full nested page path. Resolve both forms here so saved conversations and
  // freshly retrieved results open the same real Quartz page.
  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  const resolvedNote = note && contentPath
    ? resolveGardenNoteSlug(contentPath, clusterSlug, note)
    : undefined;
  const canonicalNote = resolvedNote ?? note;

  // Read on the server so the navbar is right on first paint rather than
  // growing a button after hydration.
  const { fastRead } = getNavbarShortcuts(userId);

  // Take the Quartz view lease here, inside the Server Component, so the wait
  // for publication and service start belongs to the global blue progress bar
  // and the frame receives its source on first paint instead of showing a
  // loading state of its own.
  const quartzViewId = await openQuartzViewLease(userId);

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      <header className="breadboard-flower-navbar relative flex items-center justify-between gap-4 px-6 py-3.5 border-b border-gray-800 shrink-0">
        <NavbarFlowerWind showFlowers={getNavbarFlowers(userId)} />
        <div className="relative z-10 flex items-center gap-3 min-w-0">
          <BackLink
            fallbackHref={cluster.isOwner ? `/gardens/${clusterSlug}` : '/dashboard'}
            fallbackLabel={cluster.isOwner ? 'Back to workspace' : 'Back to gardens'}
          />
          <span className="text-gray-700">/</span>
          <h1 className="text-sm font-semibold text-white truncate max-w-xs">{cluster.name}</h1>
        </div>
        <div className="relative z-10 flex items-center gap-2">
          {cluster.isOwner && <NewNoteButton clusterSlug={clusterSlug} />}
          {fastRead && <FastReadButton clusterSlug={clusterSlug} initialNote={canonicalNote} />}
          <MarkdownToPdfButton clusterSlug={clusterSlug} initialNote={canonicalNote} />
        </div>
      </header>

      <GardenClient
        clusterSlug={clusterSlug}
        clusterName={cluster.name}
        quartzBaseUrl={resolveQuartzBaseUrl()}
        quartzViewId={quartzViewId}
        note={canonicalNote}
        initialChatOpen={chat === '1'}
        trackPublicView={!cluster.isOwner && cluster.visibility === 'public'}
      />
    </div>
  );
}
