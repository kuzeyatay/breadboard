"use client";

// Calendar connections on the profile page.
//
// Public ICS/webcal links are read-only subscriptions. CalDAV is the two-way
// path: connecting is three fields and a choice — where the server is, who you
// are, and which of that account's calendars to mirror. The password is sent
// once, sealed on the server (src/lib/calendar/caldav-credentials.ts), and
// never comes back.
//
// Everything else here is status. A synced calendar is one that can lose an
// edit to a server, and the panel says plainly when it last spoke to one and
// what happened.

import { useCallback, useState } from "react";

import Badge from "./badge";
import type { CalendarCollection } from "@/lib/calendar/types.ts";

interface RemoteCalendar {
  href: string;
  name: string;
  color: string | null;
  readOnly: boolean;
}

interface SyncOutcome {
  pulled: { created: number; updated: number; removed: number };
  pushed: { uploaded: number; deleted: number };
  conflicts: number;
  unchanged: boolean;
  warnings: string[];
}

interface SubscriptionOutcome {
  calendar: CalendarCollection;
  created: number;
  updated: number;
  removed: number;
  warnings: string[];
}

const FIELD =
  "w-full rounded-lg border border-gray-800 bg-transparent px-2.5 py-1.5 text-xs text-gray-200 placeholder:text-gray-600 focus:border-gray-700 focus:outline-none";

