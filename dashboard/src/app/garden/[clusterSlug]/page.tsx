import { getServerSession } from 'next-auth/next';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { authOptions } from '@/lib/auth-options';
import { getReadableCluster } from '@/app/actions/clusters';
import NewNoteButton from '@/app/components/new-note-button';
import MarkdownToPdfButton from '@/app/components/markdown-to-pdf-button';
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

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-6 py-3.5 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={cluster.isOwner ? `/clusters/${clusterSlug}` : '/dashboard'}
            className="text-gray-500 hover:text-white transition-colors text-sm flex items-center gap-1.5 shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            {cluster.isOwner ? 'Back to cluster' : 'Back to clusters'}
          </Link>
          <span className="text-gray-700">/</span>
          <h1 className="text-sm font-semibold text-white truncate max-w-xs">{cluster.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {cluster.isOwner && <NewNoteButton clusterSlug={clusterSlug} />}
          <MarkdownToPdfButton clusterSlug={clusterSlug} initialNote={note} />
        </div>
      </header>

      <GardenClient
        clusterSlug={clusterSlug}
        clusterName={cluster.name}
        note={note}
        initialChatOpen={chat === '1'}
        trackPublicView={!cluster.isOwner && cluster.visibility === 'public'}
      />
    </div>
  );
}
