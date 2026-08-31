"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";

import BackLink from "@/app/components/back-link";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import BrainMapPanel from "./brain-map-panel";
import BrowserProfilePanel from "./browser-profile-panel";
import ContactsPanel from "./contacts-panel";
import CalendarSyncPanel from "./calendar-sync-panel";
import type { BrowserProfileState } from "@/lib/agent-browser/service.ts";
import type { Contact } from "@/lib/contacts/types.ts";
import type { CalendarCollection } from "@/lib/calendar/types.ts";
import {
  MONTH_ABBREVIATIONS,
  WEEKDAY_ABBREVIATIONS,
  formatLongDate,
  formatShortDate,
} from "@/lib/calendar/format.ts";
import {
  NAVBAR_SHORTCUTS,
  type NavbarShortcuts,
} from "@/lib/profile/navbar-shortcuts.ts";
import { formatUsd } from "@/lib/profile/model-pricing.ts";
import type {
  ActivityDay,
  AuditEntry,
  ProfileCost,
  ProfileLatency,
  ProfileMemory,
  ProfileReliability,
  ProfileStats,
} from "@/lib/profile/stats.ts";
import type {
  ReviewChannel,
  ReviewStats,
  ReviewUserSettings,
} from "@/lib/review/types.ts";
import {
  APP_THEME_MODE_CHANGE_EVENT,
  APP_THEME_MODE_STORAGE_KEY,
  applyAppThemeMode,
  getStoredAppThemeMode,
  rememberAppThemeLocation,
} from "@/lib/app-theme.ts";
import {
  announceCurrentLocationChange,
  clearStoredCurrentLocationPreference,
  getStoredCurrentLocationPreference,
  normalizeCurrentLocationSnapshot,
  subscribeCurrentLocation,
  writeStoredCurrentLocationPreference,
  type CurrentLocationPreference,
  type CurrentLocationSnapshot,
} from "@/lib/current-location.ts";
import {
  inDesktopShell,
  requestCurrentLocationFix,
} from "@/lib/current-location-source.ts";
import {
  startupSoundControl,
  type StartupSoundControl,
} from "@/lib/desktop-startup-sound.ts";

interface Invite {
  id: number;
  code: string;
  created_at: string;
  used_at: string | null;
}

interface GoogleImageGenerationStatus {
  available: boolean;
  configured: boolean;
}

const numbers = new Intl.NumberFormat("en-US");

function formatCount(value: number): string {
  return numbers.format(value);
}

/** "5.8M", "12.4k", "812" — a headline number that fits in a tile. */
function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return formatCount(value);
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) return "under a minute";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/**
 * A duration written at the scale it actually happened.
 *
 * `formatDuration` rounds to whole minutes, which turns every normal reply into
 * "under a minute" — true, and the opposite of informative when the thing being
 * described is an eight-second wait.
 */
function formatShortDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

