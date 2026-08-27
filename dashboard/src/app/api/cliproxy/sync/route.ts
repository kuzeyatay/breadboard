import { NextResponse } from "next/server";
import {
  providerErrorResponseInit,
  readProviderState,
  updateProvider,
} from "@/lib/chatmock-providers";
import { cliproxyApiKey, cliproxyBaseUrl } from "@/lib/cliproxy/config";
import { isCliproxyInstalled } from "@/lib/cliproxy/config";
import {
  CliproxyRequestError,
  CliproxyUnavailableError,
  listModels,
} from "@/lib/cliproxy/management";
import { withCliproxyLease } from "@/lib/cliproxy/runtime-lease";
import { SupervisorResourceExhaustedError } from "@/lib/supervisor-control";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/** Guard against a runaway catalog becoming an unusable dropdown. */
const MAX_SYNCED_MODELS = 200;

/**
 * Teach ChatMock about the subscription proxy.
 *
 * Which models exist depends on which accounts are signed in, so the aggregate
 * Claude Code + CLIProxyAPI list is written into ChatMock's `cliproxy`
 * provider. Claude requests are intercepted by ChatMock's official-CLI bridge;
 * the loopback base URL and bearer continue to serve every other subscription.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();

    let models: string[];
    try {
      models = isCliproxyInstalled()
        ? await withCliproxyLease(
            "subscription-model-sync",
            () => listModels(userId, request.signal),
          )
        : await listModels(userId, request.signal);
    } catch (error) {
      if (error instanceof CliproxyUnavailableError) {
        return NextResponse.json({ error: error.message }, { status: 503 });
      }
      if (error instanceof CliproxyRequestError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    if (models.length === 0) {
      throw new RouteError(
        409,
        "No subscription models are available yet. Connect an account first.",
      );
    }

    // ChatGPT has exactly one home: ChatMock's own OAuth on the Account tab.
    // If a ChatGPT account was added to the proxy by other means, its models
    // would otherwise show up a second time as `cliproxy/gpt-…` alongside the
    // native ids — the same model under two names. Keep the native one.
    const native = new Set((await readProviderState(request)).chatgptModels);
    const unique = models.filter((model) => !native.has(model));

    if (unique.length === 0) {
      throw new RouteError(
        409,
        "The only models available are ones ChatMock already serves through your ChatGPT account.",
      );
    }

    const state = await updateProvider(request, "cliproxy", {
      apiKey: cliproxyApiKey(),
      baseUrl: cliproxyBaseUrl(),
      enabled: true,
      models: unique.slice(0, MAX_SYNCED_MODELS),
    });

    return NextResponse.json(
      {
        synced: Math.min(unique.length, MAX_SYNCED_MODELS),
        skipped: models.length - unique.length,
        state,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof SupervisorResourceExhaustedError) {
      return routeErrorResponse(error);
    }
    if (error instanceof RouteError) return routeErrorResponse(error);
    const { status, message } = providerErrorResponseInit(error);
    return NextResponse.json({ error: message }, { status });
  }
}
