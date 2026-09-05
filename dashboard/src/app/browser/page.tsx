import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { getNavbarFlowers } from "@/lib/profile/navbar-shortcuts-store.ts";
import BrowserClient from "./browser-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Browser — breadboard",
};

/** Trusted chrome for the desktop app's sandboxed Chromium page. */
export default async function BrowserPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/browser");
  const userId = Number((session.user as { id?: string }).id);
  const restoreOwnerKey = (session.user.email ?? String(userId)).trim().toLowerCase();
  return (
    <div className="browser-shell min-h-screen">
      <BrowserClient
        showFlowers={getNavbarFlowers(userId)}
        restoreOwnerKey={restoreOwnerKey}
      />
    </div>
  );
}
