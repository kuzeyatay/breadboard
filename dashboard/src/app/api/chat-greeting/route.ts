import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-options";
import db from "@/lib/db";
import { EMPTY_CHAT_GREETING_SIGNALS } from "@/lib/hermes/chat-greeting";
import { readChatGreetingSignals } from "@/lib/hermes/chat-greeting-signals";

export const dynamic = "force-dynamic";

async function optionalUserId(): Promise<number | null> {
  const session = await getServerSession(authOptions);
  const id = Number((session?.user as { id?: string } | undefined)?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * What a blank chat greets with, and the openers under it, are decided in the
 * browser against the reader's own clock. This is the half the browser cannot
 * know: their name, and enough about how they have been using Breadboard for
 * the greeting to be about them rather than about the hour alone.
 */
export async function GET() {
  try {
    const userId = await optionalUserId();
    // Signed out still gets a greeting, just one that knows nothing: the empty
    // state is chrome, and it should never be the thing that fails to render.
    const signals =
      userId === null ? EMPTY_CHAT_GREETING_SIGNALS : readChatGreetingSignals(db, userId);
    return NextResponse.json(signals, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json(EMPTY_CHAT_GREETING_SIGNALS, {
      headers: { "cache-control": "no-store" },
    });
  }
}
