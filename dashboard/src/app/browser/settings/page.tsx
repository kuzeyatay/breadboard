import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { getNavbarFlowers } from "@/lib/profile/navbar-shortcuts-store.ts";
import BrowserSettings from "./settings-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Browser settings — Breadboard" };

export default async function BrowserSettingsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/browser/settings");
  const ownerKey = (session.user.email ?? String((session.user as { id?: string }).id)).trim().toLowerCase();
  const showFlowers = getNavbarFlowers(Number((session.user as { id?: string }).id));
  return <BrowserSettings ownerKey={ownerKey} showFlowers={showFlowers} appearance={(await searchParams).section === "appearance"} />;
}
