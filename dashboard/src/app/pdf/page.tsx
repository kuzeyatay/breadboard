import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import {
  getNavbarFlowers,
  getNavbarShortcuts,
} from "@/lib/profile/navbar-shortcuts-store.ts";
import PdfViewerClient from "@/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client";

export const dynamic = "force-dynamic";

/**
 * A same-origin address only: the viewer fetches it with the viewer's own
 * cookies, so the route that serves the bytes is the one deciding who may read
 * them. A scheme or a protocol-relative host would point the reader elsewhere.
 */
function sameOriginPath(value: string | undefined): string | null {
  const src = value?.trim() ?? "";
  if (!src.startsWith("/") || src.startsWith("//") || /[\\\p{Cc}]/u.test(src)) return null;
  return src;
}

function displayName(name: string | undefined, src: string): string {
  const explicit = name?.trim().replace(/[\p{Cc}]/gu, "") ?? "";
  if (explicit) return explicit;
  const last = src.split("?")[0]!.split("/").filter(Boolean).at(-1) ?? "";
  try {
    const decoded = decodeURIComponent(last);
    if (/\.pdf$/i.test(decoded)) return decoded;
  } catch {
    // An undecodable segment is not a name worth showing.
  }
  return "PDF";
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ src?: string; name?: string }>;
}): Promise<Metadata> {
  const { src, name } = await searchParams;
  return { title: displayName(name, sameOriginPath(src) ?? "") };
}

/**
 * The built-in PDF viewer, opened on any dashboard address that serves a PDF.
 *
 * The desktop shell sends a frame here when it would otherwise show Chromium's
 * own PDF plugin — a raw file address reached by a middle-click, an agent, or
 * a restored tab — and no dedicated viewer route exists for that address. It
 * is the same reader a garden source, an artifact and an attachment get;
 * read-only, because an address alone names no note to write an edit back to.
 */
export default async function GenericPdfPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string; name?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");

  const userId = Number((session.user as { id?: string } | undefined)?.id);
  if (!Number.isFinite(userId) || userId <= 0) notFound();

  const { src, name } = await searchParams;
  const sourceUrl = sameOriginPath(src);
  if (!sourceUrl) notFound();

  const fileName = displayName(name, sourceUrl);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-950 text-gray-100">
      <PdfViewerClient
        title={fileName}
        browserTitle={fileName}
        kicker="PDF"
        sourceUrl={sourceUrl}
        readOnly
        fastRead={getNavbarShortcuts(userId).fastRead}
        showNavbarFlowers={getNavbarFlowers(userId)}
      />
    </div>
  );
}
