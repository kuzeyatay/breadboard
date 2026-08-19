"use client";

// Two-way calendar sync, on the profile page.
//
// Connecting is three fields and a choice: where the server is, who you are,
// and which of that account's calendars to mirror. The password is sent once,
// sealed on the server (src/lib/calendar/caldav-credentials.ts), and never
// comes back — so this panel holds it in state only until the calendar is
// connected, and drops it immediately afterwards.
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
      const response = await fetch("/api/calendar/caldav");
      if (!response.ok) return;
      const payload = await response.json();
      setCalendars(payload.calendars ?? []);
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

  return (
    <section className="neu-surface-raised rounded-2xl border border-gray-800 p-5">
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-white">Calendar sync</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          A calendar on a CalDAV server — Nextcloud, Fastmail, iCloud — kept the same in both
          directions, not just read. Breadboard reconciles on its own in the background; the
          button is for when you would rather not wait.
        </p>
      </header>

      {!vaultConfigured ? (
        <p className="neu-inset rounded-xl px-4 py-3 text-xs leading-5 text-gray-400">
          Set <span className="text-gray-200">NEXTAUTH_SECRET</span> (or{" "}
          <span className="text-gray-200">BREADBOARD_CALENDAR_VAULT_KEY</span>) before connecting a
          calendar. Until then there is nowhere safe to keep the password.
        </p>
      ) : null}

      {calendars.length > 0 ? (
        <div className="space-y-1">
          {calendars.map((calendar) => (
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
                  <Badge tone="active" title="Changes travel in both directions">
                    Two-way
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
      ) : (
        <p className="neu-inset rounded-xl px-4 py-6 text-center text-xs text-gray-500">
          No calendar syncs yet. Connect one below.
        </p>
      )}

      <div className="mt-4 space-y-2 border-t border-gray-800 pt-4">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://cloud.example.com/remote.php/dav/"
          className={FIELD}
          aria-label="CalDAV server address"
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
            placeholder="App password"
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
            {busy && !found ? "Looking…" : "Find calendars"}
          </button>
          <span className="text-[11px] text-gray-600">
            Most servers want an app password, not your account password.
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
              Connect and sync
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="text-xs leading-5 text-[#a45f56]" role="alert">
            {error}
          </p>
        ) : null}
        {note ? <p className="text-xs leading-5 text-gray-400">{note}</p> : null}
      </div>
    </section>
  );
}
