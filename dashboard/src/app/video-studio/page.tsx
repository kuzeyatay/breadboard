import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-options";
import { getNavbarFlowers } from "@/lib/profile/navbar-shortcuts-store.ts";
import VideoStudioClient from "./video-studio-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Video", description: "Edit videos on a timeline, with Bread beside you." };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);

/** Timeline Studio with Bread docked on the left. `?artifact=&conversation=` opens a chat video for editing. */
export default async function VideoStudioPage({ searchParams }: { searchParams: Search }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/video-studio");
  const user = session.user as { id?: string; name?: string | null; email?: string | null };
  const params = await searchParams;
  const artifact = one(params.artifact);
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <VideoStudioClient
        showFlowers={getNavbarFlowers(Number(user.id))}
        source={artifact ? { id: artifact, conversationId: one(params.conversation) ?? "", title: one(params.title) ?? "Video", kind: one(params.kind) ?? "video" } : null}
      />
    </div>
  );
}
