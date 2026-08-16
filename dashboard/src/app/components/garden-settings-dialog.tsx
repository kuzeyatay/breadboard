"use client";

// Garden settings, opened by the gear in the workspace header.
//
// Everything about a garden that is configuration rather than content: what it
// is called, how the assistant should behave inside it, whether what it learns
// stays inside it, whether it can be chatted with from the published site, and
// how it asks you questions. Deleting it lives here too, behind a typed
// confirmation, because there is nowhere else it sensibly belongs.
//
// Reads and writes both go through /api/gardens/[slug]/settings, which delegates
// to the cluster server actions. Calling those actions from here directly would
// pull Next's server runtime into this client component — heavier than needed,
// and it makes the component impossible to bundle for a render test.

import { useCallback, useEffect, useRef, useState } from "react";

import type { GardenMemoryScope } from "@/lib/garden-settings";
import { useReviewSettings } from "./hermes/use-review-settings";
import type { ReviewChannel } from "@/lib/review/types";

export function GardenSettingsIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

interface GardenSettings {
  id: number;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  memoryScope: GardenMemoryScope;
  chatAccessible: boolean;
  visibility: "private" | "public";
}

const field =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--paper-inset,transparent)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--botanical)]";
const labelText = "block text-sm font-medium text-[var(--ink-heading)]";
const hintText = "mt-0.5 text-xs leading-5 text-[var(--ink-muted)]";

function Field({
  label,
  hint,
  labelId,
  children,
}: {
  label: string;
  hint?: string;
  /** Set when a listbox inside needs to point at this label. */
  labelId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <span id={labelId} className={labelText}>
        {label}
      </span>
      {hint ? <p className={hintText}>{hint}</p> : null}
      <div className="mt-2">{children}</div>
    </div>
  );
}

const MEMORY_OPTIONS: ReadonlyArray<DescribedOption<GardenMemoryScope>> = [
  {
    value: "default",
    label: "Default memory",
    description: "This garden can access memory from outside chats, and vice versa.",
  },
  {
    value: "garden_only",
    label: "Garden-only memory",
    description:
      "This garden can only access its own memory. Its memory is hidden from outside chats.",
  },
];

const PUBLISHED_CHAT_OPTIONS: ReadonlyArray<DescribedOption<"enabled" | "disabled">> = [
  {
    value: "enabled",
    label: "Enabled",
    description: "Readers of the published garden can ask questions about it.",
  },
  {
    value: "disabled",
    label: "Disabled",
    description: "The published garden is reading only. You can still chat with it here.",
  },
];

interface DescribedOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

/**
 * A select whose options carry a description.
 *
 * A native `<select>` cannot show more than a line per option, and the choice
 * here — whether a garden's memory is sealed — is not one anybody should have to
 * guess at from two words. So this is a real listbox: closed it reads like a
 * field, open it explains both options and marks the current one.
 */
