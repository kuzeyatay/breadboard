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
import { resolveInboxZeroConfig } from "@/lib/inbox-zero/config.ts";
import {
  containerModelSettings,
  ensureCredentials,
  startStack,
  stopStack,
  writeCredentials,
} from "@/lib/inbox-zero/stack.ts";
import { revokeMintedSessions } from "@/lib/inbox-zero/session.ts";
import { forgetSession, setupStatus } from "@/lib/inbox-zero/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  try {
    await requireUserId();
    const body = (await request.json()) as Record<string, unknown>;
    const action = text(body.action);
    const config = resolveInboxZeroConfig();

    if (action === "save_oauth") {
      const credentials = ensureCredentials(config);
      // An empty field leaves the stored value alone rather than clearing it:
      // the panel renders secrets as blank, so submitting the form must not
      // erase a secret the user never saw.
      writeCredentials(config, {
        ...credentials,
        googleClientId: text(body.googleClientId) || credentials.googleClientId,
        googleClientSecret: text(body.googleClientSecret) || credentials.googleClientSecret,
        microsoftClientId: text(body.microsoftClientId) || credentials.microsoftClientId,
        microsoftClientSecret:
          text(body.microsoftClientSecret) || credentials.microsoftClientSecret,
      });
      // The stack reads these at boot, so a saved client only takes effect on
      // the next start. Say so rather than letting it look like it did nothing.
      return NextResponse.json({
        ok: true,
        restartRequired: true,
        setup: await setupStatus(config),
      });
    }

    if (action === "clear_oauth") {
      const credentials = ensureCredentials(config);
      writeCredentials(config, {
        ...credentials,
        googleClientId: "",
        googleClientSecret: "",
        microsoftClientId: "",
        microsoftClientSecret: "",
      });
      return NextResponse.json({ ok: true, setup: await setupStatus(config) });
    }

    if (action === "start") {
      const credentials = ensureCredentials(config);
      const { baseURL } = resolveChatmockBaseUrl(request);
      const model = text(body.model) || "default";
      const result = await startStack({
        config,
        credentials,
        model: containerModelSettings({
          chatmockBaseUrl: baseURL,
          chatmockApiKey: chatmockApiKeyValue(),
          model,
        }),
      });
      return NextResponse.json({
        ok: result.started,
        state: result.status.state,
        reason: result.status.reason ?? null,
        log: result.log.slice(-8_000),
        setup: await setupStatus(config),
      });
    }

    if (action === "stop") {
      forgetSession();
      const stopped = await stopStack(config);
      return NextResponse.json({ ok: stopped, setup: await setupStatus(config) });
    }

    if (action === "disconnect") {
      forgetSession();
      const credentials = ensureCredentials(config);
      let revoked = 0;
      try {
        revoked = await revokeMintedSessions(config, credentials);
      } catch {
        // The stack is down, so there is nothing live to revoke. The cached
        // session is already gone, which is the part that mattered.
      }
      return NextResponse.json({ ok: true, revoked, setup: await setupStatus(config) });
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
