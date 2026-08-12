import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveInboxZeroConfig } from "@/lib/inbox-zero/config.ts";
import { setupStatus } from "@/lib/inbox-zero/service.ts";
import { cloneInstalled, ensureCredentials, hasEmailProvider } from "@/lib/inbox-zero/stack.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    const config = resolveInboxZeroConfig();
    const installed = cloneInstalled(config);
    // Health never starts containers: opening a settings panel must not cost a
    // four-image pull. `setupStatus` observes; only a run starts the stack.
    const setup = await setupStatus(config);
    const credentials = installed ? ensureCredentials(config) : null;
    return NextResponse.json({
      ok: true,
      available: config.mode !== "disabled" && installed,
      installed,
      mode: config.mode,
      baseUrl: config.baseUrl,
      cloneRoot: config.cloneRoot,
      // The secrets themselves are never returned — only whether one is present,
      // which is all the settings panel needs to render its state.
      oauth: {
        google: Boolean(credentials?.googleClientId && credentials.googleClientSecret),
        microsoft: Boolean(credentials?.microsoftClientId && credentials.microsoftClientSecret),
        configured: credentials ? hasEmailProvider(credentials) : false,
      },
      setup,
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
