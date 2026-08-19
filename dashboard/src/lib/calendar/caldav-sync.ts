// Two-way sync between a local calendar and a CalDAV collection.
//
// ./subscription.ts is the read-only half: download an ICS document, replace
// everything, done. That works because nothing local can ever be worth keeping.
// Here both sides can change, so the exchange has four steps and a stated
// policy for the case where they changed the same thing.
//
//   1. push deletions — objects deleted here, removed there
//   2. push edits     — objects changed here, written there with If-Match
//   3. list           — which objects exist there, and at which version
//   4. pull           — download what changed, delete what vanished
//
// The policy is **the server wins**. If a PUT is refused because the object
// moved under us, the local edit is dropped and the server's version pulled in
// its place, with a warning naming the event. That is the honest resolution for
// a calendar: the other side may have already told six people about the new
// time, and silently overwriting that is worse than losing an edit the user can
// still see and redo.
//
// The protocol lives in ./caldav-client.ts and the SQL in ./store.ts; this
// module is the reconciliation between them, and takes an injected `fetch` so
// it can be tested against a scripted server.

import {
  CaldavError,
  deleteRemoteObject,
  fetchRemoteObjects,
  listRemoteEtags,
  objectHrefForUid,
  putRemoteObject,
  readCtag,
  type CaldavAccount,
  type CaldavOptions,
} from "./caldav-client.ts";
import { parseCalendar, serializeCalendar } from "./ics.ts";
import { CalendarError, type CalendarStore } from "./store.ts";
import { nowStamp } from "./wallclock.ts";

/**
 * How long one sync holds a calendar.
 *
 * Long enough for a slow server and a big first pull, short enough that a
 * process killed mid-sync does not lock the calendar out for the rest of the
 * day. Two syncs of one calendar at once would have the second one's writes
 * refused as conflicts, and a conflict resolves by discarding the local edit —
 * so the lease is not an optimisation, it is what stops the background poller
 * and a person pressing Sync now from between them losing an edit.
 */
export const SYNC_LEASE_MS = 5 * 60_000;

export interface CaldavSyncResult {
  /** What came in from the server. */
  pulled: { created: number; updated: number; removed: number };
  /** What went out to it. */
  pushed: { uploaded: number; deleted: number };
  /** Edits the server refused because its copy was newer. Its copy was kept. */
  conflicts: number;
  /** True when the collection tag said nothing had changed and nothing was pending. */
  unchanged: boolean;
  warnings: string[];
}

const EMPTY_RESULT: CaldavSyncResult = {
  pulled: { created: 0, updated: 0, removed: 0 },
  pushed: { uploaded: 0, deleted: 0 },
  conflicts: 0,
  unchanged: true,
  warnings: [],
};

/**
 * Send one local event (a series and its per-instance edits) to the server.
 *
 * Returns the etag the server assigned, `null` when it assigned one but did not
 * say which — a PUT is allowed to answer without an ETag header, and the next
 * listing will simply see a version we do not hold and fetch it back.
 */
async function pushOne(
  store: CalendarStore,
  userId: number,
  collectionHref: string,
  pending: ReturnType<CalendarStore["pendingPushes"]>[number],
  account: CaldavAccount,
  options: CaldavOptions,
): Promise<{ pushed: boolean; conflictHref: string | null }> {
  const href = pending.href ?? objectHrefForUid(collectionHref, pending.event.uid);
  const ics = serializeCalendar([pending.event, ...pending.overrides], {
    now: nowStamp(),
  });

  const result = await putRemoteObject(account, href, ics, { ...options, etag: pending.etag });
  if (result.conflict) return { pushed: false, conflictHref: href };

  store.markRemoteSynced(userId, pending.event.id, { href, etag: result.etag });
  return { pushed: true, conflictHref: null };
}

/**
 * Write a downloaded resource into the local calendar.
 *
 * One resource is one UID: a series plus any per-instance edits of it. The
 * ingest is by UID, and the href and etag are attached afterwards so the row
 * comes out of the exchange settled rather than looking like a local change
 * waiting to be uploaded again.
 */
function ingestOne(
  store: CalendarStore,
  userId: number,
  calendarId: number,
  object: { href: string; etag: string | null; ics: string },
  warnings: Set<string>,
): { created: number; updated: number } {
  const parsed = parseCalendar(object.ics, calendarId);
  for (const warning of parsed.warnings) warnings.add(warning);
  if (!parsed.events.length) return { created: 0, updated: 0 };

  const counts = store.ingestEvents(
    userId,
    calendarId,
    parsed.events.map((event) => ({ ...event, calendarId })),
  );

  const uids = new Set(
    parsed.events
      .map((event) => (typeof event.uid === "string" ? event.uid.trim() : ""))
      .filter(Boolean),
  );
  for (const uid of uids) {
    const masterId = store.findMasterByUid(userId, calendarId, uid);
    if (masterId) store.markRemoteSynced(userId, masterId, object);
  }

  return { created: counts.created, updated: counts.updated };
}

