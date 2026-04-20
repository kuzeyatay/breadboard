import { getServerSession } from "next-auth/next";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { requireReadableClusterFromSlug } from "@/lib/server-auth";
import PdfViewerClient from "./pdf-viewer-client";

function titleFromSlug(slug: string): string {
  return decodeURIComponent(slug)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function PdfSourcePage({
  params,
}: {
  params: Promise<{ clusterSlug: string; slug: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");

  const { clusterSlug, slug } = await params;

  try {
    await requireReadableClusterFromSlug(clusterSlug);
  } catch {
    notFound();
  }

  const title = titleFromSlug(slug) || "PDF source";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <PdfViewerClient
        clusterSlug={clusterSlug}
        documentSlug={slug}
        title={title}
      />
    </div>
  );
}
