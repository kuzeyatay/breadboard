"use client";

// The calendar shell: toolbar, sidebar and the grid, plus the data loading and
// mutations behind them.
//
// State that a reader would expect to survive a reload — which view, which week
// — is mirrored into the query string with replaceState rather than the router,
// so paging through months never pushes forty entries onto the back stack.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import CalendarEventEditor, {
  draftToPayload,
  type EventDraft,
} from "./calendar-event-editor";
import CalendarGrid, { type DueTaskChip } from "./calendar-views";
import {
  formatRangeTitle,
  MONTH_NAMES,
  WEEKDAY_ABBREVIATIONS,
} from "@/lib/calendar/format.ts";
import {
  buildMonthGrid,
  rangeForView,
  shiftAnchor,
  type CalendarView,
} from "@/lib/calendar/layout.ts";
import { CALENDAR_PALETTE } from "@/lib/calendar/palette.ts";
import type {
  CalendarCollection,
  CalendarEvent,
  CalendarOccurrence,
} from "@/lib/calendar/types.ts";
import {
  addDays,
  addMinutes,
  dateOf,
  minutesBetween,
  nowStamp,
  timeOf,
  todayDate,
} from "@/lib/calendar/wallclock.ts";
import type { DragResult } from "./use-event-drag";

const VIEW_OPTIONS: { value: CalendarView; label: string; key: string }[] = [
  { value: "month", label: "Month", key: "m" },
  { value: "week", label: "Week", key: "w" },
  { value: "day", label: "Day", key: "d" },
  { value: "agenda", label: "Agenda", key: "a" },
];

/** Default length of an event created by clicking an empty slot. */
const DEFAULT_EVENT_MINUTES = 60;

interface Props {
  initialCalendars: CalendarCollection[];
  initialToday: string;
  initialView: CalendarView;
  initialAnchor: string;
  /**
   * Rendered inside the Plan page's shell rather than as its own full-height
   * app. The page above already says where the reader is and owns the window
   * height, so the brand link and the 100vh shell are dropped; every calendar
   * control stays, because those belong to the calendar and not to the page.
   */
  embedded?: boolean;
  /** Due work to draw beside the events, keyed by "YYYY-MM-DD". */
  dueTasks?: ReadonlyMap<string, readonly DueTaskChip[]>;
  onSelectTask?: (taskId: number) => void;
  /** Announces the visible window so the page can load that range's due work. */
  onRangeChange?: (from: string, to: string) => void;
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path strokeLinecap="round" d="M3.5 9.75h17M8.5 2.75v3.5M15.5 2.75v3.5" />
      <circle cx="8.75" cy="14" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return typeof body?.error === "string" ? body.error : fallback;
}

