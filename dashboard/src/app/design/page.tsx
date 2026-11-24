import { redirect } from "next/navigation";

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Design is part of Spaces now; links to a chat image keep working. */
export default async function DesignPage({ searchParams }: { searchParams: Search }) {
  const params = new URLSearchParams({ app: "design" });
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  redirect(`/spaces/edit?${params}`);
}