/** "3 hours ago" while that is still the useful framing, a date afterwards. */
function relativeTime(value: string): string {
  const at = Date.parse(value.replace(" ", "T"));
  if (!Number.isFinite(at)) return formatShortDate(dateOnly(value));
  const minutes = Math.floor(Math.max(0, Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatShortDate(dateOnly(value));
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * What the peak hour says about the person, in one clause.
 *
 * Deliberately coarse — the histogram beside it carries the detail, and a
 * sharper claim than the data supports would be worse than none.
 */
function rhythmPhrase(peakHour: number): string {
  if (peakHour < 5) return "the small hours are yours";
  if (peakHour < 9) return "you start before most people do";
  if (peakHour < 12) return "you do your thinking in the morning";
  if (peakHour < 17) return "the afternoon is your working stretch";
  if (peakHour < 21) return "you get going after the day winds down";
  return "you are a night owl";
}

// ------------------------------------------------------------------ pieces

function Card({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`neu-surface-raised rounded-2xl border border-gray-800 p-5 ${className ?? ""}`}
    >
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

/**
 * One card inside a balanced column set. Multi-column layout is free to split a
 * block across the column boundary, which would tear a card in half, so every
 * item opts out and the browser breaks between cards instead.
 */
function Packed({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 break-inside-avoid">{children}</div>;
}

function Stat({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="neu-surface rounded-xl border border-gray-800 px-4 py-3">
      <div className="text-2xl font-semibold leading-tight text-white">{value}</div>
      <div className="mt-0.5 text-xs font-medium text-gray-400">{label}</div>
      {hint && <div className="mt-1 text-[11px] text-gray-600">{hint}</div>}
    </div>
  );
}

/** A labelled proportional bar. `share` is 0–1 of the row's own maximum. */
function Bar({
  label,
  value,
  share,
  href,
  meta,
}: {
  label: string;
  value: string;
  share: number;
  href?: string;
  meta?: string;
}) {
  const name = href ? (
    <Link href={href} className="truncate text-gray-300 transition-colors hover:text-white">
      {label}
    </Link>
  ) : (
    <span className="truncate text-gray-300">{label}</span>
  );

  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-xs">
      {name}
      <span
        className="neu-progress-track h-2 overflow-hidden rounded-full"
        role="presentation"
      >
        <span
          className="block h-full rounded-full"
          style={{
            width: `${Math.max(2, Math.round(share * 100))}%`,
            background: "var(--botanical)",
          }}
        />
      </span>
      <span className="tabular-nums text-gray-500">
        {value}
        {meta && <span className="ml-2 text-gray-600">{meta}</span>}
      </span>
    </div>
  );
}

/** The five-step scale the grid and its legend both draw from. */
function cellColor(level: number): string {
  if (level <= 0) return "color-mix(in srgb, var(--line) 45%, var(--paper-surface))";
  const strength = [0, 26, 46, 68, 92][level] ?? 92;
  return `color-mix(in srgb, var(--botanical) ${strength}%, var(--paper-surface))`;
}

function ActivityGrid({ days, weeks }: { days: ActivityDay[]; weeks: number }) {
  const max = days.reduce((best, day) => Math.max(best, day.count), 0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selectedDay = days.find((day) => day.date === selectedDate) ?? null;

  const columns = useMemo(() => {
    const grouped: ActivityDay[][] = [];
    for (let index = 0; index < weeks; index += 1) {
      grouped.push(days.slice(index * 7, index * 7 + 7));
    }
    return grouped;
  }, [days, weeks]);

  const monthLabels = columns.map((week, index) => {
    const month = week[0]?.date.slice(5, 7);
    const previous = columns[index - 1]?.[0]?.date.slice(5, 7);
    return index === 0 || month === previous
      ? ""
      : (MONTH_ABBREVIATIONS[Number(month) - 1] ?? "");
  });

  if (max === 0) {
    return (
      <div className="neu-inset rounded-xl px-4 py-8 text-center">
        <p className="text-sm text-gray-400">No prompt activity in this period.</p>
        <p className="mt-1 text-xs text-gray-600">
          This chart will fill from your real conversations as you use Breadboard.
        </p>
      </div>
    );
  }

  return (
    <figure aria-label={`Prompt activity over the last ${weeks} weeks`}>
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex min-w-full gap-2">
          <div className="flex shrink-0 flex-col justify-end gap-[3px] pb-0 pt-[18px] text-[10px] text-gray-600">
            {WEEKDAY_ABBREVIATIONS.map((day, index) => (
              <span key={day} className="h-[11px] leading-[11px]">
                {index % 2 === 1 ? day : ""}
              </span>
            ))}
          </div>

          <div>
            <div className="mb-1 flex gap-[3px] text-[10px] leading-[14px] text-gray-600">
              {monthLabels.map((label, index) => (
                <span key={index} className="w-[11px] shrink-0 whitespace-nowrap">
                  {label}
                </span>
              ))}
            </div>
            <div className="flex gap-[3px]">
              {columns.map((week, weekIndex) => (
                <div key={weekIndex} className="flex flex-col gap-[3px]">
                  {week.map((day) => {
                    const level =
                      day.count === 0 ? 0 : Math.max(1, Math.ceil((day.count / max) * 4));
                    const promptLabel = day.count === 1 ? "1 prompt" : `${day.count} prompts`;
                    const selected = selectedDate === day.date;
                    return (
                      <button
                        key={day.date}
                        type="button"
                        disabled={day.future}
                        aria-label={
                          day.future
                            ? `${formatLongDate(day.date)}: future date`
                            : `${formatLongDate(day.date)}: ${promptLabel}`
                        }
                        aria-pressed={day.future ? undefined : selected}
                        onClick={() => setSelectedDate(day.date)}
                        className="h-[11px] w-[11px] rounded-[2px] transition-transform hover:scale-125 focus-visible:z-10 focus-visible:scale-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--botanical)] disabled:pointer-events-none"
                        style={{
                          background: day.future ? "transparent" : cellColor(level),
                          opacity: day.future ? 0.35 : 1,
                          boxShadow: selected
                            ? "0 0 0 2px var(--paper-surface), 0 0 0 4px var(--botanical)"
                            : day.future
                              ? "inset 0 0 0 1px color-mix(in srgb, var(--line) 60%, transparent)"
                              : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-gray-600">
        <span>Quieter</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            className="h-[11px] w-[11px] rounded-[2px]"
            style={{ background: cellColor(level) }}
          />
        ))}
        <span>Busier</span>
      </div>

      <figcaption className="neu-inset mt-4 min-h-16 rounded-xl px-3.5 py-3" aria-live="polite">
        {selectedDay ? (
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <strong className="text-sm font-medium text-gray-200">
                {formatLongDate(selectedDay.date)}
              </strong>
              <span className="text-xs tabular-nums text-gray-500">
                {selectedDay.count === 1 ? "1 prompt" : `${selectedDay.count} prompts`}
              </span>
            </div>
            {selectedDay.conversations.length === 0 ? (
              <p className="mt-1.5 text-xs text-gray-600">No conversations on this day.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {selectedDay.conversations.slice(0, 4).map((conversation) => (
                  <li
                    key={conversation.id}
                    className="flex min-w-0 items-center justify-between gap-3 text-xs"
                  >
                    <span className="min-w-0 truncate text-gray-400">
                      {conversation.title}
                      {conversation.garden && (
                        <Link
                          href={`/gardens/${conversation.garden.slug}`}
                          className="ml-1.5 text-gray-600 transition-colors hover:text-gray-300"
                        >
                          in {conversation.garden.name}
                        </Link>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-gray-600">
                      {conversation.prompts} prompt{conversation.prompts === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
                {selectedDay.conversations.length > 4 && (
                  <li className="text-xs text-gray-600">
                    +{selectedDay.conversations.length - 4} more conversations
                  </li>
                )}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-600">
            Select a day to see the conversations behind its count.
          </p>
        )}
      </figcaption>
    </figure>
  );
}

function HourHistogram({ hours }: { hours: number[] }) {
  const max = hours.reduce((best, value) => Math.max(best, value), 0);
  const total = hours.reduce((sum, value) => sum + value, 0);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);

  if (total === 0) {
    return (
      <div className="neu-inset rounded-xl px-4 py-8 text-center">
        <p className="text-sm text-gray-400">No work rhythm yet.</p>
        <p className="mt-1 text-xs text-gray-600">Your real prompt times will appear here.</p>
      </div>
    );
  }

  return (
    <figure aria-label="Prompts by hour of day">
      <div className="flex h-24 items-end gap-[3px]">
        {hours.map((value, hour) => {
          const promptLabel = value === 1 ? "1 prompt" : `${value} prompts`;
          const selected = selectedHour === hour;
          return (
            <button
              key={hour}
              type="button"
              aria-label={`${hourLabel(hour)}: ${promptLabel}`}
              aria-pressed={selected}
              onClick={() => setSelectedHour(hour)}
              className="group flex h-full flex-1 items-end rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]"
            >
              <span
                className="block w-full rounded-t-[2px] transition-[height,background-color] group-hover:brightness-110"
                style={{
                  height: `${Math.max(2, Math.round((value / max) * 100))}%`,
                  background: selected
                    ? "var(--botanical)"
                    : value === 0
                      ? "color-mix(in srgb, var(--line) 55%, var(--paper-surface))"
                      : "color-mix(in srgb, var(--botanical) 78%, var(--paper-surface))",
                }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-gray-600">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:00</span>
      </div>
      <figcaption className="mt-2 min-h-5 text-xs text-gray-500" aria-live="polite">
        {selectedHour === null
          ? "Select an hour for its exact count."
          : `${hourLabel(selectedHour)} — ${formatCount(hours[selectedHour])} prompt${hours[selectedHour] === 1 ? "" : "s"} (${Math.round((hours[selectedHour] / total) * 100)}% of your activity)`}
      </figcaption>
    </figure>
  );
}

function WeekdayHistogram({ weekdays }: { weekdays: number[] }) {
  const max = weekdays.reduce((best, value) => Math.max(best, value), 0);
  const total = weekdays.reduce((sum, value) => sum + value, 0);
  const [selectedWeekday, setSelectedWeekday] = useState<number | null>(null);

  if (total === 0) return null;

  return (
    <figure className="mt-5" aria-label="Prompts by weekday">
      <div className="grid grid-cols-7 gap-1.5">
        {weekdays.map((value, index) => {
          const selected = selectedWeekday === index;
          return (
            <div key={index} className="text-center">
              <button
                type="button"
                aria-label={`${WEEKDAY_ABBREVIATIONS[index]}: ${value} prompt${value === 1 ? "" : "s"}`}
                aria-pressed={selected}
                onClick={() => setSelectedWeekday(index)}
                className="group flex h-12 w-full items-end justify-center rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]"
              >
                <span
                  className="block w-full rounded-t-[2px] transition-[height,background-color] group-hover:brightness-110"
                  style={{
                    height: `${Math.max(3, Math.round((value / max) * 100))}%`,
                    background: selected
                      ? "var(--botanical)"
                      : "color-mix(in srgb, var(--botanical) 42%, var(--paper-surface))",
                  }}
                />
              </button>
              <div className="mt-1 text-[10px] text-gray-600">
                {WEEKDAY_ABBREVIATIONS[index]}
              </div>
            </div>
          );
        })}
      </div>
      <figcaption className="mt-2 min-h-5 text-xs text-gray-500" aria-live="polite">
        {selectedWeekday === null
          ? "Select a day for its exact count."
          : `${WEEKDAY_ABBREVIATIONS[selectedWeekday]} — ${formatCount(weekdays[selectedWeekday])} prompt${weekdays[selectedWeekday] === 1 ? "" : "s"} (${Math.round((weekdays[selectedWeekday] / total) * 100)}% of your activity)`}
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- shortcuts

function Switch({
  checked,
  label,
  busy,
  onChange,
}: {
  checked: boolean;
  label: string;
  busy: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={busy}
      onClick={onChange}
      className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
        checked ? "bg-[var(--botanical)]" : "bg-[var(--line-strong)]"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--paper-raised)] shadow transition-transform ${
          checked ? "translate-x-5" : ""
        }`}
      />
    </button>
  );
}

function subscribeThemeMode(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === APP_THEME_MODE_STORAGE_KEY) onChange();
  };
  window.addEventListener(APP_THEME_MODE_CHANGE_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(APP_THEME_MODE_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}

function currentThemeMode() {
  return getStoredAppThemeMode(window.localStorage);
}

function ThemePanel() {
  const mode = useSyncExternalStore(
    subscribeThemeMode,
    currentThemeMode,
    () => "manual" as const,
  );
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "locating" | "precise" | "fallback"
  >("idle");
  const automatic = mode === "sun";

  async function requestLocalSunTimes(): Promise<void> {
    setLocationStatus("locating");
    // A week-old fix is ample for sunrise and sunset, which move by minutes.
    const attempt = await requestCurrentLocationFix({ maxAgeMs: 7 * 86_400_000 });
    if (!attempt.ok) {
      setLocationStatus("fallback");
      return;
    }
    rememberAppThemeLocation({
      latitude: attempt.fix.latitude,
      longitude: attempt.fix.longitude,
    });
    setLocationStatus("precise");
  }

  function toggleAutomaticTheme() {
    if (automatic) {
      applyAppThemeMode("manual");
      setLocationStatus("idle");
      return;
    }
    applyAppThemeMode("sun");
    void requestLocalSunTimes();
  }

  const status =
    locationStatus === "locating"
      ? "Finding today’s local sunrise and sunset…"
      : locationStatus === "precise"
        ? "Using coarse location stored only on this device."
        : locationStatus === "fallback"
          ? "Location is unavailable, so sunrise and sunset use 06:00 and 18:00 local time."
          : automatic
            ? "Light during local daylight; dark after sunset."
            : "Your selected Light or Dark theme stays fixed.";

  return (
    <Card title="Theme" hint="Let Breadboard follow the daylight where you are.">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">Sunrise to sunset</p>
          <p className="mt-0.5 text-xs leading-5 text-gray-500">{status}</p>
        </div>
        <Switch
          checked={automatic}
          label="Automatically use light theme after sunrise and dark theme after sunset"
          busy={false}
          onChange={toggleAutomaticTheme}
        />
      </div>
    </Card>
  );
}

/**
 * The chime the desktop app opens with.
 *
 * The card is absent rather than disabled outside the desktop shell: in a
 * browser there is no startup screen, so there is no sound to mute and a switch
 * for one would be a switch that does nothing. It is also absent for the first
 * frame everywhere, because whether a shell is there can only be asked once the
 * page is running in one.
 */
function StartupSoundPanel() {
  const [control, setControl] = useState<StartupSoundControl | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const desktop = startupSoundControl();
    if (!desktop) return;
    let active = true;
    void desktop.read().then((current) => {
      if (!active) return;
      setEnabled(current);
      // Shown only once its real state is known, so the switch never appears
      // in a position it is about to leave.
      setControl(() => desktop);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!control) return null;

  async function toggle() {
    if (!control) return;
    const next = !enabled;
    setEnabled(next);
    setBusy(true);
    setError(null);
    const saved = await control.write(next);
    setBusy(false);
    if (saved) return;
    // Nothing was written down, so the next launch would sound exactly as it
    // does now. Put the switch back rather than let it claim otherwise.
    setEnabled(!next);
    setError("Breadboard could not save this preference on this computer.");
  }

  return (
    <Card title="Startup sound" hint="The chime Breadboard opens with.">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">Play on launch</p>
          <p className="mt-0.5 text-xs leading-5 text-gray-500">
            {enabled
              ? "A short chime plays as the welcome appears."
              : "Breadboard opens in silence."}
          </p>
        </div>
        <Switch
          checked={enabled}
          label="Play a sound when Breadboard starts"
          busy={busy}
          onChange={() => void toggle()}
        />
      </div>

      {error && (
        <p className="mt-4 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

// --------------------------------------------------------------- location

type LocationRequestState = "idle" | "checking" | "blocked" | "unavailable";
type LocationPermissionState = "granted" | "denied" | "prompt" | null;

const LOCATION_OFF: CurrentLocationPreference = {
  useForAnswers: false,
  snapshot: null,
  state: "off",
};

function locationAge(capturedAt: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(capturedAt));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function LocationPanel() {
  const [preference, setPreference] = useState<CurrentLocationPreference>(LOCATION_OFF);
  const [requestState, setRequestState] = useState<LocationRequestState>("idle");
  const [permissionState, setPermissionState] = useState<LocationPermissionState>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    const refresh = () => {
      const next = getStoredCurrentLocationPreference(window.localStorage);
      setPreference(next);
      if (!next.useForAnswers) setRequestState("idle");
    };
    refresh();
    const unsubscribe = subscribeCurrentLocation(refresh);
    // Freshness changes with time even when storage itself does not.
    const freshnessTimer = window.setInterval(refresh, 60_000);
    return () => {
      requestSequence.current += 1;
      window.clearInterval(freshnessTimer);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    // The desktop shell answers this question with its own permission handler,
    // which opens geolocation per request on the user's click. Before that
    // click it reports "denied" for a permission nobody has refused, and the
    // card would read Blocked on a machine where location works perfectly.
    if (inDesktopShell()) return;
    if (!("permissions" in navigator) || !navigator.permissions?.query) return;
    let active = true;
    let permission: PermissionStatus | null = null;
    const reflect = () => {
      if (active && permission) {
        setPermissionState(permission.state as LocationPermissionState);
      }
    };
    void navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (!active) return;
        permission = status;
        reflect();
        permission.addEventListener("change", reflect);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      permission?.removeEventListener("change", reflect);
    };
  }, []);

  function storePreference(
    useForAnswers: boolean,
    snapshot: CurrentLocationSnapshot | null,
  ): boolean {
    try {
      const next = writeStoredCurrentLocationPreference(
        window.localStorage,
        { useForAnswers, snapshot },
      );
      setPreference(next);
      announceCurrentLocationChange();
      return true;
    } catch {
      setRequestState("unavailable");
      setError("Breadboard could not save the location preference in this browser.");
      return false;
    }
  }

  async function requestLocation(): Promise<void> {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setRequestState("checking");
    setError(null);

    // Whichever source on this machine can answer: the browser's own
    // geolocation, or the operating system by way of the local server.
    const attempt = await requestCurrentLocationFix();
    if (requestSequence.current !== requestId) return;

    if (!attempt.ok) {
      if (attempt.kind === "blocked") setPermissionState("denied");
      setRequestState(attempt.kind);
      setError(attempt.message);
      return;
    }

    const snapshot = normalizeCurrentLocationSnapshot({
      latitude: attempt.fix.latitude,
      longitude: attempt.fix.longitude,
      capturedAt: new Date().toISOString(),
      accuracyMeters: attempt.fix.accuracyMeters,
      timeZone: deviceTimeZone(),
    });
    if (!snapshot || !storePreference(true, snapshot)) {
      setRequestState("unavailable");
      setError("Breadboard received a location fix it could not safely use.");
      return;
    }
    // The same coarse fix can improve sunrise/sunset calculations. This does
    // not enable automatic theme mode, and theme consent never enables use of
    // location in answers.
    rememberAppThemeLocation({
      latitude: attempt.fix.latitude,
      longitude: attempt.fix.longitude,
    });
    setPermissionState("granted");
    setRequestState("idle");
    setError(null);
  }

  function enableLocation() {
    if (!storePreference(true, preference.snapshot)) return;
    void requestLocation();
  }

  function turnOffLocation() {
    requestSequence.current += 1;
    try {
      const next = clearStoredCurrentLocationPreference(window.localStorage);
      setPreference(next);
      announceCurrentLocationChange();
      setRequestState("idle");
      setError(null);
    } catch {
      setError("Breadboard could not turn off location use in this browser.");
    }
  }

  const checking = requestState === "checking";
  const displayState = checking
    ? "checking"
    : !preference.useForAnswers
      ? "off"
      : requestState === "blocked" || permissionState === "denied"
        ? "blocked"
        : requestState === "unavailable"
          ? "unavailable"
          : preference.state;
  const status =
    displayState === "checking"
      ? {
          title: "Checking…",
          detail: "Asking this device for an approximate location.",
        }
      : displayState === "available"
        ? {
            title: "Available",
            detail: preference.snapshot
              ? `Approximate location updated ${locationAge(preference.snapshot.capturedAt)}.`
              : "An approximate location is ready.",
          }
        : displayState === "stale"
          ? {
              title: "Stale",
              detail: "The last location is over 24 hours old. Refresh it before it is used.",
            }
          : displayState === "blocked"
            ? {
                title: "Blocked",
                detail: "Location access is blocked in your browser or system settings.",
              }
            : displayState === "unavailable"
              ? {
                  title: "Location unavailable",
                  detail: "No current approximate location is available to answers.",
                }
              : {
                  title: "Off",
                  detail: "Breadboard is not using this device's location in answers.",
                };

  return (
    <Card
      title="Location"
      hint="Let answers account for where this device is when place genuinely matters. It refreshes automatically while enabled."
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div
          className="min-w-0 flex-1"
          role="status"
          aria-live="polite"
          aria-busy={checking}
        >
          <p className="flex items-center gap-2 text-sm font-medium text-white">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                displayState === "available"
                  ? "bg-[var(--botanical)]"
                  : displayState === "checking" || displayState === "stale"
                    ? "bg-amber-400"
                    : displayState === "blocked"
                      ? "bg-red-400"
                      : "bg-gray-600"
              }`}
              aria-hidden
            />
            {status.title}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-gray-500">{status.detail}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!preference.useForAnswers ? (
            <button
              type="button"
              onClick={enableLocation}
              className="neu-button-primary rounded-lg bg-white px-3 py-2 text-xs font-medium text-gray-950 transition-colors hover:bg-gray-100"
            >
              Enable
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void requestLocation()}
                disabled={checking}
                className="neu-button rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-300 transition-colors hover:text-white disabled:opacity-50"
              >
                {checking ? "Checking…" : "Refresh"}
              </button>
              <button
                type="button"
                onClick={turnOffLocation}
                className="neu-button rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-400 transition-colors hover:text-white"
              >
                Turn off
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-4 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

/**
 * The navbar's optional entries.
 *
 * The switch flips immediately and is put back if the request fails, because
 * the alternative — a control that does nothing until the server answers —
 * reads as broken for something this small.
 */
/**
 * Where spaced-repetition questions are delivered.
 *
 * The channel is one per-user choice, made here rather than per garden, because
 * a person has one phone. Which gardens actually ask questions is set from each
 * garden chat's settings icon — the two halves are deliberately separate.
 *
 * A channel that is not linked is shown but disabled: silently accepting a
 * choice that can never deliver is how this feature would most easily appear
 * broken.
 */
function ReviewDeliveryPanel() {
  const [settings, setSettings] = useState<ReviewUserSettings | null>(null);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [available, setAvailable] = useState<{ whatsapp: boolean; telegram: boolean }>({
    whatsapp: false,
    telegram: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((payload: {
    settings: ReviewUserSettings;
    stats: ReviewStats;
    available: { whatsapp: boolean; telegram: boolean };
  }) => {
    setSettings(payload.settings);
    setStats(payload.stats);
    setAvailable(payload.available);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/review/settings");
        if (!response.ok) return;
        const payload = await response.json();
        if (!cancelled) apply(payload);
      } catch {
        // A profile page that cannot reach the endpoint still renders; the
        // panel simply stays in its loading state rather than erroring loudly.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/review/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("Could not save that.");
      apply(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  const channels: Array<{ value: ReviewChannel; label: string; enabled: boolean; note: string }> = [
    { value: "off", label: "Off", enabled: true, note: "No questions are sent." },
    {
      value: "whatsapp",
      label: "WhatsApp",
      enabled: available.whatsapp,
      note: available.whatsapp ? "Sent to your most recent chat." : "Link WhatsApp first.",
    },
    {
      value: "telegram",
      label: "Telegram",
      enabled: available.telegram,
      note: available.telegram ? "Sent to your most recent chat." : "Link Telegram first.",
    },
  ];

  return (
    <Card
      title="Review delivery"
      hint="Questions from your gardens, scheduled with FSRS and sent to your phone."
    >
      {error ? <p className="mb-2 text-xs text-[#a45f56]">{error}</p> : null}
      {settings === null ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {channels.map((channel) => {
              const active = settings.channel === channel.value;
              return (
                <button
                  key={channel.value}
                  type="button"
                  disabled={busy || !channel.enabled}
                  onClick={() => void patch({ channel: channel.value })}
                  className={`neu-button rounded-xl border px-3 py-2 text-left transition disabled:opacity-40 ${
                    active
                      ? "border-[var(--botanical)] bg-[var(--paper-raised)]"
                      : "border-gray-800"
                  }`}
                >
                  <span className="block text-xs font-medium text-gray-200">{channel.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-gray-500">
                    {channel.note}
                  </span>
                </button>
              );
            })}
          </div>

          <div>
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Questions per day</span>
              <span className="text-gray-200">{settings.dailyLimit}</span>
            </div>
            <input
              type="range"
              min={1}
              max={50}
              value={settings.dailyLimit}
              disabled={busy}
              onChange={(event) => void patch({ dailyLimit: Number(event.target.value) })}
              className="mt-1 w-full"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Start sending from</span>
              <span className="text-gray-200">
                {String(settings.sendHour).padStart(2, "0")}:00
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={23}
              value={settings.sendHour}
              disabled={busy}
              onChange={(event) => void patch({ sendHour: Number(event.target.value) })}
              className="mt-1 w-full"
            />
            <p className="mt-1 text-[11px] text-gray-600">
              One question at a time. The next arrives once you answer the last, until
              the day&rsquo;s limit is reached.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Target recall</span>
              <span className="text-gray-200">
                {Math.round(settings.desiredRetention * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={70}
              max={97}
              value={Math.round(settings.desiredRetention * 100)}
              disabled={busy}
              onChange={(event) =>
                void patch({ desiredRetention: Number(event.target.value) / 100 })
              }
              className="mt-1 w-full"
            />
            <p className="mt-1 text-[11px] text-gray-600">
              Higher means shorter intervals and more reviews for the same material.
            </p>
          </div>

          {stats && stats.total > 0 ? (
            <p className="text-[11px] text-gray-600">
              {formatCount(stats.total)} card{stats.total === 1 ? "" : "s"} across your
              gardens, {formatCount(stats.due)} due now
              {stats.retention30d !== null
                ? ` · ${Math.round(stats.retention30d * 100)}% recalled over 30 days`
                : ""}
              .
            </p>
          ) : (
            <p className="text-[11px] text-gray-600">
              No cards yet. Open a garden&rsquo;s chat and use its settings icon to build
              them.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/** The cap the store enforces on the free-text note, shown as a counter. */
const ABOUT_MAX_LENGTH = 1_500;

/**
 * Who you are, in one card.
 *
 * The account has only ever had a username, and a username is a handle: the
 * blank chat was greeting people as "kuzeyata" because that is all it had.
 * Everything set here travels into every turn's `# user_identity` block, so the
 * assistant addresses a person rather than a login.
 *
 * The name and the nickname used to live in two cards side by side, which left
 * the obvious question — which one am I actually called? — answered in neither.
 * They are one form now, and the sentence at the top of the card answers it out
 * loud: the nickname wins, then the first name, then the username. Nothing here
 * is inferred, so nothing here needs confirming: it is what they typed about
 * themselves.
 */
function IdentityPanel({
  initial,
}: {
  initial: {
    firstName: string;
    lastName: string;
    nickname: string;
    occupation: string;
    about: string;
    username: string;
  };
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [nickname, setNickname] = useState(initial.nickname);
  const [occupation, setOccupation] = useState(initial.occupation);
  const [about, setAbout] = useState(initial.about);
  const [saved, setSaved] = useState({
    firstName: initial.firstName,
    lastName: initial.lastName,
    nickname: initial.nickname,
    occupation: initial.occupation,
    about: initial.about,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const dirty =
    firstName !== saved.firstName ||
    lastName !== saved.lastName ||
    nickname !== saved.nickname ||
    occupation !== saved.occupation ||
    about !== saved.about;

  // What the greeting will actually say once this is saved, worked out here
  // rather than described in prose: the precedence is the part people need to
  // see, and a sentence about it is not the same as seeing it. Both fields are
  // local state now, so it follows along as they type.
  const trimmedNickname = nickname.trim();
  const trimmedFirstName = firstName.trim();
  const greetingName = trimmedNickname || trimmedFirstName || initial.username;
  const greetingSource = trimmedNickname
    ? " — your nickname, which wins over a first name"
    : trimmedFirstName
      ? " — your first name; a nickname would win over it"
      : " — your username, until you give it something better";

  async function save() {
    setBusy(true);
    setError(null);
    setConfirmed(false);
    try {
      const response = await fetch("/api/profile/identity", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, nickname, occupation, about }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        identity?: {
          firstName: string;
          lastName: string;
          nickname: string;
          occupation: string;
          about: string;
        };
        error?: string;
      };
      if (!response.ok || !data.identity) throw new Error(data.error || "Could not save this");
      // The stored values are the normalized ones, so the fields show what the
      // assistant will actually be told rather than what was typed.
      setFirstName(data.identity.firstName);
      setLastName(data.identity.lastName);
      setNickname(data.identity.nickname);
      setOccupation(data.identity.occupation);
      setAbout(data.identity.about);
      setSaved({
        firstName: data.identity.firstName,
        lastName: data.identity.lastName,
        nickname: data.identity.nickname,
        occupation: data.identity.occupation,
        about: data.identity.about,
      });
      setConfirmed(true);
      // The heading at the top of this page is server-rendered from the same
      // row, so it only catches up on a refetch.
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this");
    } finally {
      setBusy(false);
    }
  }

  function touch(apply: () => void) {
    apply();
    setConfirmed(false);
  }

  return (
    <Card
      title="About you"
      hint={`Breadboard will call you ${greetingName}${greetingSource}. All of this is given to the assistant at the start of every chat, this one included. Leave a field empty and it is not mentioned at all.`}
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty && !busy) void save();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Nickname</span>
            <input
              type="text"
              value={nickname}
              maxLength={60}
              autoComplete="nickname"
              placeholder="What should breadboard call you?"
              onChange={(event) => touch(() => setNickname(event.target.value))}
              className="w-full rounded-lg border border-gray-800 bg-gray-900/70 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-gray-600 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Occupation</span>
            <input
              type="text"
              value={occupation}
              maxLength={120}
              autoComplete="organization-title"
              placeholder="Small-batch home sourdough baker"
              onChange={(event) => touch(() => setOccupation(event.target.value))}
              className="w-full rounded-lg border border-gray-800 bg-gray-900/70 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-gray-600 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">First name</span>
            <input
              type="text"
              value={firstName}
              maxLength={60}
              autoComplete="given-name"
              placeholder="Kuzey"
              onChange={(event) => touch(() => setFirstName(event.target.value))}
              className="w-full rounded-lg border border-gray-800 bg-gray-900/70 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-gray-600 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Surname</span>
            <input
              type="text"
              value={lastName}
              maxLength={60}
              autoComplete="family-name"
              placeholder="Optional"
              onChange={(event) => touch(() => setLastName(event.target.value))}
              className="w-full rounded-lg border border-gray-800 bg-gray-900/70 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-gray-600 focus:outline-none"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">More about you</span>
          <textarea
            value={about}
            rows={4}
            maxLength={ABOUT_MAX_LENGTH}
            placeholder="Interests, values, or preferences to keep in mind"
            onChange={(event) => touch(() => setAbout(event.target.value))}
            className="w-full resize-y rounded-lg border border-gray-800 bg-gray-900/70 px-3 py-2 text-sm leading-relaxed text-white placeholder:text-gray-600 focus:border-gray-600 focus:outline-none"
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-xs text-gray-600">
            The nickname is what you are called, ahead of your first name; leave both empty to go
            back to your username. The full name, occupation and note are context the assistant
            reads, not a greeting.{" "}
            {about.length > 0 && `${about.length} of ${ABOUT_MAX_LENGTH} characters. `}
            None of this is memory the assistant learned — it is what you told it.
          </p>
          <button
            type="submit"
            disabled={!dirty || busy}
            className="neu-button shrink-0 rounded-lg border border-gray-800 px-3.5 py-2 text-sm text-gray-300 transition-colors hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {!error && confirmed && !dirty && <p className="text-xs text-gray-500">Saved.</p>}
      </form>
    </Card>
  );
}

function GoogleImageGenerationPanel({ initial }: { initial: GoogleImageGenerationStatus }) {
  const [status, setStatus] = useState(initial);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setConfirmed(false);
    try {
      const response = await fetch("/api/profile/google-images", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        status?: GoogleImageGenerationStatus;
        error?: string;
      };
      if (!response.ok || !data.status) {
        throw new Error(data.error || "Could not save the Google image-generation API key");
      }
      setStatus(data.status);
      setApiKey("");
      setConfirmed(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the Google image-generation API key",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    setConfirmed(false);
    try {
      const response = await fetch("/api/profile/google-images", { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as {
        status?: GoogleImageGenerationStatus;
        error?: string;
      };
      if (!response.ok || !data.status) {
        throw new Error(data.error || "Could not remove the Google image-generation API key");
      }
      setStatus(data.status);
      setApiKey("");
      setConfirmed(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not remove the Google image-generation API key",
      );
    } finally {
      setBusy(false);
    }
  }

  const readyToSave = status.available && Boolean(apiKey.trim());

  return (
    <Card
      title="Google Image Generation"
      hint="Use Google Gemini to generate an image when ChatGPT image generation is unavailable."
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (readyToSave && !busy) void save();
        }}
      >
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-gray-500">
            {status.configured
              ? "Google image generation is configured for your account."
              : status.available
                ? "No Google Gemini API key is saved."
                : "Credential storage is unavailable until NEXTAUTH_SECRET is configured."}
          </span>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 ${
              status.configured
                ? "border-emerald-800/70 bg-emerald-950/40 text-emerald-300"
                : "border-gray-800 text-gray-600"
            }`}
          >
            {status.configured ? "Connected" : "Not connected"}
          </span>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Gemini API key</span>
          <input
            type="password"
            value={apiKey}
            maxLength={512}
            autoComplete="off"
            placeholder={status.configured ? "Paste a key to replace the saved one" : "AIza…"}
            onChange={(event) => {
              setApiKey(event.target.value);
              setConfirmed(false);
            }}
            className="w-full rounded-lg border border-gray-800 bg-gray-900/70 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-gray-600 focus:outline-none"
          />
        </label>

        <p className="text-xs leading-relaxed text-gray-600">
          Create or copy an API key in{" "}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            className="text-gray-400 underline decoration-gray-700 underline-offset-2 hover:text-white"
          >
            Google AI Studio
          </a>
          . The key is encrypted at rest and is never shown again after saving. It is used only
          server-side when ChatGPT image generation fails.
        </p>

        <div className="flex items-center justify-end gap-2">
          {status.configured ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="neu-button rounded-lg border border-gray-800 px-3.5 py-2 text-sm text-gray-500 transition-colors hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Remove
            </button>
          ) : null}
          <button
            type="submit"
            disabled={!readyToSave || busy}
            className="neu-button rounded-lg border border-gray-800 px-3.5 py-2 text-sm text-gray-300 transition-colors hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving…" : status.configured ? "Replace credentials" : "Save credentials"}
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {!error && confirmed && (
          <p className="text-xs text-gray-500">
            {status.configured
              ? "Google image-generation API key saved."
              : "Stored API key removed."}
          </p>
        )}
      </form>
    </Card>
  );
}

function ShortcutPanel({ initial }: { initial: NavbarShortcuts }) {
  const router = useRouter();
  const [shortcuts, setShortcuts] = useState(initial);
  const [busy, setBusy] = useState<keyof NavbarShortcuts | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: keyof NavbarShortcuts) {
    const previous = shortcuts;
    const optimistic = { ...shortcuts, [key]: !shortcuts[key] };
    setShortcuts(optimistic);
    setBusy(key);
    setError(null);

    try {
      const response = await fetch("/api/profile/navbar-shortcuts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: optimistic[key] }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        shortcuts?: NavbarShortcuts;
        error?: string;
      };
      if (!response.ok || !data.shortcuts) {
        throw new Error(data.error || "Could not save the change");
      }
      setShortcuts(data.shortcuts);
      // The navbar is rendered on the server from this setting, so the
      // dashboard has to be re-fetched rather than served from the router cache.
      router.refresh();
    } catch (cause) {
      setShortcuts(previous);
      setError(cause instanceof Error ? cause.message : "Could not save the change");
    } finally {
      setBusy(null);
    }
  }

  const on = NAVBAR_SHORTCUTS.filter((shortcut) => shortcuts[shortcut.key]).length;

  return (
    <Card
      title="Navbar shortcuts"
      hint={
        on === 0
          ? "The navbar shows none of these. Switch one on to give it a seat."
          : `${on} of ${NAVBAR_SHORTCUTS.length} showing in the navbar.`
      }
    >
      <ul className="space-y-3">
        {NAVBAR_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.key} className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {/* The switch itself already says whether the seat is taken, so
                  the row carries no second badge repeating it. A seat that is a
                  control rather than a link has nowhere to send you, so its
                  name is plain text. */}
              <div className="flex items-center gap-2">
                {shortcut.href ? (
                  <a
                    href={shortcut.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-white transition-colors hover:text-[var(--botanical)]"
                  >
                    {shortcut.label}
                  </a>
                ) : (
                  <span className="text-sm font-medium text-white">{shortcut.label}</span>
                )}
              </div>
              <p className="mt-0.5 text-xs leading-5 text-gray-500">{shortcut.description}</p>
            </div>
            <Switch
              checked={shortcuts[shortcut.key]}
              label={`Show ${shortcut.label} in the navbar`}
              busy={busy !== null}
              onChange={() => void toggle(shortcut.key)}
            />
          </li>
        ))}
      </ul>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </Card>
  );
}

// ------------------------------------------------------------------- invites

function InvitePanel({ initial }: { initial: { created: number; redeemed: number; open: number } }) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/invites");
      const data = (await response.json().catch(() => ({}))) as {
        invites?: Invite[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Could not load invites");
      setInvites(data.invites ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load invites");
      setInvites([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createInvite() {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/invites", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!response.ok || typeof data.code !== "string") {
        throw new Error(data.error || "Could not create invite");
      }
      await load();
      setCopied(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create invite");
    } finally {
      setCreating(false);
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied((current) => (current === code ? null : current)), 1800);
    } catch {
      setError("Could not copy invite");
    }
  }

  const total = invites?.length ?? initial.created;
  const open = invites ? invites.filter((invite) => !invite.used_at).length : initial.open;

  return (
    <Card
      title="Invites"
      hint={
        total === 0
          ? "A one-time code is the only way onto this breadboard."
          : `${formatCount(total)} created · ${formatCount(open)} still open`
      }
    >
      <button
        type="button"
        onClick={createInvite}
        disabled={creating}
        className="neu-button-primary w-full rounded-lg bg-white py-2.5 text-sm font-medium text-gray-950 transition-colors hover:bg-gray-100 disabled:opacity-50"
      >
        {creating ? "Creating…" : "Create an invite code"}
      </button>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

      {invites === null ? (
        <p className="mt-4 text-xs text-gray-600">Loading…</p>
      ) : invites.length === 0 ? (
        <p className="mt-4 text-xs text-gray-600">
          You have not handed out any codes yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-1.5">
          {invites.map((invite) => (
            <li
              key={invite.id}
              className="neu-surface flex items-center gap-3 rounded-lg border border-gray-800 px-3 py-2"
            >
              <code className="flex-1 truncate font-mono text-xs text-white">{invite.code}</code>
              {invite.used_at ? (
                <span className="shrink-0 text-[11px] text-gray-600">
                  Redeemed {formatShortDate(dateOnly(invite.used_at))}
                </span>
              ) : (
                <>
                  <span className="shrink-0 text-[11px] text-[var(--botanical)]">Open</span>
                  <button
                    type="button"
                    onClick={() => copy(invite.code)}
                    className="neu-button shrink-0 rounded-md border border-gray-700 px-2 py-1 text-[11px] text-gray-400 transition-colors hover:text-white"
                  >
                    {copied === invite.code ? "Copied" : "Copy"}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------- models

/**
 * Which models actually answered you, and what they cost.
 *
 * The money is bounded rather than exact and the card says so plainly: only
 * models with a published rate are priced, cached-token discounts are not
 * modelled, and replies from before the model was recorded are named as such.
 * The alternative — one confident-looking figure quietly built on zeroes for
 * everything unpriced — would be a worse number wearing better clothes.
 */
function ModelPanel({ cost }: { cost: ProfileCost }) {
  const max = cost.models.reduce((best, entry) => Math.max(best, entry.replies), 0);
  const compression = cost.compression;
  const saved = compression.savedTokens > 0;
  const caveats: string[] = [];
  if (cost.unpricedReplies > 0) {
    caveats.push(
      `${formatCount(cost.unpricedReplies)} on models with no published rate here`,
    );
  }
  if (cost.unattributedReplies > 0) {
    caveats.push(
      `${formatCount(cost.unattributedReplies)} from before Breadboard recorded which model answered`,
    );
  }

  return (
    <Card
      title="Which brains answered you"
      hint={
        cost.models.length === 0
          ? "No reply has recorded its model yet."
          : `${cost.models.length} model${cost.models.length === 1 ? "" : "s"} across ${formatCount(
              cost.models.reduce((sum, entry) => sum + entry.replies, 0),
            )} replies.`
      }
    >
      <div className={`grid gap-3 ${saved ? "grid-cols-3" : "grid-cols-2"}`}>
        <Stat
          value={cost.pricedReplies === 0 ? "—" : formatUsd(cost.totalUsd)}
          label="Spent on answers"
          hint={
            cost.pricedReplies === 0
              ? "Nothing priced yet"
              : `Across ${formatCount(cost.pricedReplies)} priced replies`
          }
        />
        <Stat
          value={formatCompact(
            cost.models.reduce((sum, entry) => sum + entry.outputTokens, 0),
          )}
          label="Tokens written back"
          hint="The expensive half of the bill"
        />
        {saved && (
          <Stat
            value={
              compression.savedUsd > 0
                ? formatUsd(compression.savedUsd)
                : formatCompact(compression.savedTokens)
            }
            label="Saved by compression"
            hint={`${formatCompact(compression.savedTokens)} tokens of tool output never sent`}
          />
        )}
      </div>

      {cost.models.length > 0 && (
        <div className="mt-5 space-y-2">
          {cost.models.slice(0, 6).map((entry) => (
            <Bar
              key={entry.model}
              label={entry.label}
              value={formatCount(entry.replies)}
              share={max === 0 ? 0 : entry.replies / max}
              meta={
                entry.costUsd === null
                  ? "unpriced"
                  : entry.costUsd > 0
                    ? formatUsd(entry.costUsd)
                    : undefined
              }
            />
          ))}
        </div>
      )}

      <p className="neu-inset mt-4 rounded-xl px-3 py-2.5 text-[11px] leading-5 text-gray-500">
        An upper bound on list prices: cached-token discounts are not subtracted,
        and a subscription or a model running on this machine costs nothing at all
        no matter what the rate card says.
        {caveats.length > 0 && ` Not counted — ${caveats.join("; ")}.`}
        {saved &&
          ` Compression is the mirror of that bound: ${formatCount(
            compression.compressions,
          )} oversized tool result${compression.compressions === 1 ? "" : "s"} were thinned to ${Math.round(
            (1 - compression.ratio) * 100,
          )}% of their size before any model read them, and nothing was lost — the runtime keeps the full text.`}
      </p>
    </Card>
  );
}

// -------------------------------------------------------------- reliability

function ReliabilityPanel({ reliability }: { reliability: ProfileReliability }) {
  const broken = reliability.failed + reliability.aborted;
  const rate =
    reliability.terminalReplies === 0
      ? 0
      : (broken / reliability.terminalReplies) * 100;

  return (
    <Card
      title="When it broke"
      hint={
        reliability.terminalReplies === 0
          ? "Nothing has been asked of it yet."
          : broken === 0
            ? `${formatCount(reliability.completed)} replies, none of which failed.`
            : `${rate < 0.1 ? "<0.1" : rate.toFixed(1)}% of finished turns never produced an answer.`
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Stat value={formatCompact(reliability.completed)} label="Answered" />
        <Stat value={formatCompact(reliability.failed)} label="Failed" />
        <Stat value={formatCompact(reliability.aborted)} label="Stopped" />
      </div>

      {reliability.topErrors.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-gray-600">
            What went wrong
          </h3>
          <ul className="space-y-1.5">
            {reliability.topErrors.map((entry) => (
              <li
                key={entry.error}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <code className="min-w-0 truncate font-mono text-gray-400">
                  {entry.error}
                </code>
                <span className="shrink-0 tabular-nums text-gray-600">
                  {formatCount(entry.count)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-4 text-xs leading-5 text-gray-600">
        {reliability.worstAgent
          ? `${reliability.worstAgent.label} is the least reliable agent — ${formatCount(reliability.worstAgent.failed)} of ${formatCount(reliability.worstAgent.runs)} runs did not finish.`
          : "No agent run has failed."}
        {reliability.lastFailureAt && (
          <> Last failure {relativeTime(reliability.lastFailureAt)}.</>
        )}
      </p>
    </Card>
  );
}

// ------------------------------------------------------------------ latency

function LatencyPanel({ latency }: { latency: ProfileLatency }) {
  if (latency.measured === 0) {
    return (
      <Card title="How long you waited" hint="No reply has reported its duration yet.">
        <p className="text-xs text-gray-600">
          Timings appear here once replies start recording how long they took.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="How long you waited"
      hint={`Across ${formatCount(latency.measured)} timed replies. Half came back inside ${formatShortDuration(latency.medianMs)}.`}
    >
      <div className="grid grid-cols-2 gap-3">
        <Stat value={formatShortDuration(latency.medianMs)} label="Typical reply" />
        <Stat
          value={formatShortDuration(latency.p90Ms)}
          label="Slow reply"
          hint="Nine in ten are faster than this"
        />
      </div>
      <p className="mt-3 text-xs leading-5 text-gray-600">
        The quickest took {formatShortDuration(latency.fastestMs)} and the slowest
        ran for {formatShortDuration(latency.slowestMs)} — long waits are usually an
        agent working, not the chat hanging.
      </p>
    </Card>
  );
}

// ------------------------------------------------------------------- memory

function MemoryPanel({ memory }: { memory: ProfileMemory }) {
  const total = memory.kinds.reduce((sum, entry) => sum + entry.count, 0);
  const max = memory.kinds.reduce((best, entry) => Math.max(best, entry.count), 0);

  return (
    <Card
      title="What it remembers"
      hint={
        total === 0
          ? "Nothing has been committed to durable memory yet."
          : `${formatCount(memory.confirmed)} confirmed, ${formatCount(memory.candidate)} still provisional.`
      }
    >
      {total === 0 ? (
        <p className="text-xs text-gray-600">
          Durable memories are written as the assistant notices something worth
          keeping. Settings → Memory is where you read and retire them.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {memory.kinds.map((entry) => (
              <Bar
                key={entry.kind}
                label={entry.label}
                value={formatCount(entry.count)}
                share={max === 0 ? 0 : entry.count / max}
              />
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-gray-600">
            {memory.superseded > 0
              ? `${formatCount(memory.superseded)} entr${memory.superseded === 1 ? "y has" : "ies have"} been retired. Settings → Memory is where you read and retire them.`
              : "Settings → Memory is where you read and retire them."}
          </p>
        </>
      )}
    </Card>
  );
}

// -------------------------------------------------------------- audit feed

const AUDIT_LABELS: Record<AuditEntry["kind"], string> = {
  agent_run: "Agent",
  artifact: "Artifact",
  memory: "Memory",
  scheduled_chat: "Schedule",
};

function statusColor(status: AuditEntry["status"]): string {
  if (status === "failed") return "bg-red-400";
  if (status === "pending") return "bg-amber-400";
  return "bg-[var(--botanical)]";
}

/**
 * One chronological strip of everything Breadboard did without being watched.
 *
 * Agent runs, artifacts, memories and scheduled chats each already have a home
 * elsewhere; what none of those places can answer is what happened *lately*,
 * because that question crosses all four tables at once.
 */
function AuditFeed({ entries }: { entries: AuditEntry[] }) {
  return (
    <Card
      title="What it did on your behalf"
      hint="Agent runs, artifacts, memories and scheduled chats, newest first."
      className="mt-4"
    >
      {entries.length === 0 ? (
        <p className="text-xs text-gray-600">
          Nothing has happened in the background yet.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {entries.map((entry, index) => (
            <li
              key={`${entry.kind}-${entry.at}-${index}`}
              className="flex items-start gap-3 text-xs"
            >
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${statusColor(entry.status)}`}
                aria-hidden
              />
              <span className="w-16 shrink-0 pt-px text-[11px] uppercase tracking-wide text-gray-600">
                {AUDIT_LABELS[entry.kind]}
              </span>
              <span className="min-w-0 flex-1">
                {entry.href ? (
                  <Link
                    href={entry.href}
                    className="text-gray-300 transition-colors hover:text-white"
                  >
                    {entry.title}
                  </Link>
                ) : (
                  <span className="text-gray-300">{entry.title}</span>
                )}
                {entry.detail && (
                  <span className="ml-2 text-gray-600">{entry.detail}</span>
                )}
              </span>
              <span className="shrink-0 tabular-nums text-gray-600">
                {relativeTime(entry.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------- about

/** One movement of the story: a small title in the margin, prose beside it. */
function AboutPassage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,8.5rem)_1fr] sm:gap-8">
      <h3 className="text-[11px] font-semibold uppercase leading-5 tracking-[0.18em] text-[var(--botanical)] sm:pt-1 sm:text-right">
        {title}
      </h3>
      <div className="max-w-3xl space-y-3 text-sm leading-7 text-gray-400">{children}</div>
    </div>
  );
}

/**
 * The story at the bottom of the page: what this thing is, why it exists, and
 * what it can do — written for someone who has never soldered anything.
 */
function AboutBreadboard() {
  return (
    <section className="neu-surface-raised mt-4 rounded-2xl border border-gray-800 p-6 sm:p-8">
      <header className="mb-8">
        <h2 className="text-lg font-semibold text-white">About this breadboard</h2>
      </header>

      <div className="space-y-8">
        <AboutPassage title="The name">
          <p>
            In electronics, a breadboard is a slab of plastic covered in small holes. You press
            wires and components into it and a circuit comes alive, no solder, nothing glued
            down. Anything can be pulled out, moved a row over, tried again. This software
            borrows the name because it works the same way. A conversation that remembers you, a
            library grown from your documents, a workshop of automated helpers, all pressed into
            the same holes until they run as one circuit.
          </p>
        </AboutPassage>

        <AboutPassage title="Why it exists">
          <p>
            Most software that thinks alongside you lives on somebody else’s computer. Your notes
            sit in their cloud, your questions travel through their wires, and when they switch
            something off it is gone. Breadboard started from the opposite idea, that the machine
            on your desk is enough. It was built to take raw material, a textbook, a folder of
            papers, a recorded lecture, and turn it into knowledge you can walk through like a
            garden, with every step happening at home, in files you can see, on a disk you own.
          </p>
        </AboutPassage>

        <AboutPassage title="How it was built">
          <p>
            Not from scratch, and the name is honest about that. The world is full of open source
            software, programs whose complete recipe is published for anyone to read and reuse.
            Breadboard is dozens of them, picked one at a time, studied, and wired into a single
            board. A system that publishes to social networks. Another that researches. Another
            that edits video. Another that watches the world’s news feeds. When a project could
            not survive the trip, its ideas were rebuilt here instead. Most of the wiring was
            done in long conversation with an AI, the same kind of mind the finished board now
            hosts, one feature at a time, tested, corrected, tried again. The house was raised
            partly by its own tenant.
          </p>
        </AboutPassage>

        <AboutPassage title="The gardens">
          <p>
            At the center are gardens. Hand one a document, a PDF, a slide deck, a spreadsheet,
            even a photograph of a page, and it gets read, its text drawn out and rewritten as a
            web of small linked notes. Every idea becomes its own page, every relationship a path
            between pages. What you end up with is a private little website of what you know,
            browsable like a wiki and published only if you say so. You can also talk to a
            garden. Ask it a question and it answers from your material, your sources and your
            notes, not from the general fog of the internet.
          </p>
        </AboutPassage>

        <AboutPassage title="The conversation">
          <p>
            The chat is the front door, and it is more than a text box. It keeps a durable memory
            of what matters to you, one you can open, read, and retire entry by entry. It can
            slip into personas and pass work down a roster of them, like a chief of staff with a
            staff. It can sit as a council, where several advisors take up your question on their
            own, review each other without knowing whose work is whose, and hand you a verdict.
            It can listen through a microphone and answer out loud in a voice trained on this
            machine. And it does not insist you come to it. Link a WhatsApp or Telegram account
            and the same conversation carries on from your phone.
          </p>
        </AboutPassage>

        <AboutPassage title="The workshop">
          <p>
            Behind the chat waits a workshop of specialist agents, each summoned by name. One
            researches a question across the open web and returns a cited report. One drives a
            real web browser with its own eyes, clicking and typing while you approve each move.
            One finds academic papers in open catalogs and brings the PDFs home. One tutors you
            through a document, patiently. One cuts a long video into short vertical clips, and
            another writes, narrates, and edits whole films, ending in an actual finished video
            file. One drafts social media posts, paints artwork for them, and schedules them onto
            a real calendar. One convenes a simulated trading firm, with analysts, researchers,
            and a risk desk arguing over a stock. One hunts job listings. One takes a plain
            electronics request and returns a checked circuit design, pin by pin. Every run
            leaves artifacts behind, real files that outlive the conversation that made them.
          </p>
        </AboutPassage>

        <AboutPassage title="The rooms">
          <p>
            And around all of this, rooms. A world monitor that watches news wires, earthquake
            feeds, and climate instruments. A planner where tasks live on a board and flow into a
            calendar. A pomodoro timer that rewards a stretch of focus by slowly revealing a
            watercolor painting. A speed reader that flashes a garden’s prose one word at a time.
            A whiteboard for thinking with your hands. An optional recall that remembers what
            crossed your screen, with rooms it is told never to watch.
          </p>
        </AboutPassage>

        <AboutPassage title="Where it all lives">
          <p>
            Everything above lives on the machine in front of you. The databases are single
            ordinary files, the notes are plain text you could open in any editor, and the whole
            thing starts and stops as one desktop application. The AI models are the only
            borrowed part, reached through a single local doorway that can speak to many
            providers, and even then what they read and write stays here. There is no sign-up
            page. The only way in is an invite code handed from one person to another, like a key
            cut for a specific door. If the internet disappeared tomorrow, your gardens would
            still open.
          </p>
        </AboutPassage>
      </div>

      <p className="mt-8 text-xs italic text-gray-600">
        Built slowly, one wire at a time.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------- page

export default function ProfileClient({
  stats,
  initialShortcuts,
  browserProfile,
  contacts,
  contactTotal,
  syncedCalendars,
  calendarVaultConfigured,
  googleImageGenerationStatus,
  initialTab,
  initialBrainScope,
}: {
  stats: ProfileStats;
  initialShortcuts: NavbarShortcuts;
  browserProfile: BrowserProfileState;
  contacts: Contact[];
  contactTotal: number;
  syncedCalendars: CalendarCollection[];
  calendarVaultConfigured: boolean;
  googleImageGenerationStatus: GoogleImageGenerationStatus;
  initialTab: "profile" | "knowledge";
  initialBrainScope: string;
}) {
  const router = useRouter();
  const { account, totals, streaks, habit, surfaces, gardens, artifactKinds, agents } = stats;
  const [tab, setTab] = useState<"profile" | "knowledge">(initialTab);
  const [brainScope, setBrainScope] = useState(initialBrainScope);
  // The heading is the name when there is one, because that is the thing this
  // page is about. The username does not disappear — it moves down a line, to
  // sit with the email as the other piece of account plumbing.
  const fullName = [account.firstName, account.lastName].filter(Boolean).join(" ");

  const surfaceMax = surfaces.reduce((best, entry) => Math.max(best, entry.count), 0);
  const gardenMax = gardens.reduce((best, entry) => Math.max(best, entry.prompts), 0);
  const artifactMax = artifactKinds.reduce((best, entry) => Math.max(best, entry.count), 0);
  const agentMax = agents.reduce((best, entry) => Math.max(best, entry.runs), 0);

  const selectTab = useCallback((nextTab: "profile" | "knowledge") => {
    setTab(nextTab);
    const params = new URLSearchParams(window.location.search);
    if (nextTab === "knowledge") {
      params.set("tab", nextTab);
    } else {
      // `scope` and `organization` are the Knowledge tab's own state — an
      // organization-scoped map is still reachable by link, but leaving the
      // tab takes its scope with it rather than stranding it in the URL.
      params.delete("tab");
      params.delete("scope");
      params.delete("organization");
    }
    const query = params.toString();
    router.replace(query ? `/profile?${query}` : "/profile", { scroll: false });
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--paper-bg)] text-white">
      <header className="breadboard-flower-navbar relative flex shrink-0 items-center justify-between gap-4 border-b border-gray-800 px-6 py-3.5">
        <NavbarFlowerWind />
        <div className="relative z-10 flex min-w-0 items-center gap-3">
          <BackLink fallbackHref="/dashboard" fallbackLabel="Back to dashboard" fixed />
          <span className="text-gray-700">/</span>
          <h1 className="truncate text-sm font-semibold text-white">
            {tab === "knowledge" ? "Knowledge" : "Profile"}
          </h1>
        </div>
        <nav className="relative z-10 inline-flex shrink-0 items-center rounded-md border border-gray-800 bg-gray-900/80 p-1 shadow-inner">
          {(["profile", "knowledge"] as const).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => selectTab(name)}
              aria-current={tab === name ? "page" : undefined}
              className={
                tab === name
                  ? "rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-950 shadow-sm"
                  : "rounded-md px-3 py-1.5 text-xs font-medium text-gray-400 transition hover:text-white"
              }
            >
              {name === "profile" ? "Profile" : "Knowledge"}
            </button>
          ))}
        </nav>
      </header>

      {tab === "knowledge" ? (
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-5 sm:py-6">
          <BrainMapPanel initialScope={brainScope} onScopeChange={setBrainScope} />
        </main>
      ) : (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {/* ------------------------------------------------------ identity */}
        <section className="neu-surface-raised flex flex-wrap items-center gap-5 rounded-2xl border border-gray-800 p-5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold text-white">
              {fullName || account.username}
            </h2>
            <p className="truncate text-sm text-gray-400">
              {fullName ? `${account.username} · ${account.email}` : account.email}
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Here since {formatLongDate(dateOnly(account.joinedAt))} ·{" "}
              {account.daysSinceJoined === 0
                ? "today"
                : `${formatCount(account.daysSinceJoined)} days`}
              {stats.firstConversation && (
                <> · first chat was “{stats.firstConversation.title}”</>
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/auth/login" })}
              className="neu-button flex items-center gap-1.5 rounded-lg border border-gray-800 px-3.5 py-2 text-sm text-gray-400 transition-colors hover:border-gray-600 hover:text-white"
            >
              <svg
                className="h-4 w-4 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10" />
                <path d="M14.5 8.5 18 12l-3.5 3.5M9 12h9" />
              </svg>
              Sign out
            </button>
          </div>
        </section>

        {/* ----------------------------------------------------- about you */}
        <div className="mt-4">
          <IdentityPanel
            initial={{
              firstName: account.firstName,
              lastName: account.lastName,
              nickname: account.nickname,
              occupation: account.occupation,
              about: account.about,
              username: account.username,
            }}
          />
        </div>

        {/* --------------------------------------------------------- totals */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat value={formatCompact(totals.prompts)} label="Prompts written" />
          <Stat value={formatCompact(totals.conversations)} label="Conversations" />
          <Stat value={formatCompact(totals.gardens)} label="Gardens" />
          <Stat value={formatCompact(totals.artifacts)} label="Artifacts made" />
          <Stat value={formatCompact(totals.agentRuns)} label="Agent runs" />
          <Stat
            value={formatCompact(streaks.daysActive)}
            label="Days used"
            hint={
              account.daysSinceJoined > 0
                ? `${Math.round((streaks.daysActive / (account.daysSinceJoined + 1)) * 100)}% of the account's life`
                : undefined
            }
          />
        </div>

        {/* ------------------------------------------------------- activity */}
        <div className="mt-4">
          <Card
            title={`Last ${stats.activityWeeks} weeks`}
            hint={
              streaks.busiestDay
                ? `Longest run: ${streaks.longestStreak} day${streaks.longestStreak === 1 ? "" : "s"} · Current: ${streaks.currentStreak} · Busiest day: ${formatShortDate(streaks.busiestDay.date)} with ${streaks.busiestDay.count} prompts`
                : "Nothing here yet — the grid fills in as you use breadboard."
            }
          >
            <ActivityGrid days={stats.activity} weeks={stats.activityWeeks} />
          </Card>
        </div>

        {/* -------------------------------------------- rhythm and surfaces */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card
            title="When you work"
            hint={
              habit.peakHour === null
                ? "No prompts to read a rhythm from yet."
                : `Your busiest hour is ${hourLabel(habit.peakHour)} — ${rhythmPhrase(habit.peakHour)}.`
            }
          >
            <HourHistogram hours={habit.hours} />
            <WeekdayHistogram weekdays={habit.weekdays} />
          </Card>

          <Card
            title="Where you work"
            hint="Prompts by surface, and the gardens that carry the most of them."
          >
            {surfaces.length === 0 ? (
              <p className="text-xs text-gray-600">No prompts yet.</p>
            ) : (
              <div className="space-y-2">
                {surfaces.map((entry) => (
                  <Bar
                    key={entry.surface}
                    label={entry.label}
                    value={formatCount(entry.count)}
                    share={surfaceMax === 0 ? 0 : entry.count / surfaceMax}
                  />
                ))}
              </div>
            )}

            {gardens.length > 0 && (
              <>
                <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Busiest gardens
                </h3>
                <div className="space-y-2">
                  {gardens.map((garden) => (
                    <Bar
                      key={garden.slug}
                      label={garden.name}
                      href={`/gardens/${garden.slug}`}
                      value={formatCount(garden.prompts)}
                      share={gardenMax === 0 ? 0 : garden.prompts / gardenMax}
                    />
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>

        {/* ------------------------------------------------ output and cost */}
        {/*
          These eight panels differ wildly in height — Review delivery is worth
          several settings cards, and every one of them grows or shrinks with
          the account's own data. Two fixed columns therefore left a tall void
          under whichever side happened to end first. A balanced column set
          splits the same sequence wherever the two sides come out even, so the
          void closes no matter what the data does to any single card.
        */}
        <div className="mt-4 -mb-4 gap-4 lg:columns-2">
          <Packed>
            <Card title="What came out of it" hint="Artifacts by kind, and the agents you actually run.">
              {artifactKinds.length === 0 ? (
                <p className="text-xs text-gray-600">Nothing has been produced yet.</p>
              ) : (
                <div className="space-y-2">
                  {artifactKinds.slice(0, 6).map((entry) => (
                    <Bar
                      key={entry.kind}
                      label={entry.label}
                      value={formatCount(entry.count)}
                      share={artifactMax === 0 ? 0 : entry.count / artifactMax}
                    />
                  ))}
                </div>
              )}

              {agents.length > 0 && (
                <>
                  <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Agents
                  </h3>
                  <div className="space-y-2">
                    {agents.slice(0, 6).map((agent) => (
                      <Bar
                        key={agent.kind}
                        label={agent.label}
                        value={formatCount(agent.runs)}
                        share={agentMax === 0 ? 0 : agent.runs / agentMax}
                        meta={agent.failed > 0 ? `${agent.failed} failed` : undefined}
                      />
                    ))}
                  </div>
                </>
              )}
            </Card>
          </Packed>

          <Packed>
            <Card
              title="What it cost to answer you"
              hint={
                totals.measuredReplies === 0
                  ? "No reply has reported its usage yet."
                  : `Measured across ${formatCount(totals.measuredReplies)} of ${formatCount(totals.replies)} replies.`
              }
            >
              <div className="grid grid-cols-2 gap-3">
                <Stat value={formatCompact(totals.tokens)} label="Tokens" />
                <Stat value={formatDuration(totals.thinkingMs)} label="Spent generating" />
              </div>
              <p className="mt-3 text-xs text-gray-600">
                {totals.memories === 0
                  ? "The assistant has not committed anything to durable memory yet."
                  : `It also keeps ${formatCount(totals.memories)} thing${totals.memories === 1 ? "" : "s"} about you in durable memory.`}
              </p>
            </Card>
          </Packed>

          <Packed>
            <ContactsPanel initial={contacts} initialTotal={contactTotal} />
          </Packed>

          <Packed>
            <CalendarSyncPanel
              initial={syncedCalendars}
              vaultConfigured={calendarVaultConfigured}
            />
          </Packed>

          <Packed>
            <ReviewDeliveryPanel />
          </Packed>

          <Packed>
            <InvitePanel initial={stats.invites} />
          </Packed>

          <Packed>
            <ThemePanel />
          </Packed>

          <Packed>
            <ShortcutPanel initial={initialShortcuts} />
          </Packed>

          <Packed>
            <LocationPanel />
          </Packed>

          <Packed>
            <BrowserProfilePanel initial={browserProfile} />
          </Packed>

          <Packed>
            <GoogleImageGenerationPanel initial={googleImageGenerationStatus} />
          </Packed>

          <Packed>
            <StartupSoundPanel />
          </Packed>
        </div>

        {/* ------------------------------------------- models and reliability */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ModelPanel cost={stats.cost} />
          <ReliabilityPanel reliability={stats.reliability} />
        </div>

        {/* ----------------------------------------------- latency and memory */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <LatencyPanel latency={stats.latency} />
          <MemoryPanel memory={stats.memory} />
        </div>

        {/* ------------------------------------------------------ audit feed */}
        <AuditFeed entries={stats.audit} />

        {/* ---------------------------------------------------------- about */}
        <AboutBreadboard />
      </main>
      )}
    </div>
  );
}