export default function CalendarClient({
  initialCalendars,
  initialToday,
  initialView,
  initialAnchor,
  embedded = false,
  dueTasks,
  onSelectTask,
  onRangeChange,
}: Props) {
  const [calendars, setCalendars] = useState<CalendarCollection[]>(initialCalendars);
  const [view, setView] = useState<CalendarView>(initialView);
  const [anchor, setAnchor] = useState(initialAnchor);
  const [today, setToday] = useState(initialToday);
  // Null until hydration: the grid's "now" line must not be rendered on the
  // server, where the clock would disagree with the browser's.
  const [now, setNow] = useState<string | null>(null);

  const [occurrences, setOccurrences] = useState<CalendarOccurrence[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingCalendarId, setEditingCalendarId] = useState<number | null>(null);
  const [newCalendarName, setNewCalendarName] = useState("");

  const requestId = useRef(0);

  const visibleCalendarIds = useMemo(
    () => calendars.filter((calendar) => calendar.visible).map((calendar) => calendar.id),
    [calendars],
  );
  const calendarsById = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar])),
    [calendars],
  );
  const range = useMemo(() => rangeForView(view, anchor), [view, anchor]);

  // Track the real clock so the "now" line and today's highlight stay honest in
  // a tab left open past midnight.
  useEffect(() => {
    const tick = () => {
      setNow(nowStamp());
      setToday(todayDate());
    };
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    url.searchParams.set("date", anchor);
    window.history.replaceState(null, "", url);
  }, [view, anchor]);

  // Paging to another month has to reload the due work as well as the events,
  // and the range only exists here, so the page above is told about it rather
  // than made to recompute what `rangeForView` already worked out.
  useEffect(() => {
    onRangeChange?.(range.from, range.to);
  }, [onRangeChange, range.from, range.to]);

  const loadOccurrences = useCallback(async () => {
    const id = (requestId.current += 1);

    if (visibleCalendarIds.length === 0) {
      setOccurrences([]);
      setEvents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
        calendarIds: visibleCalendarIds.join(","),
      });
      const response = await fetch(`/api/calendar/events?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await readError(response, "Could not load events"));

      const body = (await response.json()) as {
        occurrences: CalendarOccurrence[];
        events: CalendarEvent[];
      };
      // A slower earlier request must not overwrite a newer one.
      if (id !== requestId.current) return;

      setOccurrences(body.occurrences ?? []);
      setEvents(body.events ?? []);
      setLoadError(null);
    } catch (error) {
      if (id !== requestId.current) return;
      setLoadError(error instanceof Error ? error.message : "Could not load events");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [range.from, range.to, visibleCalendarIds]);

  useEffect(() => {
    void loadOccurrences();
  }, [loadOccurrences]);

  // ------------------------------------------------------------- mutations

  const openNewEvent = useCallback(
    (start: string, allDay: boolean) => {
      const calendarId = visibleCalendarIds[0] ?? calendars[0]?.id;
      if (!calendarId) return;

      const end = allDay ? start : addMinutes(start, DEFAULT_EVENT_MINUTES);
      setSaveError(null);
      setDraft({
        eventId: null,
        calendarId,
        title: "",
        description: "",
        location: "",
        allDay,
        startDate: dateOf(start),
        startTime: timeOf(start),
        endDate: dateOf(end),
        endTime: timeOf(end),
        frequency: "none",
        interval: 1,
        endMode: "never",
        until: dateOf(start),
        count: 10,
        attendees: [],
        organizerEmail: "",
        organizerName: "",
        recurringInstance: false,
        recurrenceId: null,
        readOnly: false,
      });
    },
    [calendars, visibleCalendarIds],
  );

  const openOccurrence = useCallback(
    (occurrence: CalendarOccurrence) => {
      const event = events.find((candidate) => candidate.id === occurrence.eventId);
      if (!event) return;

      setSaveError(null);
      setDraft({
        eventId: event.id,
        calendarId: event.calendarId,
        title: event.title,
        description: event.description ?? "",
        location: event.location ?? "",
        allDay: event.allDay,
        startDate: dateOf(event.startsAt),
        startTime: timeOf(event.startsAt),
        endDate: dateOf(event.endsAt),
        endTime: timeOf(event.endsAt),
        frequency: event.recurrence.frequency,
        interval: event.recurrence.interval,
        endMode: event.recurrence.count
          ? "count"
          : event.recurrence.until
            ? "until"
            : "never",
        until: event.recurrence.until ?? dateOf(event.startsAt),
        count: event.recurrence.count ?? 10,
        attendees: event.attendees,
        organizerEmail: event.organizerEmail ?? "",
        organizerName: event.organizerName ?? "",
        recurringInstance: occurrence.seriesId !== null,
        recurrenceId: occurrence.recurrenceId,
        readOnly: occurrence.readOnly,
      });
    },
    [events],
  );

  /**
   * Drag-to-reschedule. A "move" carries both ends of the event; a "resize"
   * drags only its end. An occurrence that belongs to a repeating series is
   * edited with instance scope, so moving one Tuesday never rewrites every
   * Tuesday - the store materialises an override for that occurrence alone.
   */
  const onDropOccurrence = useCallback(
    async (result: DragResult) => {
      const { occurrence, mode, dayDelta, minuteDelta } = result;
      if (occurrence.readOnly) return;
      if (dayDelta === 0 && minuteDelta === 0) return;

      const event = events.find((candidate) => candidate.id === occurrence.eventId);
      if (!event) return;

      const shift = (stamp: string) => addMinutes(addDays(stamp, dayDelta), minuteDelta);
      const startsAt = mode === "move" ? shift(event.startsAt) : event.startsAt;
      const endsAt = shift(event.endsAt);
      // A resize dragged past the start would invert the event; drop it instead.
      if (minutesBetween(startsAt, endsAt) < 0) return;

      setSaveError(null);
      try {
        // Partial patch: readEventPatch only applies the fields it is sent, so
        // the title, attendees and recurrence rule are left untouched.
        const response = await fetch(`/api/calendar/events/${event.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startsAt,
            endsAt,
            scope: occurrence.seriesId === null ? "series" : "instance",
            recurrenceId: occurrence.recurrenceId,
          }),
        });
        if (!response.ok) {
          throw new Error(await readError(response, "Could not move event"));
        }
        await loadOccurrences();
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Could not move event");
      }
    },
    [events, loadOccurrences],
  );

  async function saveDraft(next: EventDraft) {
    setSaving(true);
    setSaveError(null);
    try {
      const isNew = next.eventId === null;
      const response = await fetch(
        isNew ? "/api/calendar/events" : `/api/calendar/events/${next.eventId}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draftToPayload(next)),
        },
      );
      if (!response.ok) throw new Error(await readError(response, "Could not save event"));

      setDraft(null);
      await loadOccurrences();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save event");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent(eventId: number) {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/calendar/events/${eventId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Could not delete event"));
      }
      setDraft(null);
      await loadOccurrences();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not delete event");
    } finally {
      setSaving(false);
    }
  }

  async function patchCalendar(id: number, patch: Partial<CalendarCollection>) {
    // Optimistic: toggling visibility should feel instant, and a failure only
    // costs the toggle, which the next load corrects.
    setCalendars((current) =>
      current.map((calendar) =>
        calendar.id === id ? { ...calendar, ...patch } : calendar,
      ),
    );
    const response = await fetch(`/api/calendar/calendars/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) await refreshCalendars();
  }

  async function refreshCalendars() {
    const response = await fetch("/api/calendar/calendars", { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { calendars: CalendarCollection[] };
    setCalendars(body.calendars ?? []);
  }

  async function addCalendar() {
    const name = newCalendarName.trim();
    if (!name) return;
    const response = await fetch("/api/calendar/calendars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (response.ok) {
      setNewCalendarName("");
      await refreshCalendars();
    }
  }

  async function deleteCalendar(id: number) {
    const response = await fetch(`/api/calendar/calendars/${id}`, { method: "DELETE" });
    if (response.ok) {
      setEditingCalendarId(null);
      await refreshCalendars();
      await loadOccurrences();
    } else {
      setLoadError(await readError(response, "Could not delete calendar"));
    }
  }

  // ------------------------------------------------------------- shortcuts

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (draft) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();
      const option = VIEW_OPTIONS.find((candidate) => candidate.key === key);

      if (option) {
        setView(option.value);
      } else if (key === "t") {
        setAnchor(today);
      } else if (key === "n") {
        event.preventDefault();
        openNewEvent(`${today}T09:00`, false);
      } else if (event.key === "ArrowLeft") {
        setAnchor((current) => shiftAnchor(view, current, -1));
      } else if (event.key === "ArrowRight") {
        setAnchor((current) => shiftAnchor(view, current, 1));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draft, openNewEvent, today, view]);

  // ---------------------------------------------------------------- render

  const miniWeeks = useMemo(() => buildMonthGrid(anchor), [anchor]);
  const anchorMonth = anchor.slice(0, 7);

  return (
    <main
      className={`flex min-h-0 flex-col bg-gray-950 text-gray-300 ${
        embedded ? "flex-1" : "bb-calendar-shell"
      }`}
    >
      <header
        className="bb-neu-toolbar flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5"
      >
        {!embedded && (
          <a
            href="/dashboard"
            className="flex items-center gap-2 text-sm font-medium text-white"
            title="Back to breadboard"
          >
            <CalendarIcon className="h-4 w-4" />
            Calendar
          </a>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAnchor(today)}
            className="neu-button rounded-lg border px-3 py-1.5 text-xs text-gray-400"
            title="Jump to today (T)"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setAnchor((current) => shiftAnchor(view, current, -1))}
            className="neu-button-icon rounded-lg border px-2 py-1.5 text-xs text-gray-400"
            aria-label="Previous"
            title="Previous (←)"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setAnchor((current) => shiftAnchor(view, current, 1))}
            className="neu-button-icon rounded-lg border px-2 py-1.5 text-xs text-gray-400"
            aria-label="Next"
            title="Next (→)"
          >
            ›
          </button>
        </div>

        <h1 className="min-w-0 truncate text-base font-medium text-white">
          {formatRangeTitle(range.from, range.to)}
        </h1>

        <div className="ml-auto flex items-center gap-3">
          {loading && <span className="text-xs text-gray-500">Loading…</span>}

          <div className="neu-segmented flex items-center gap-0.5 rounded-lg border">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={view === option.value}
                onClick={() => setView(option.value)}
                title={`${option.label} view (${option.key.toUpperCase()})`}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  view === option.value ? "text-white" : "text-gray-500 hover:text-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => openNewEvent(`${today}T09:00`, false)}
            className="neu-button-accent rounded-lg border px-3 py-1.5 text-xs font-medium"
            title="New event (N)"
          >
            New event
          </button>
        </div>
      </header>

      {loadError && (
        <div
          className="shrink-0 border-b px-4 py-2 text-xs text-red-400"
          style={{ borderColor: "var(--neu-border)" }}
        >
          {loadError}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside
          className="bb-neu-sidebar-left hidden w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r px-3 py-4 lg:flex"
        >
          {/* Mini month */}
          <div>
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-xs font-medium text-white">
                {MONTH_NAMES[Number(anchorMonth.slice(5, 7)) - 1]}{" "}
                {anchorMonth.slice(0, 4)}
              </span>
              <span className="flex gap-0.5">
                <button
                  type="button"
                  onClick={() => setAnchor((current) => shiftAnchor("month", current, -1))}
                  className="px-1 text-xs text-gray-500 hover:text-white"
                  aria-label="Previous month"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setAnchor((current) => shiftAnchor("month", current, 1))}
                  className="px-1 text-xs text-gray-500 hover:text-white"
                  aria-label="Next month"
                >
                  ›
                </button>
              </span>
            </div>
            <div className="grid grid-cols-7 gap-px text-center">
              {WEEKDAY_ABBREVIATIONS.map((day) => (
                <span key={day} className="py-1 text-[10px] text-gray-500">
                  {day.slice(0, 1)}
                </span>
              ))}
              {miniWeeks.flat().map((date) => {
                const inMonth = date.slice(0, 7) === anchorMonth;
                const isToday = date === today;
                const isAnchor = date === anchor;
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => setAnchor(date)}
                    className={`rounded-md py-1 text-[11px] tabular-nums transition-colors ${
                      inMonth ? "text-gray-400" : "text-gray-600"
                    } ${isAnchor || isToday ? "font-semibold" : ""} hover:text-white`}
                    style={
                      isAnchor
                        ? {
                            backgroundColor: "var(--botanical)",
                            color: "var(--paper-raised)",
                          }
                        : isToday
                          ? { color: "var(--botanical)" }
                          : undefined
                    }
                  >
                    {Number(date.slice(8, 10))}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Calendars */}
          <div>
            <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-gray-500">
              Calendars
            </p>
            <ul className="space-y-0.5">
              {calendars.map((calendar) => (
                <li key={calendar.id}>
                  <div className="group flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-gray-800/50">
                    <button
                      type="button"
                      onClick={() =>
                        void patchCalendar(calendar.id, { visible: !calendar.visible })
                      }
                      className="size-3.5 shrink-0 rounded-full border transition-colors"
                      style={{
                        backgroundColor: calendar.visible ? calendar.color : "transparent",
                        borderColor: calendar.color,
                      }}
                      aria-pressed={calendar.visible}
                      title={calendar.visible ? "Hide this calendar" : "Show this calendar"}
                    />
                    <span
                      className={`min-w-0 flex-1 truncate text-xs ${
                        calendar.visible ? "text-gray-300" : "text-gray-600"
                      }`}
                    >
                      {calendar.name}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingCalendarId((current) =>
                          current === calendar.id ? null : calendar.id,
                        )
                      }
                      className="shrink-0 px-1 text-xs text-gray-500 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
                      aria-label={`Edit ${calendar.name}`}
                    >
                      ⋯
                    </button>
                  </div>

                  {editingCalendarId === calendar.id && (
                    <div className="neu-inset mt-1 space-y-2 rounded-lg border p-2">
                      <input
                        value={calendar.name}
                        onChange={(event) =>
                          setCalendars((current) =>
                            current.map((item) =>
                              item.id === calendar.id
                                ? { ...item, name: event.target.value }
                                : item,
                            ),
                          )
                        }
                        onBlur={(event) =>
                          void patchCalendar(calendar.id, { name: event.target.value })
                        }
                        maxLength={80}
                        className="neu-control w-full rounded-md border px-2 py-1 text-xs text-white outline-none"
                      />
                      <div className="flex flex-wrap gap-1">
                        {CALENDAR_PALETTE.map((swatch) => (
                          <button
                            key={swatch.value}
                            type="button"
                            onClick={() =>
                              void patchCalendar(calendar.id, { color: swatch.value })
                            }
                            title={swatch.name}
                            aria-label={swatch.name}
                            className="size-4 rounded-full border transition-transform hover:scale-110"
                            style={{
                              backgroundColor: swatch.value,
                              borderColor:
                                calendar.color === swatch.value
                                  ? "var(--ink)"
                                  : "transparent",
                            }}
                          />
                        ))}
                      </div>
                      {calendars.length > 1 && (
                        <button
                          type="button"
                          onClick={() => void deleteCalendar(calendar.id)}
                          className="text-[11px] text-red-400 hover:text-red-500"
                        >
                          Delete calendar and its events
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void addCalendar();
              }}
              className="mt-2 flex gap-1"
            >
              <input
                value={newCalendarName}
                onChange={(event) => setNewCalendarName(event.target.value)}
                placeholder="New calendar"
                maxLength={80}
                className="neu-control min-w-0 flex-1 rounded-md border px-2 py-1 text-xs text-white outline-none"
              />
              <button
                type="submit"
                disabled={!newCalendarName.trim()}
                className="neu-button rounded-md border px-2 py-1 text-xs text-gray-400 disabled:opacity-40"
                aria-label="Add calendar"
              >
                +
              </button>
            </form>
          </div>

          <p className="mt-auto px-1 text-[11px] leading-5 text-gray-600">
            <span className="text-gray-500">T</span> today ·{" "}
            <span className="text-gray-500">N</span> new ·{" "}
            <span className="text-gray-500">M W D A</span> views ·{" "}
            <span className="text-gray-500">← →</span> move
          </p>
        </aside>

        <div className="min-w-0 flex-1">
          <CalendarGrid
            view={view}
            anchor={anchor}
            today={today}
            now={now}
            occurrences={occurrences}
            calendarsById={calendarsById}
            dueTasks={dueTasks}
            onSelectTask={onSelectTask}
            onSelectOccurrence={openOccurrence}
            onCreateAt={openNewEvent}
            onDropOccurrence={onDropOccurrence}
            onOpenDay={(date) => {
              setAnchor(date);
              setView("day");
            }}
          />
        </div>
      </div>

      {draft && (
        <CalendarEventEditor
          draft={draft}
          calendars={calendars}
          saving={saving}
          error={saveError}
          onSave={(next) => void saveDraft(next)}
          onDelete={(eventId) => void deleteEvent(eventId)}
          onClose={() => setDraft(null)}
        />
      )}
    </main>
  );
}
