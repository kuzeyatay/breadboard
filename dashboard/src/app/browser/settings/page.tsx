import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import BrowserSettings from "./settings-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Browser settings — Breadboard" };

export default async function BrowserSettingsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/browser/settings");
  const ownerKey = (session.user.email ?? String((session.user as { id?: string }).id)).trim().toLowerCase();
  return <BrowserSettings ownerKey={ownerKey} appearance={(await searchParams).section === "appearance"} />;
}
