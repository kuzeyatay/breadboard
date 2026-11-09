import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import CodeClient from "./code-client";
import { getNavbarFlowers, getNavbarShortcuts } from "@/lib/profile/navbar-shortcuts-store.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Code — breadboard", description: "Your VS Code workspace inside Breadboard." };
export default async function CodePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/code");
  const user = session.user as { id?: string; name?: string | null; email?: string | null };
  const userId = Number(user.id);
  return <CodeClient email={user.email ?? ""} username={user.name} showFlowers={getNavbarFlowers(userId)} shortcuts={getNavbarShortcuts(userId)} />;
}
