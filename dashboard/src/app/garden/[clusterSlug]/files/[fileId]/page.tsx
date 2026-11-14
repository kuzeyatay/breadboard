import { gardenFileContext } from "@/lib/garden-files/server";
import StandaloneGardenFile from "./standalone-file";
import { redirect, notFound } from "next/navigation";

export default async function GardenFilePage({ params }: { params: Promise<{ clusterSlug: string; fileId: string }> }) {
  const { clusterSlug, fileId } = await params;
  const context = await gardenFileContext(clusterSlug).catch(() => null);
  if (!context) notFound();
  const file = (() => { try { return context.store.get(context.scope, fileId); } catch { return null; } })();
  if (!file) notFound();
  if (context.scope.userId !== null) redirect(`/garden/${encodeURIComponent(clusterSlug)}?file=${encodeURIComponent(fileId)}&fileGarden=${encodeURIComponent(clusterSlug)}`);
  return <StandaloneGardenFile initialFile={file} />;
}
