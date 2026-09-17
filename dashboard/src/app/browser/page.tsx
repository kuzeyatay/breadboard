import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import db from "@/lib/db";
import { EMPTY_CHAT_GREETING_SIGNALS } from "@/lib/hermes/chat-greeting";
import { readChatGreetingSignals } from "@/lib/hermes/chat-greeting-signals";
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
  let initialGreetingSignals = EMPTY_CHAT_GREETING_SIGNALS;
  try {
    initialGreetingSignals = readChatGreetingSignals(db, userId);
  } catch {
    // The greeting is chrome; missing personalization must not block the page.
  }
  return (
    <div className="browser-shell min-h-screen">
      <BrowserClient
        showFlowers={getNavbarFlowers(userId)}
        restoreOwnerKey={restoreOwnerKey}
        initialGreetingSignals={initialGreetingSignals}
      />
    </div>
  );
}
