"use client";

// The event dialog: create, edit, delete.
//
// Nextcloud Calendar splits this into a popover and a full editor; one dialog
// covers the same ground here, with the repeat controls disclosed only once a
// frequency is chosen so the common case stays a four-field form.

import { useEffect, useId, useRef, useState } from "react";

import { describeRecurrence } from "@/lib/calendar/recurrence.ts";
import type {
  Attendee,
  AttendeeRole,
  AttendeeStatus,
  CalendarCollection,
  RecurrenceFrequency,
} from "@/lib/calendar/types.ts";

export type RecurrenceEndMode = "never" | "until" | "count";

export interface EventDraft {
  /** null for a new event. */
  eventId: number | null;
  calendarId: number;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  frequency: RecurrenceFrequency;
  interval: number;
  endMode: RecurrenceEndMode;
  until: string;
  count: number;
  attendees: Attendee[];
  organizerEmail: string;
  organizerName: string;
  /** True when this occurrence belongs to a repeating series. */
  recurringInstance: boolean;
  /** The occurrence's original start, needed to scope an edit to it. */
  recurrenceId: string | null;
  /** Subscribed calendars are shown read-only. */
  readOnly: boolean;
}

export interface EventPayload {
  calendarId: number;
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  startsAt: string;
  endsAt: string;
  recurrence: {
    frequency: RecurrenceFrequency;
    interval: number;
    until: string | null;
    count: number | null;
  };
  attendees: Attendee[];
  organizerEmail: string | null;
  organizerName: string | null;
}

export function draftToPayload(draft: EventDraft): EventPayload {
  return {
    calendarId: draft.calendarId,
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    location: draft.location.trim() || null,
    allDay: draft.allDay,
    startsAt: `${draft.startDate}T${draft.allDay ? "00:00" : draft.startTime}`,
    endsAt: `${draft.endDate}T${draft.allDay ? "23:59" : draft.endTime}`,
    recurrence: {
      frequency: draft.frequency,
      interval: draft.interval,
      until: draft.frequency !== "none" && draft.endMode === "until" ? draft.until : null,
      count: draft.frequency !== "none" && draft.endMode === "count" ? draft.count : null,
    },
    attendees: draft.attendees,
    organizerEmail: draft.organizerEmail.trim() || null,
    organizerName: draft.organizerName.trim() || null,
  };
}

const STATUS_LABELS: Record<AttendeeStatus, string> = {
  "needs-action": "No reply",
  accepted: "Going",
  declined: "Not going",
  tentative: "Maybe",
};

const ROLE_LABELS: Record<AttendeeRole, string> = {
  required: "Required",
  optional: "Optional",
  chair: "Chair",
};

/** Muted status colours drawn from the palette, never a traffic-light green. */
const STATUS_COLORS: Record<AttendeeStatus, string> = {
  "needs-action": "var(--ink-muted)",
  accepted: "var(--botanical)",
  declined: "var(--danger)",
  tentative: "var(--botanical-2)",
};

const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  none: "Does not repeat",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

interface Props {
  draft: EventDraft;
  calendars: readonly CalendarCollection[];
  saving: boolean;
  error: string | null;
  onSave: (draft: EventDraft) => void;
  onDelete: (eventId: number) => void;
  onClose: () => void;
}

