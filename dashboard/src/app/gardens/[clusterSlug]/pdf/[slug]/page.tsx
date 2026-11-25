import { getServerSession } from "next-auth/next";
import type { Metadata } from "next";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { gardenDirectory } from "@/lib/garden-directory";
import { normalizeDocumentSlug } from "@/lib/garden-document-path";
import { readSourceFrontmatter, resolveSourcePdfMarkdownPath } from "@/lib/source-pdf-garden";
import { isPptxSource } from "@/lib/garden-source-display";
import {
  getNavbarFlowers,
  getNavbarShortcuts,
} from "@/lib/profile/navbar-shortcuts-store.ts";
import { requireReadableClusterFromSlug } from "@/lib/server-auth";
import PdfViewerClient from "./pdf-viewer-client";

function titleFromSlug(slug: string): string {
  return decodeURIComponent(slug)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pdfFileNameFromSource(value: string | undefined): string {
  const clean = value?.trim().replace(/\\/g, "/") ?? "";
  return clean.split("/").filter(Boolean).at(-1) || "";
}

const getPdfPageData = cache(async (clusterSlug: string, slug: string) => {
  let normalizedClusterSlug = clusterSlug;
  try {
    const { cluster } = await requireReadableClusterFromSlug(clusterSlug);
    normalizedClusterSlug = cluster.slug;
  } catch {
    return null;
  }

  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  const documentSlug = normalizeDocumentSlug(normalizedClusterSlug, slug);
  const notePath = contentPath && documentSlug
    ? resolveSourcePdfMarkdownPath(gardenDirectory(normalizedClusterSlug, contentPath), documentSlug)
    : null;
  const fields = notePath ? readSourceFrontmatter(notePath) : {};
  const sourceFile = fields.source_file || "";
  const title = (isPptxSource(fields.source_type || "", sourceFile) ? sourceFile : "") ||
    fields.title || (notePath ? documentSlug : null) || titleFromSlug(slug) || "PDF source";
  const pdfFileName =
    pdfFileNameFromSource(sourceFile) ||
    pdfFileNameFromSource(fields.source_pdf) ||
    `${title}.pdf`;

  return { normalizedClusterSlug, title, pdfFileName };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ clusterSlug: string; slug: string }>;
}): Promise<Metadata> {
  const { clusterSlug, slug } = await params;
  const data = await getPdfPageData(clusterSlug, slug);
  return {
    title: data?.pdfFileName || titleFromSlug(slug) || "PDF editor",
  };
}

export default async function PdfSourcePage({
  params,
}: {
  params: Promise<{ clusterSlug: string; slug: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");

  const { clusterSlug, slug } = await params;

  const data = await getPdfPageData(clusterSlug, slug);
  if (!data) notFound();

  const userId = Number((session.user as { id?: string }).id);
  const fastRead =
    Number.isFinite(userId) && userId > 0 ? getNavbarShortcuts(userId).fastRead : false;

  return (
    <div className="h-screen overflow-hidden bg-gray-950 text-gray-100 flex flex-col">
      <PdfViewerClient
        clusterSlug={clusterSlug}
        documentSlug={slug}
        title={data.title}
        browserTitle={data.pdfFileName}
        fastRead={fastRead}
        showNavbarFlowers={getNavbarFlowers(userId)}
      />
    </div>
  );
}