/**
 * Reconcile one calendar with its remote collection.
 *
 * The failure is recorded on the calendar before it is re-thrown, so the
 * sidebar can say what went wrong without the user having to press sync again
 * to find out — the same contract `refreshSubscription` follows.
 */
export async function syncCaldavCalendar(
  store: CalendarStore,
  userId: number,
  calendarId: number,
  account: CaldavAccount,
  options: CaldavOptions = {},
): Promise<CaldavSyncResult> {
  const binding = store.getCaldavBinding(userId, calendarId);
  if (!binding) {
    const calendar = store.getCalendar(userId, calendarId);
    throw new CalendarError(400, `"${calendar.name}" is not synced with a server.`);
  }

  const claimed = store.claimCaldavSync(
    calendarId,
    new Date(Date.now() + SYNC_LEASE_MS).toISOString(),
    new Date().toISOString(),
  );
  if (!claimed) {
    const calendar = store.getCalendar(userId, calendarId);
    throw new CalendarError(409, `"${calendar.name}" is syncing right now.`);
  }

  const collection = binding.url;
  const warnings = new Set<string>();
  const result: CaldavSyncResult = {
    ...EMPTY_RESULT,
    pulled: { created: 0, updated: 0, removed: 0 },
    pushed: { uploaded: 0, deleted: 0 },
    conflicts: 0,
    unchanged: true,
    warnings: [],
  };

  try {
    // 1 — deletions. A tombstone survives exactly until the server has been
    // told; a 404 counts as told, which is what makes a retried sync safe.
    for (const tombstone of store.pendingTombstones(userId, calendarId)) {
      const outcome = await deleteRemoteObject(account, tombstone.href, {
        ...options,
        etag: tombstone.etag,
      });
      // A refused deletion means the object changed on the server after we
      // deleted our copy. The tombstone goes either way: the pull below brings
      // the server's version back, which is the server winning, as promised.
      store.clearTombstone(userId, tombstone.id);
      if (outcome.conflict) {
        result.conflicts += 1;
        warnings.add("An event deleted here had also changed on the server; it came back.");
      } else {
        result.pushed.deleted += 1;
      }
      result.unchanged = false;
    }

    // 2 — edits.
    const conflictHrefs: string[] = [];
    for (const pending of store.pendingPushes(userId, calendarId)) {
      const outcome = await pushOne(store, userId, collection, pending, account, options);
      if (outcome.pushed) {
        result.pushed.uploaded += 1;
      } else if (outcome.conflictHref) {
        result.conflicts += 1;
        conflictHrefs.push(outcome.conflictHref);
        warnings.add(
          `"${pending.event.title}" had also changed on the server, so the server's version was kept.`,
        );
      }
      result.unchanged = false;
    }

    // 3 — what does the server have? The collection tag answers "anything at
    // all?" in one cheap request; only when it has moved is the full listing
    // worth asking for. Servers that do not implement it return null, and the
    // listing then happens every time, which is correct and only chattier.
    const ctag = await readCtag(account, collection, options);
    if (ctag && ctag === binding.ctag && result.unchanged) {
      store.markCaldavSynced(userId, calendarId, { syncedAt: nowStamp(), ctag, error: null });
      return { ...result, warnings: [...warnings] };
    }

    const remote = await listRemoteEtags(account, collection, options);
    const local = store.remoteHrefs(userId, calendarId);

    const changed: string[] = [];
    for (const [href, etag] of remote) {
      const held = local.get(href);
      // No etag from the server means it will not commit to a version, so the
      // object is fetched every time rather than assumed unchanged.
      if (!held || !etag || held.etag !== etag) changed.push(href);
    }
    // A conflicted write must be re-read even if its etag looks familiar: our
    // copy of that etag is exactly the thing the server just told us was stale.
    for (const href of conflictHrefs) if (!changed.includes(href)) changed.push(href);

    // 4 — everything we hold that the server no longer lists is gone there.
    const vanished = [...local.keys()].filter((href) => !remote.has(href));
    result.pulled.removed = store.deleteEventsByRemoteHref(userId, calendarId, vanished);

    for (const object of await fetchRemoteObjects(account, collection, changed, options)) {
      const counts = ingestOne(store, userId, calendarId, object, warnings);
      result.pulled.created += counts.created;
      result.pulled.updated += counts.updated;
    }

    if (changed.length || vanished.length) result.unchanged = false;

    // The tag stored is the one read *before* the listing: a change made on the
    // server between the listing and now would otherwise be hidden behind a tag
    // that claims we already have it.
    store.markCaldavSynced(userId, calendarId, { syncedAt: nowStamp(), ctag, error: null });

    return { ...result, warnings: [...warnings] };
  } catch (error) {
    const message =
      error instanceof CaldavError || error instanceof CalendarError
        ? error.message
        : "Sync failed";
    store.markCaldavSynced(userId, calendarId, {
      syncedAt: nowStamp(),
      error: message.slice(0, 300),
    });
    throw error;
  } finally {
    store.releaseCaldavSync(calendarId);
  }
}