function AttendeeList({
  attendees,
  disabled,
  onChange,
}: {
  attendees: Attendee[];
  disabled: boolean;
  onChange: (next: Attendee[]) => void;
}) {
  const [entry, setEntry] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);

  function add() {
    const raw = entry.trim();
    if (!raw) return;

    // "Ada Lovelace <ada@example.com>" and a bare address both work, and one
    // paste of a comma-separated list adds everyone in it.
    const added: Attendee[] = [];
    for (const chunk of raw.split(/[,;]/)) {
      const piece = chunk.trim();
      if (!piece) continue;

      const angled = /^(.*?)\s*<([^>]+)>$/.exec(piece);
      const email = (angled ? angled[2] : piece).trim().toLowerCase();
      const name = angled && angled[1].trim() ? angled[1].trim() : null;

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setEntryError(`"${piece}" is not an email address.`);
        return;
      }
      if (attendees.some((attendee) => attendee.email === email)) continue;
      added.push({ email, name, role: "required", status: "needs-action" });
    }

    if (added.length > 0) onChange([...attendees, ...added]);
    setEntry("");
    setEntryError(null);
  }

  return (
    <div className="space-y-2">
      {attendees.length > 0 && (
        <ul className="neu-inset space-y-1 rounded-lg border p-2">
          {attendees.map((attendee) => (
            <li key={attendee.email} className="flex items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[attendee.status] }}
                title={STATUS_LABELS[attendee.status]}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-xs text-gray-300">
                {attendee.name ? `${attendee.name} · ` : ""}
                <span className="text-gray-500">{attendee.email}</span>
              </span>

              <select
                value={attendee.role}
                disabled={disabled}
                onChange={(event) =>
                  onChange(
                    attendees.map((item) =>
                      item.email === attendee.email
                        ? { ...item, role: event.target.value as AttendeeRole }
                        : item,
                    ),
                  )
                }
                aria-label={`Role for ${attendee.email}`}
                className="neu-control shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] text-white outline-none"
              >
                {(Object.keys(ROLE_LABELS) as AttendeeRole[]).map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>

              <select
                value={attendee.status}
                disabled={disabled}
                onChange={(event) =>
                  onChange(
                    attendees.map((item) =>
                      item.email === attendee.email
                        ? { ...item, status: event.target.value as AttendeeStatus }
                        : item,
                    ),
                  )
                }
                aria-label={`Reply from ${attendee.email}`}
                className="neu-control shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] text-white outline-none"
              >
                {(Object.keys(STATUS_LABELS) as AttendeeStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  onChange(attendees.filter((item) => item.email !== attendee.email))
                }
                aria-label={`Remove ${attendee.email}`}
                className="shrink-0 px-1 text-xs text-gray-500 hover:text-red-400"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          value={entry}
          disabled={disabled}
          onChange={(event) => {
            setEntry(event.target.value);
            setEntryError(null);
          }}
          onKeyDown={(event) => {
            // Enter adds a person rather than submitting the whole event.
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="name@example.com"
          className="neu-control min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm text-white outline-none"
        />
        <button
          type="button"
          disabled={disabled || !entry.trim()}
          onClick={add}
          className="neu-button rounded-lg border px-3 py-2 text-sm text-gray-400 disabled:opacity-40"
        >
          Invite
        </button>
      </div>

      {entryError && <p className="text-xs text-red-400">{entryError}</p>}
    </div>
  );
}

export default function CalendarEventEditor({
  draft: initialDraft,
  calendars,
  saving,
  error,
  onSave,
  onDelete,
  onClose,
}: Props) {
  // The dialog is mounted only while an event is open and unmounts on close, so
  // the incoming draft is the initial state — no effect is needed to re-seed it.
  const [draft, setDraft] = useState<EventDraft>(initialDraft);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const fieldId = useId();

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function patch(next: Partial<EventDraft>) {
    setDraft((current) => {
      const merged = { ...current, ...next };
      // Keep the end from drifting before the start while the user types.
      if (merged.endDate < merged.startDate) merged.endDate = merged.startDate;
      if (
        !merged.allDay &&
        merged.endDate === merged.startDate &&
        merged.endTime < merged.startTime
      ) {
        merged.endTime = merged.startTime;
      }
      return merged;
    });
  }

  const isNew = draft.eventId === null;
  const label = "mb-1 block text-xs font-medium uppercase tracking-wider text-gray-500";
  const control =
    "neu-control w-full rounded-lg border px-3 py-2 text-sm text-white outline-none";

  return (
    <div
      className="bb-modal-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-8"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? "New event" : "Edit event"}
        className="bb-modal-panel neu-dialog w-full max-w-lg rounded-2xl border p-6"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave(draft);
          }}
          className="space-y-4"
        >
          <div>
            <label className={label} htmlFor={`${fieldId}-title`}>
              Event
            </label>
            <input
              id={`${fieldId}-title`}
              ref={titleRef}
              value={draft.title}
              onChange={(event) => patch({ title: event.target.value })}
              placeholder="Add a title"
              maxLength={200}
              className={`${control} text-base`}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor={`${fieldId}-calendar`}>
                Calendar
              </label>
              <div className="flex items-center gap-2">
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      calendars.find((calendar) => calendar.id === draft.calendarId)
                        ?.color ?? "var(--botanical)",
                  }}
                  aria-hidden="true"
                />
                <select
                  id={`${fieldId}-calendar`}
                  value={draft.calendarId}
                  onChange={(event) => patch({ calendarId: Number(event.target.value) })}
                  className={control}
                >
                  {calendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-end">
              <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-gray-400">
                <input
                  type="checkbox"
                  checked={draft.allDay}
                  onChange={(event) => patch({ allDay: event.target.checked })}
                  className="size-4 accent-[var(--botanical)]"
                />
                All day
              </label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor={`${fieldId}-start`}>
                Starts
              </label>
              <div className="flex gap-2">
                <input
                  id={`${fieldId}-start`}
                  type="date"
                  value={draft.startDate}
                  onChange={(event) => patch({ startDate: event.target.value })}
                  className={control}
                />
                {!draft.allDay && (
                  <input
                    type="time"
                    value={draft.startTime}
                    onChange={(event) => patch({ startTime: event.target.value })}
                    className={`${control} w-28`}
                  />
                )}
              </div>
            </div>

            <div>
              <label className={label} htmlFor={`${fieldId}-end`}>
                Ends
              </label>
              <div className="flex gap-2">
                <input
                  id={`${fieldId}-end`}
                  type="date"
                  value={draft.endDate}
                  min={draft.startDate}
                  onChange={(event) => patch({ endDate: event.target.value })}
                  className={control}
                />
                {!draft.allDay && (
                  <input
                    type="time"
                    value={draft.endTime}
                    onChange={(event) => patch({ endTime: event.target.value })}
                    className={`${control} w-28`}
                  />
                )}
              </div>
            </div>
          </div>

          <div>
            <label className={label} htmlFor={`${fieldId}-repeat`}>
              Repeat
            </label>
            <select
              id={`${fieldId}-repeat`}
              value={draft.frequency}
              onChange={(event) =>
                patch({ frequency: event.target.value as RecurrenceFrequency })
              }
              className={control}
            >
              {(Object.keys(FREQUENCY_LABELS) as RecurrenceFrequency[]).map((value) => (
                <option key={value} value={value}>
                  {FREQUENCY_LABELS[value]}
                </option>
              ))}
            </select>

            {draft.frequency !== "none" && (
              <div className="neu-inset mt-2 space-y-3 rounded-lg border p-3">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <span>Every</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={draft.interval}
                    onChange={(event) =>
                      patch({ interval: Math.max(1, Number(event.target.value) || 1) })
                    }
                    className={`${control} w-20`}
                  />
                  <span>
                    {draft.frequency === "daily"
                      ? "day(s)"
                      : draft.frequency === "weekly"
                        ? "week(s)"
                        : draft.frequency === "monthly"
                          ? "month(s)"
                          : "year(s)"}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-sm text-gray-400">
                  <span className="shrink-0">Ends</span>
                  <select
                    value={draft.endMode}
                    onChange={(event) =>
                      patch({ endMode: event.target.value as RecurrenceEndMode })
                    }
                    className={`${control} w-32`}
                  >
                    <option value="never">Never</option>
                    <option value="until">On date</option>
                    <option value="count">After</option>
                  </select>
                  {draft.endMode === "until" && (
                    <input
                      type="date"
                      value={draft.until}
                      min={draft.startDate}
                      onChange={(event) => patch({ until: event.target.value })}
                      className={`${control} w-44`}
                    />
                  )}
                  {draft.endMode === "count" && (
                    <>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={draft.count}
                        onChange={(event) =>
                          patch({ count: Math.max(1, Number(event.target.value) || 1) })
                        }
                        className={`${control} w-24`}
                      />
                      <span>times</span>
                    </>
                  )}
                </div>

                <p className="text-xs text-gray-500">
                  {describeRecurrence({
                    frequency: draft.frequency,
                    interval: draft.interval,
                    until: draft.endMode === "until" ? draft.until : null,
                    count: draft.endMode === "count" ? draft.count : null,
                  })}
                  . Editing changes every occurrence.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className={label} htmlFor={`${fieldId}-location`}>
              Location
            </label>
            <input
              id={`${fieldId}-location`}
              value={draft.location}
              onChange={(event) => patch({ location: event.target.value })}
              placeholder="Optional"
              maxLength={300}
              className={control}
            />
          </div>

          <div>
            <label className={label} htmlFor={`${fieldId}-notes`}>
              Notes
            </label>
            <textarea
              id={`${fieldId}-notes`}
              value={draft.description}
              onChange={(event) => patch({ description: event.target.value })}
              placeholder="Optional"
              rows={3}
              className={`${control} resize-y`}
            />
          </div>

          <div>
            <span className={label}>Attendees</span>
            <AttendeeList
              attendees={draft.attendees}
              disabled={draft.readOnly}
              onChange={(attendees) => patch({ attendees })}
            />

            {draft.attendees.length > 0 && (
              <div className="mt-2 space-y-2">
                <input
                  value={draft.organizerEmail}
                  onChange={(event) => patch({ organizerEmail: event.target.value })}
                  placeholder="Organizer email (appears on the invitation)"
                  aria-label="Organizer email"
                  className={`${control} text-xs`}
                />
                {!isNew && (
                  <p className="text-xs text-gray-500">
                    Breadboard does not send mail.{" "}
                    <a
                      href={`/api/calendar/events/${draft.eventId}/invite`}
                      className="underline decoration-dotted underline-offset-2 hover:text-white"
                    >
                      Download the .ics invitation
                    </a>{" "}
                    and attach it, then record replies above.
                  </p>
                )}
              </div>
            )}
          </div>

          {draft.readOnly && (
            <p className="text-xs text-gray-500">
              This event comes from a subscribed calendar and cannot be edited here.
            </p>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex items-center gap-3 pt-1">
            {!isNew &&
              !draft.readOnly &&
              (confirmingDelete ? (
                <button
                  type="button"
                  onClick={() => onDelete(draft.eventId as number)}
                  disabled={saving}
                  className="neu-button-destructive rounded-lg border px-4 py-2.5 text-sm disabled:opacity-50"
                >
                  {draft.recurringInstance ? "Delete…" : "Delete for good?"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={saving}
                  className="neu-button rounded-lg border px-4 py-2.5 text-sm text-red-400 disabled:opacity-50"
                >
                  Delete
                </button>
              ))}

            <button
              type="button"
              onClick={onClose}
              className="neu-button ml-auto rounded-lg border px-4 py-2.5 text-sm text-gray-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || draft.readOnly || draft.title.trim().length === 0}
              className="neu-button-accent rounded-lg border px-5 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {saving
                ? "Saving…"
                : isNew
                  ? "Add event"
                  : draft.recurringInstance
                    ? "Save…"
                    : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
