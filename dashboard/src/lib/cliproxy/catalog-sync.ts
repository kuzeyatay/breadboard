import {
  readProviderState,
  updateProvider,
  type ChatmockProviderState,
} from "@/lib/chatmock-providers";
import { isCliproxyInstalled } from "@/lib/cliproxy/config";
import { listModels } from "@/lib/cliproxy/management";
import { withCliproxyLease } from "@/lib/cliproxy/runtime-lease";
import { RouteError } from "@/lib/server-auth";

/** Guard against a runaway catalog becoming an unusable dropdown. */
export const MAX_SYNCED_MODELS = 200;

/** How often the model picker may re-sync the subscription catalog on its own. */
export const AUTO_SYNC_INTERVAL_MS = 10 * 60_000;

export interface SubscriptionCatalogSync {
  synced: number;
  skipped: number;
  state: ChatmockProviderState;
}

/**
 * Teach ChatMock about the subscription proxy.
 *
 * Which models exist depends on which accounts are signed in, so the aggregate
 * Claude Code + CLIProxyAPI list is written into ChatMock's `cliproxy`
 * provider. Claude requests are intercepted by ChatMock's official-CLI bridge;
 * the loopback base URL and bearer continue to serve every other subscription.
 *
 * Throws `RouteError` for the two "nothing to sync" outcomes and lets the
 * proxy's own errors through, so the route can translate each.
 */
export async function syncSubscriptionCatalog(
  request: Request,
  userId: number,
): Promise<SubscriptionCatalogSync> {
  const models = isCliproxyInstalled()
    ? await withCliproxyLease(
        "subscription-model-sync",
        () => listModels(userId, request.signal),
      )
    : await listModels(userId, request.signal);

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
    // Runtime V2 supplies session-scoped loopback wiring directly to
    // ChatMock. Clear legacy persisted values here: saving a dynamic port
    // makes the next app session connect to a dead endpoint.
    apiKey: "",
    baseUrl: "",
    enabled: true,
    models: unique.slice(0, MAX_SYNCED_MODELS),
  });

  return {
    synced: Math.min(unique.length, MAX_SYNCED_MODELS),
    skipped: models.length - unique.length,
    state,
  };
}

const autoSyncState = globalThis as typeof globalThis & {
  __breadboardSubscriptionAutoSync?: { lastStartedAt: number; inFlight: boolean };
};

/**
 * Keep the subscription catalog current without anyone pressing a button.
 *
 * Signing in used to be the only moment the list was read, so a model the
 * subscription gained afterwards stayed invisible until the next sign-in.
 * Every read of the model picker now schedules a sync when the last one is
 * older than `AUTO_SYNC_INTERVAL_MS`. It runs after the response is on its
 * way and never fails the read: a proxy that is down simply leaves the
 * catalog as it was.
 */
export function scheduleSubscriptionCatalogAutoSync(
  request: Request,
  userId: number,
  now = Date.now(),
): boolean {
  const state = (autoSyncState.__breadboardSubscriptionAutoSync ??= {
    lastStartedAt: 0,
    inFlight: false,
  });
  if (state.inFlight || now - state.lastStartedAt < AUTO_SYNC_INTERVAL_MS) {
    return false;
  }
  state.inFlight = true;
  state.lastStartedAt = now;
  // The read's own signal aborts when its response is sent; the sync must
  // outlive it, so it gets a request of its own.
  const detached = new Request(request.url, { headers: request.headers });
  void syncSubscriptionCatalog(detached, userId)
    .catch(() => undefined)
    .finally(() => {
      state.inFlight = false;
    });
  return true;
}
