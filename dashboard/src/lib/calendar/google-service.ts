import "server-only";
import { composioClient, composioConfigured } from "../composio/client.ts";
import { listComposioConnections } from "../composio/service.ts";
import { getCalendarStore } from "./instance.ts";
import { CalendarError } from "./store.ts";
import { googleSyncRange, syncGoogleCalendars, type GoogleSyncRange, type GoogleSyncResult } from "./google-sync.ts";

type SyncState = { range: GoogleSyncRange; at: number; pending?: Promise<GoogleSyncResult>; result?: GoogleSyncResult };
const globals = globalThis as typeof globalThis & { breadboardGoogleSyncs?: Map<number, SyncState> };
const states = globals.breadboardGoogleSyncs ??= new Map<number, SyncState>();

/** Coalesce page/widget requests and refresh at most once a minute per range. */
export async function refreshGoogleCalendars(userId: number, options: { from?: string | null; to?: string | null; force?: boolean } = {}): Promise<GoogleSyncResult> {
  if (!composioConfigured()) return { connected: false, synced: 0, error: null };
  const range = googleSyncRange(options.from, options.to);
  const previous = states.get(userId);
  if (previous?.pending) {
    const result = await previous.pending;
    if (previous.range.from <= range.from && previous.range.to >= range.to) return result;
  }
  if (!options.force && previous?.result && Date.now() - previous.at < 60_000 &&
      previous.range.from <= range.from && previous.range.to >= range.to) return previous.result;
  const state: SyncState = { range, at: Date.now() };
  states.set(userId, state);
  state.pending = syncGoogleCalendars(getCalendarStore(), userId, range, {
    accounts: () => listComposioConnections(userId),
    get: async (accountId, path, query) => {
      const response = await composioClient().tools.proxyExecute({
        connectedAccountId: accountId,
        endpoint: `https://www.googleapis.com${path}`,
        method: "GET",
        parameters: Object.entries(query).map(([name, value]) => ({ in: "query" as const, name, value })),
      }, { signal: AbortSignal.timeout(20_000) });
      if (response.status < 200 || response.status >= 300 || !Number.isInteger(response.status)) {
        throw new CalendarError(502, response.status === 401 || response.status === 403
          ? "Google Calendar access was denied. Reconnect it in Connections and allow calendar access."
          : "Google Calendar could not update. Try again shortly.");
      }
      return response.data;
    },
  });
  try {
    state.result = await state.pending;
    state.at = Date.now();
    return state.result;
  } finally {
    state.pending = undefined;
    for (const [id, cached] of states) {
      if (!cached.pending && Date.now() - cached.at > 5 * 60_000) states.delete(id);
    }
  }
}