function DescribedSelect<T extends string>({
  value,
  options,
  disabled,
  onChange,
  labelledBy,
}: {
  value: T;
  options: ReadonlyArray<DescribedOption<T>>;
  disabled?: boolean;
  onChange: (value: T) => void;
  labelledBy: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dropUp, setDropUp] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    // Pointer-down rather than click so a press that starts outside closes the
    // list instead of selecting whatever it lands on.
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  /**
   * Opening starts the highlight on the current choice, so arrowing moves from
   * where you are rather than from the top. Done here rather than in an effect
   * keyed on `open`: reacting to your own state change is both a render wasted
   * and the pattern the hooks lint rejects.
   */
  function openList() {
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    // The dialog body scrolls, so a list opening downward near its bottom edge
    // would be clipped by that container rather than overflowing it. Measured
    // at open time and flipped upward when there is more room above.
    const trigger = wrapperRef.current?.getBoundingClientRect();
    if (trigger) {
      const estimatedHeight = 24 + options.length * 68;
      const below = window.innerHeight - trigger.bottom;
      setDropUp(below < estimatedHeight && trigger.top > below);
    }
    setOpen(true);
  }

  function commit(next: T) {
    setOpen(false);
    if (next !== value) onChange(next);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
        event.preventDefault();
        openList();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      // Stop the dialog's own Escape handler from closing everything at once.
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(options.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(options[activeIndex].value);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelledBy}
        className={`${field} flex items-center justify-between gap-3 text-left disabled:opacity-40`}
      >
        <span>{selected.label}</span>
        <svg
          aria-hidden
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <ul
          role="listbox"
          aria-labelledby={labelledBy}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className={`neu-dialog absolute left-0 right-0 z-20 overflow-hidden rounded-xl border border-[var(--line)] p-1 shadow-lg ${
            dropUp ? "bottom-[calc(100%+0.375rem)]" : "top-[calc(100%+0.375rem)]"
          }`}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(option.value)}
                  className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                    isActive ? "bg-[var(--line)]" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-[var(--ink-heading)]">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-[var(--ink-muted)]">
                      {option.description}
                    </span>
                  </span>
                  {isSelected ? (
                    <svg
                      aria-hidden
                      className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-heading)]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m5 13 4 4L19 7" />
                    </svg>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function Slider({
  label,
  value,
  display,
  min,
  max,
  disabled,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  hint?: string;
}) {
  return (
    <div className="mt-3 first:mt-0">
      <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]">
        <span>{label}</span>
        <span className="text-[var(--ink)]">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full"
      />
      {hint ? <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">{hint}</p> : null}
    </div>
  );
}

export default function GardenSettingsDialog({
  gardenSlug,
  onClose,
}: {
  gardenSlug: string;
  onClose: () => void;
}) {
  const review = useReviewSettings(gardenSlug);
  const settingsUrl = `/api/gardens/${encodeURIComponent(gardenSlug)}/settings`;
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const [settings, setSettings] = useState<GardenSettings | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(settingsUrl);
        if (!response.ok) return;
        const payload = (await response.json()) as { settings: GardenSettings };
        if (cancelled) return;
        setSettings(payload.settings);
        setName(payload.settings.name);
        setDescription(payload.settings.description);
        setInstructions(payload.settings.instructions);
      } catch {
        // The review half still works without this; the fields simply stay
        // disabled rather than the whole dialog failing to open.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settingsUrl]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const flash = useCallback((message: string) => {
    setSaved(message);
    window.setTimeout(() => setSaved(""), 2_000);
  }, []);

  /** PATCH the settings route and adopt whatever it returns as the new truth. */
  async function save(body: Record<string, unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(settingsUrl, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? "Could not save that.");
      }
      const payload = (await response.json()) as { settings: GardenSettings };
      setSettings(payload.settings);
      setName(payload.settings.name);
      setDescription(payload.settings.description);
      setInstructions(payload.settings.instructions);
      flash(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  const nameDirty = settings !== null && name.trim() !== settings.name;
  const descriptionDirty = settings !== null && description.trim() !== settings.description;
  const instructionsDirty = settings !== null && instructions.trim() !== settings.instructions;

  const channels: Array<{ value: ReviewChannel; label: string; note: string; enabled: boolean }> = [
    { value: "off", label: "Off", note: "No questions are sent.", enabled: true },
    {
      value: "whatsapp",
      label: "WhatsApp",
      note: review.available.whatsapp ? "Your most recent chat." : "Link WhatsApp first.",
      enabled: review.available.whatsapp,
    },
    {
      value: "telegram",
      label: "Telegram",
      note: review.available.telegram ? "Your most recent chat." : "Link Telegram first.",
      enabled: review.available.telegram,
    },
  ];

  return (
    <div
      className="bb-modal-backdrop fixed inset-0 z-[150] flex items-center justify-center px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="garden-settings-title"
        className="bb-modal-panel neu-dialog flex max-h-[min(52rem,94vh)] w-full max-w-[min(40rem,94vw)] flex-col overflow-hidden rounded-2xl border text-[var(--ink)]"
      >
        <header className="flex items-center gap-4 border-b border-[var(--line)] px-5 py-4">
          <h2 id="garden-settings-title" className="flex-1 font-serif text-lg text-[var(--ink-heading)]">
            Garden settings
          </h2>
          {saved ? (
            <span className="text-xs text-[var(--botanical)]">{saved}</span>
          ) : null}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="neu-button-icon flex h-9 w-9 items-center justify-center rounded-full"
            aria-label="Close garden settings"
          >
            <svg
              aria-hidden
              className="h-4 w-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path strokeLinecap="round" d="m4 4 8 8m0-8-8 8" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 divide-y divide-[var(--line)] overflow-y-auto">
          {error ? <p className="px-5 pt-4 text-xs text-[var(--danger)]">{error}</p> : null}

          {/* ------------------------------------------------------- identity */}
          <Field label="Garden name">
            <input
              value={name}
              disabled={busy || settings === null}
              onChange={(event) => setName(event.target.value)}
              className={field}
              placeholder="Electromagnetism 1"
            />
          </Field>

          <Field label="Description" hint="Shown on the dashboard card and the garden's index page.">
            <input
              value={description}
              disabled={busy || settings === null}
              onChange={(event) => setDescription(event.target.value)}
              className={field}
              placeholder="What this garden is for."
            />
          </Field>

          {nameDirty || descriptionDirty ? (
            <div className="px-5 py-3">
              <button
                type="button"
                disabled={busy || !name.trim()}
                onClick={() =>
                  void save(
                    { name: name.trim(), description: description.trim() },
                    "Saved",
                  )
                }
                className="neu-button rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--ink)] disabled:opacity-40"
              >
                Save name and description
              </button>
            </div>
          ) : null}

          {/* --------------------------------------------------- instructions */}
          <Field
            label="Instructions"
            hint="Set context and customize how the assistant responds in this garden."
          >
            <textarea
              value={instructions}
              disabled={busy || settings === null}
              onChange={(event) => setInstructions(event.target.value)}
              rows={4}
              maxLength={4000}
              className={`${field} resize-y`}
              placeholder={
                'e.g. "Always show the derivation before the result. Use SI units. Assume I know vector calculus."'
              }
            />
            {instructionsDirty ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void save({ instructions: instructions.trim() }, "Instructions saved")
                }
                className="neu-button mt-2 rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--ink)] disabled:opacity-40"
              >
                Save instructions
              </button>
            ) : null}
          </Field>

          {/* --------------------------------------------------------- memory */}
          <Field label="Memory" labelId="garden-memory-label">
            <DescribedSelect
              labelledBy="garden-memory-label"
              value={settings?.memoryScope ?? "default"}
              options={MEMORY_OPTIONS}
              disabled={busy || settings === null}
              onChange={(scope) => void save({ memoryScope: scope }, "Memory setting saved")}
            />
            <p className={hintText}>
              {
                (MEMORY_OPTIONS.find((option) => option.value === (settings?.memoryScope ?? "default"))
                  ?? MEMORY_OPTIONS[0]).description
              }
            </p>
          </Field>

          {/* ------------------------------------------------- published chat */}
          <Field
            label="Chat on the published site"
            labelId="garden-published-chat-label"
            hint="Private gardens are only ever reachable by you."
          >
            <DescribedSelect
              labelledBy="garden-published-chat-label"
              value={settings?.chatAccessible ? "enabled" : "disabled"}
              options={PUBLISHED_CHAT_OPTIONS}
              disabled={busy || settings === null}
              onChange={(next) => void save({ chatAccessible: next === "enabled" }, "Saved")}
            />
          </Field>

          {/* ---------------------------------------------- spaced repetition */}
          <Field
            label="Spaced repetition"
            hint="Turn this garden's pages into questions, scheduled so each returns just before you would forget it."
          >
            {review.loading && !review.data ? (
              <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
            ) : review.data ? (
              <>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={review.data.garden.enabled}
                    disabled={review.saving}
                    onChange={(event) =>
                      void review.patchGarden({ enabled: event.target.checked })
                    }
                    className="mt-0.5"
                  />
                  <span className="text-sm text-[var(--ink)]">Ask me about this garden</span>
                </label>

                {review.data.garden.enabled && review.data.user.channel === "off" ? (
                  <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-5">
                    Pick a delivery channel below, or nothing will be sent.
                  </p>
                ) : null}

                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <Stat label="cards" value={review.data.stats.total} />
                  <Stat label="due now" value={review.data.stats.due} />
                  <Stat label="new" value={review.data.stats.newCards} />
                </div>

                <button
                  type="button"
                  onClick={() => void review.seed()}
                  disabled={review.seeding}
                  className="neu-button mt-3 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink)] disabled:opacity-50"
                >
                  {review.seeding
                    ? "Reading pages and writing questions…"
                    : review.data.garden.cardCount === 0
                      ? "Build cards from this garden"
                      : "Refresh cards from this garden"}
                </button>
                {review.notice ? (
                  <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">
                    {review.notice}
                  </p>
                ) : null}

                <Slider
                  label="Questions per day from this garden"
                  value={review.data.garden.dailyLimit}
                  display={String(review.data.garden.dailyLimit)}
                  min={1}
                  max={20}
                  disabled={review.saving}
                  onChange={(value) => void review.patchGarden({ dailyLimit: value })}
                  hint={`Capped by your overall limit of ${review.data.user.dailyLimit} across all gardens.`}
                />
              </>
            ) : null}
          </Field>

          {/* ------------------------------------------------------- delivery */}
          {review.data ? (
            <Field
              label="Review delivery"
              hint="Where questions arrive, and how many. Applies to every garden, not just this one."
            >
              <div className="grid grid-cols-3 gap-2">
                {channels.map((channel) => {
                  const active = review.data?.user.channel === channel.value;
                  return (
                    <button
                      key={channel.value}
                      type="button"
                      disabled={review.saving || !channel.enabled}
                      onClick={() => void review.patchUser({ channel: channel.value })}
                      className={`neu-button rounded-xl border px-3 py-2 text-left transition disabled:opacity-40 ${
                        active ? "border-[var(--botanical)]" : "border-[var(--line)]"
                      }`}
                    >
                      <span className="block text-xs font-medium text-[var(--ink)]">
                        {channel.label}
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-[var(--ink-muted)]">
                        {channel.note}
                      </span>
                    </button>
                  );
                })}
              </div>

              <Slider
                label="Questions per day (all gardens)"
                value={review.data.user.dailyLimit}
                display={String(review.data.user.dailyLimit)}
                min={1}
                max={50}
                disabled={review.saving}
                onChange={(value) => void review.patchUser({ dailyLimit: value })}
              />

              <Slider
                label="Start sending from"
                value={review.data.user.sendHour}
                display={`${String(review.data.user.sendHour).padStart(2, "0")}:00`}
                min={0}
                max={23}
                disabled={review.saving}
                onChange={(value) => void review.patchUser({ sendHour: value })}
                hint="One question at a time. The next arrives once you answer the last."
              />

              <Slider
                label="Target recall"
                value={Math.round(review.data.user.desiredRetention * 100)}
                display={`${Math.round(review.data.user.desiredRetention * 100)}%`}
                min={70}
                max={97}
                disabled={review.saving}
                onChange={(value) => void review.patchUser({ desiredRetention: value / 100 })}
                hint="Higher means shorter intervals and more reviews for the same material."
              />
            </Field>
          ) : null}

          {/* --------------------------------------------------------- danger */}
          <div className="px-5 py-4">
            <span className={labelText}>Delete garden</span>
            <p className={hintText}>
              Removes this garden, its pages, and its review cards. This cannot be undone.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={confirmDelete}
                disabled={deleting || settings === null}
                onChange={(event) => setConfirmDelete(event.target.value)}
                className={field}
                placeholder={`Type ${settings?.name ?? gardenSlug} to confirm`}
                aria-label="Confirm garden name to delete"
              />
              <button
                type="button"
                disabled={
                  deleting ||
                  settings === null ||
                  confirmDelete.trim() !== (settings?.name ?? "")
                }
                onClick={() => {
                  if (!settings) return;
                  setDeleting(true);
                  setError(null);
                  void (async () => {
                    try {
                      const response = await fetch(settingsUrl, { method: "DELETE" });
                      if (!response.ok) throw new Error("Could not delete the garden.");
                      // A hard navigation, not router.push: the garden this page
                      // is rendering no longer exists, so re-rendering it would
                      // race the redirect against a 404.
                      window.location.assign("/dashboard");
                    } catch (cause) {
                      setError(
                        cause instanceof Error ? cause.message : "Could not delete the garden.",
                      );
                      setDeleting(false);
                    }
                  })();
                }}
                className="shrink-0 rounded-lg border border-[var(--danger)] px-3 py-2 text-sm text-[var(--danger)] transition disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--line)] py-2">
      <div className="text-base text-[var(--ink-heading)]">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">{label}</div>
    </div>
  );
}