/** "4 minutes ago" while that is the useful framing, a date afterwards. */
function whenSynced(stamp: string | null): string {
  if (!stamp) return "never";
  const when = new Date(stamp);
  if (Number.isNaN(when.getTime())) return "never";
  const minutes = Math.round((Date.now() - when.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return when.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function hostOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** What a finished sync actually did, in one line. */
function describeOutcome(outcome: SyncOutcome): string {
  if (outcome.unchanged) return "Already up to date.";
  const parts: string[] = [];
  const received = outcome.pulled.created + outcome.pulled.updated;
  if (outcome.pushed.uploaded) parts.push(`sent ${outcome.pushed.uploaded}`);
  if (outcome.pushed.deleted) parts.push(`removed ${outcome.pushed.deleted} there`);
  if (received) parts.push(`received ${received}`);
  if (outcome.pulled.removed) parts.push(`removed ${outcome.pulled.removed} here`);
  if (!parts.length) return "Nothing to exchange.";
  return `${parts.join(", ")}.`;
}

export default function CalendarSyncPanel({
  initial,
  vaultConfigured,
}: {
  initial: CalendarCollection[];
  /** False when no key is set to seal a password with, so connecting is refused. */
  vaultConfigured: boolean;
}) {
  const [calendars, setCalendars] = useState<CalendarCollection[]>(initial);
  const [subscriptionUrl, setSubscriptionUrl] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [found, setFound] = useState<RemoteCalendar[] | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/calendar/calendars", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      setCalendars(
        (payload.calendars ?? []).filter(
          (calendar: CalendarCollection) => calendar.sourceUrl || calendar.caldavUrl,
        ),
      );
    } catch {
      // See the contacts panel: an unreachable endpoint leaves the card showing
      // what it already had rather than shouting about it.
    }
  }, []);

  async function call(path: string, method: string, body?: unknown) {
    const response = await fetch(path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? "That did not work.");
    return payload;
  }

  async function discover() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const payload = await call("/api/calendar/caldav/discover", "POST", {
        url: url.trim(),
        username: username.trim(),
        password,
      });
      setFound(payload.calendars ?? []);
      setChosen(payload.calendars?.find((entry: RemoteCalendar) => !entry.readOnly)?.href ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function subscribe() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const payload = (await call("/api/calendar/subscriptions", "POST", {
        url: subscriptionUrl.trim(),
      })) as SubscriptionOutcome;
      const imported = payload.created + payload.updated;
      setNote(
        [
          `${payload.calendar.name}: added ${imported} event${imported === 1 ? "" : "s"}.`,
          ...payload.warnings,
        ]
          .join(" ")
          .trim(),
      );
      setSubscriptionUrl("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshSubscription(calendar: CalendarCollection) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const payload = (await call(
        `/api/calendar/calendars/${calendar.id}/refresh`,
        "POST",
      )) as SubscriptionOutcome;
      const changed = payload.created + payload.updated + payload.removed;
      setNote(
        [
          changed === 0
            ? `${calendar.name}: already up to date.`
            : `${calendar.name}: ${changed} change${changed === 1 ? "" : "s"} received.`,
          ...payload.warnings,
        ]
          .join(" ")
          .trim(),
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function removeSubscription(calendar: CalendarCollection) {
    if (!window.confirm(`Remove "${calendar.name}" and its imported events?`)) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await call(`/api/calendar/calendars/${calendar.id}`, "DELETE");
      setNote(`${calendar.name} was removed.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const payload = (await call("/api/calendar/caldav/connect", "POST", {
        url: url.trim(),
        username: username.trim(),
        password,
        collectionHref: chosen,
      })) as SyncOutcome & { calendar: CalendarCollection };

      setNote(`${payload.calendar.name}: ${describeOutcome(payload)}`);
      // The password has been sealed server-side; there is no reason to keep a
      // copy of it in the page after that.
      setPassword("");
      setFound(null);
      setChosen("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function syncNow(calendar: CalendarCollection) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const payload = (await call(
        `/api/calendar/caldav/${calendar.id}`,
        "POST",
      )) as SyncOutcome & { calendar: CalendarCollection };
      setNote(
        [`${calendar.name}: ${describeOutcome(payload)}`, ...payload.warnings]
          .join(" ")
          .trim(),
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(calendar: CalendarCollection) {
    setBusy(true);
    setError(null);
    try {
      await call(`/api/calendar/caldav/${calendar.id}`, "DELETE");
      setNote(`${calendar.name} is yours alone again. Its events stayed here.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const subscriptions = calendars.filter((calendar) => calendar.sourceUrl);
  const caldavCalendars = calendars.filter((calendar) => calendar.caldavUrl);

  return (
    <section className="neu-surface-raised rounded-2xl border border-gray-800 p-5">
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-white">Calendars</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Add a schedule from a link or connect your calendar account.
        </p>
      </header>

      <div>
        <h3 className="text-xs font-medium text-gray-200">Add from a link</h3>
        <p className="mt-1 text-[11px] leading-5 text-gray-500">
          Paste the calendar link you copied from TimeEdit, Google Calendar, or Outlook.
        </p>

        {subscriptions.length > 0 ? (
          <div className="mt-3 space-y-1">
            {subscriptions.map((calendar) => (
              <div key={calendar.id} className="neu-inset rounded-xl px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="block h-2 w-2 shrink-0 rounded-full"
                        style={{ background: calendar.color }}
                      />
                      <span className="truncate text-xs font-medium text-gray-200">
                        {calendar.name}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                      {hostOf(calendar.sourceUrl)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Badge tone="neutral" title="This calendar can be viewed here">
                      View only
                    </Badge>
                    {calendar.syncError ? (
                      <Badge tone="warn" title={calendar.syncError}>
                        Needs attention
                      </Badge>
                    ) : (
                      <Badge tone="derived" title="When this calendar was last refreshed">
                        {whenSynced(calendar.lastSyncedAt)}
                      </Badge>
                    )}
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void refreshSubscription(calendar)}
                    className="neu-button rounded-lg border border-gray-700 px-2.5 py-1 text-[11px] text-gray-300 transition-colors hover:text-white disabled:opacity-50"
                  >
                    Update now
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeSubscription(calendar)}
                    className="neu-button rounded-lg border border-gray-800 px-2.5 py-1 text-[11px] text-gray-500 transition-colors hover:text-gray-300 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>

                {calendar.syncError ? (
                  <p className="mt-2 text-[11px] leading-5 text-[#a45f56]">
                    {calendar.syncError}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void subscribe();
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={subscriptionUrl}
            onChange={(event) => setSubscriptionUrl(event.target.value)}
            placeholder="https://cloud.timeedit.net/…/schedule.ics"
            className={`${FIELD} min-w-0 flex-1`}
            aria-label="Public calendar address"
            type="url"
            autoComplete="url"
          />
          <button
            type="submit"
            disabled={busy || !subscriptionUrl.trim()}
            className="neu-button-primary shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-gray-950 transition-colors hover:bg-gray-100 disabled:opacity-50"
          >
            Add calendar
          </button>
        </form>
      </div>

      <div className="mt-5 border-t border-gray-800 pt-4">
        <h3 className="text-xs font-medium text-gray-200">Connect an account</h3>
        <p className="mt-1 text-[11px] leading-5 text-gray-500">
          For Nextcloud, Fastmail, or iCloud. Changes stay up to date in both places.
        </p>

        {!vaultConfigured ? (
          <p className="neu-inset mt-3 rounded-xl px-4 py-3 text-xs leading-5 text-gray-400">
            Calendar accounts cannot be connected right now. You can still add a calendar from a
            link above.
          </p>
        ) : null}

        {caldavCalendars.length > 0 ? (
          <div className="mt-3 space-y-1">
            {caldavCalendars.map((calendar) => (
            <div key={calendar.id} className="neu-inset rounded-xl px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: calendar.color }}
                    />
                    <span className="truncate text-xs font-medium text-gray-200">
                      {calendar.name}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                    {calendar.caldavUsername ? `${calendar.caldavUsername} · ` : ""}
                    {hostOf(calendar.caldavUrl)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Badge tone="active" title="Changes stay up to date in both places">
                    Connected
                  </Badge>
                  {calendar.syncError ? (
                    <Badge tone="warn" title={calendar.syncError}>
                      Needs attention
                    </Badge>
                  ) : (
                    <Badge tone="derived" title="When this calendar last spoke to the server">
                      {whenSynced(calendar.lastSyncedAt)}
                    </Badge>
                  )}
                </span>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void syncNow(calendar)}
                  className="neu-button rounded-lg border border-gray-700 px-2.5 py-1 text-[11px] text-gray-300 transition-colors hover:text-white disabled:opacity-50"
                >
                  Sync now
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void disconnect(calendar)}
                  className="neu-button rounded-lg border border-gray-800 px-2.5 py-1 text-[11px] text-gray-500 transition-colors hover:text-gray-300 disabled:opacity-50"
                >
                  Disconnect
                </button>
              </div>

              {calendar.syncError ? (
                <p className="mt-2 text-[11px] leading-5 text-[#a45f56]">{calendar.syncError}</p>
              ) : null}
            </div>
            ))}
          </div>
        ) : null}

        <div className="mt-3 space-y-2">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Calendar account address"
            className={FIELD}
            aria-label="Calendar account address"
            autoComplete="off"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Username"
              className={FIELD}
              aria-label="Username"
              autoComplete="off"
            />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              type="password"
              className={FIELD}
              aria-label="Password"
              autoComplete="new-password"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !vaultConfigured || !url.trim() || !username.trim() || !password}
              onClick={() => void discover()}
              className="neu-button rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:text-white disabled:opacity-50"
            >
              {busy && !found ? "Looking…" : "Continue"}
            </button>
            <span className="text-[11px] text-gray-600">
              Use an app password if your calendar provider gave you one.
            </span>
          </div>

          {found ? (
            <div className="space-y-1 pt-1">
              {found.map((remote) => (
                <label
                  key={remote.href}
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${
                    chosen === remote.href
                      ? "border-gray-700 text-gray-200"
                      : "border-gray-800 text-gray-400"
                  } ${remote.readOnly ? "opacity-60" : "cursor-pointer"}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <input
                      type="radio"
                      name="caldav-collection"
                      value={remote.href}
                      checked={chosen === remote.href}
                      disabled={remote.readOnly}
                      onChange={() => setChosen(remote.href)}
                      className="accent-[var(--botanical)]"
                    />
                    <span className="truncate">{remote.name}</span>
                  </span>
                  {remote.readOnly ? <Badge tone="neutral">Read-only there</Badge> : null}
                </label>
              ))}

              <button
                type="button"
                disabled={busy || !chosen}
                onClick={() => void connect()}
                className="neu-button-primary mt-1 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-gray-950 transition-colors hover:bg-gray-100 disabled:opacity-50"
              >
                Connect calendar
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="mt-3 text-xs leading-5 text-[#a45f56]" role="alert">
          {error}
        </p>
      ) : null}
      {note ? <p className="mt-3 text-xs leading-5 text-gray-400">{note}</p> : null}
    </section>
  );
}
