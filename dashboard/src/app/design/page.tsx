import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-options";
import { getNavbarFlowers } from "@/lib/profile/navbar-shortcuts-store.ts";
import DesignClient from "./design-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Design", description: "Edit images and make designs, with Bread beside you." };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);

/** Doory's editor with Bread docked on the left. `?artifact=&conversation=` opens a chat image for editing. */
export default async function DesignPage({ searchParams }: { searchParams: Search }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/design");
  const user = session.user as { id?: string; name?: string | null; email?: string | null };
  const params = await searchParams;
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <DesignClient
        showFlowers={getNavbarFlowers(Number(user.id))}
        artifact={one(params.artifact) && one(params.conversation)
          ? { id: one(params.artifact)!, conversationId: one(params.conversation)!, title: one(params.title) ?? "Image" }
          : null}
        initialDesign={one(params.design)}
      />
    </div>
  );
}
