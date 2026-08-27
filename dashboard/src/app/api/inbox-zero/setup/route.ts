// The setup actions the Inbox Zero settings panel performs: saving the user's
// OAuth client, starting and stopping the stack, and revoking the sessions
// Breadboard minted.
//
// Saving a client is a write the user made deliberately, so it is accepted with
// no live validation — Google will validate it far better than a regex, at the
// moment it matters, in their own consent screen. What Breadboard does check is
// that a secret is never echoed back.

import { NextResponse } from "next/server";

import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { chatmockApiKeyValue } from "@/lib/agent-browser/provider.ts";
import { runInboxZeroSetup } from "@/lib/inbox-zero/runtime-service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const raw = await request.text();
    if (raw.length > 64 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
    const action = text(body.action);

    if (action === "save_oauth") {
      return NextResponse.json(await runInboxZeroSetup({ userId }, {
        action,
        googleClientId: text(body.googleClientId),
        googleClientSecret: text(body.googleClientSecret),
        microsoftClientId: text(body.microsoftClientId),
        microsoftClientSecret: text(body.microsoftClientSecret),
      }));
    }

    if (action === "clear_oauth") {
      return NextResponse.json(await runInboxZeroSetup({ userId }, { action }));
    }

    if (action === "start") {
      const { baseURL } = resolveChatmockBaseUrl(request);
      const model = text(body.model) || "default";
      return NextResponse.json(await runInboxZeroSetup({ userId }, {
        action,
        chatmockBaseUrl: baseURL,
        chatmockApiKey: chatmockApiKeyValue(),
        model,
      }));
    }

    if (action === "stop") {
      return NextResponse.json(await runInboxZeroSetup({ userId }, { action }));
    }

    if (action === "disconnect") {
      return NextResponse.json(await runInboxZeroSetup({ userId }, { action }));
    }

    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
