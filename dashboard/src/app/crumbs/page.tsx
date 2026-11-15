import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";

import NavBar from "@/app/components/navbar";
import { authOptions } from "@/lib/auth-options";
import { getNavbarFlowers } from "@/lib/profile/navbar-shortcuts-store.ts";
import CrumbsClient from "./crumbs-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Crumbs", description: "Notes people leave on the web, anchored to the passage they are about." };

/** Crumbs opens in its own tab, so like Plan and Organization it renders its own shell. */
export default async function CrumbsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/crumbs");
  const user = session.user as { id?: string; name?: string | null; email?: string | null };
  const tab = (await searchParams).tab;
  // The Crumbs account is part of Breadboard's settings now; old links still land on it.
  if (tab === "account") redirect("/settings#crumbs");
  const initial = tab === "organizations" ? tab : "feed";
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <NavBar email={user.email ?? ""} username={user.name} showFlowers={getNavbarFlowers(Number(user.id))} showActions={false} />
      <CrumbsClient initialTab={initial} />
    </div>
  );
}
