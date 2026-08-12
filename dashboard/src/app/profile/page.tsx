import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-options";
import db from "@/lib/db";
import { getNavbarShortcuts } from "@/lib/profile/navbar-shortcuts-store.ts";
import { readProfileStats } from "@/lib/profile/stats.ts";
import ProfileClient from "./profile-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile — breadboard",
  description: "Your account, your habit, and the invites you have handed out.",
};

/**
 * The page behind the profile chip in the navbar.
 *
 * The stats are read on the server in one pass: they come from half a dozen
 * tables and none of them are worth a client round-trip, since nothing on this
 * page changes while you are looking at it. Inviting is the exception, and the
 * client owns that on its own.
 */
export default async function ProfilePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/profile");

  const userId = Number((session.user as { id?: string }).id);
  if (!Number.isFinite(userId) || userId <= 0) redirect("/auth/login?callbackUrl=/profile");

  const stats = readProfileStats(db, userId);

  return <ProfileClient stats={stats} initialShortcuts={getNavbarShortcuts(userId)} />;
}
