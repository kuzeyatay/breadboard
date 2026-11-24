import { redirect } from "next/navigation";

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Video is part of Spaces now; links to a chat video keep working. */
export default async function VideoStudioPage({ searchParams }: { searchParams: Search }) {
  const params = new URLSearchParams({ app: "video" });
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  redirect(`/spaces/edit?${params}`);
}
