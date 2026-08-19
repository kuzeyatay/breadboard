"use client";

// Scheduling, as a place instead of a form buried in the palette.
//
// The composer takes a sentence ("every friday at 6pm summarize the week") and
// resolves it to a cron expression it then shows you, because a schedule you
// cannot read is a schedule you cannot trust. The cadence controls behind the +
// stay available for anything the sentence reader does not cover, and the "/"
// button is the same capability palette the chat composer has: what a scheduled
// run sends is a chat message, so a prompt or skill token belongs in this box
// exactly as it would in that one.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { CommandHub, type CommandHubHandle } from "./command-hub";
import SlashCommandMenu, { type SlashCommandMenuHandle } from "./slash-command-menu";
import type { CommandHubItem } from "@/lib/hermes/commands.ts";
import { slashQueryAt, slashQueryReplacementRange } from "@/lib/hermes/slash-query";
import { AGENT_TARS_SLASH_COMMAND } from "@/lib/ui-tars/identity.ts";
import { AGENT_BROWSER_SLASH_COMMAND } from "@/lib/agent-browser/identity.ts";
import { AGENT_REACH_COMMAND } from "@/lib/agent-reach/identity.ts";
import { CAREER_OPS_COMMAND } from "@/lib/career-ops/identity.ts";
import { DEEP_RESEARCH_SLASH_COMMAND } from "@/lib/deep-research/identity.ts";
import { OPENPLANTER_COMMAND } from "@/lib/openplanter/identity.ts";
import { SOCIALS_MANAGER_COMMAND } from "@/lib/socials-manager/identity.ts";
import { HARDWARE_BLUEPRINT_COMMAND } from "@/lib/hardware/identity.ts";
import { PARAMETRIC_CAD_COMMAND } from "@/lib/cad/identity.ts";
import { HYPERFRAMES_COMMAND } from "@/lib/hyperframes/identity.ts";
import { OPENMONTAGE_COMMAND } from "@/lib/openmontage/identity.ts";
import { OPENWORK_COMMAND } from "@/lib/openwork/identity.ts";
import { DEER_FLOW_COMMAND } from "@/lib/deer-flow/identity.ts";
import { VIMAX_COMMAND } from "@/lib/vimax/identity.ts";
import { MONEY_PRINTER_COMMAND } from "@/lib/money-printer/identity.ts";
import { LEGAL_COMMAND } from "@/lib/legal/identity.ts";
import { CODEX_COMMAND } from "@/lib/codex/identity.ts";
import { OPENCODE_COMMAND } from "@/lib/opencode/identity.ts";
import { RUFLO_COMMAND } from "@/lib/ruflo/identity.ts";
import {
  describeCronExpression,
  isValidCronExpression,
  nextCronOccurrence,
} from "@/lib/schedules/cron.ts";
import { parseScheduleRequest } from "@/lib/schedules/natural-language.ts";
import type { ScheduledChatJob, ScheduledChatSurface } from "@/lib/schedules/types.ts";
import { scheduleTargetLabel } from "@/lib/schedules/types.ts";
import {
  cronFromCadence,
  formatRelativeRunTime,
  formatRunTime,
  notifySchedulesChanged,
  SCHEDULE_CADENCES,
  SCHEDULES_CHANGED_EVENT,
  WEEKDAY_LABELS,
  type ScheduleCadence,
} from "./schedule-client";

interface Props {
  surface: ScheduledChatSurface;
  /**
   * The garden this panel belongs to. It is both what a new schedule targets
   * and what the list is narrowed to: inside a garden the panel shows that
   * garden's schedules, while the Terminal's shows every schedule there is.
   */
  gardenSlug?: string | null;
}

interface ScheduleTemplate {
  emoji: string;
  name: string;
  description: string;
}

// Suggestions, not built-ins: each one is only a sentence the composer parses,
// so what you get is exactly what the box says it understood.
const TEMPLATES: ScheduleTemplate[] = [
  {
    emoji: "🌅",
    name: "Daily brief",
    description: "Every day at 8am, brief me on what changed across my gardens since yesterday",
  },
  {
    emoji: "🗂️",
    name: "Week in review",
    description: "Every Friday at 5pm, summarize what I worked on this week and what is still unfinished",
  },
  {
    emoji: "📖",
    name: "Weekend long read",
    description: "Every Saturday at 10am, find me an exceptional recent long read about the topics in my gardens",
  },
  {
    emoji: "🔎",
    name: "Research watch",
    description: "Every Monday at 9am, check for new work on the topics I have been reading about and summarize what is new",
  },
  {
    emoji: "🧪",
    name: "Exam prep",
    description: "Every weekday at 7pm, quiz me on the weakest topic across my gardens",
  },
  {
    emoji: "🌱",
    name: "Garden tidy",
    description: "Every month, point out notes with broken links, missing sources, or no connections",
  },
];

const SCHEDULE_RUNTIME_AGENT_IDS = [
  "agent-tars",
  "agent-browser",
  "agent-reach",
  "career-ops",
  "deep-research",
  "openplanter",
  "socials-manager",
  "hardware-blueprint",
  "parametric-cad",
  "hyperframes",
  "openmontage",
  "openwork",
  "deer-flow",
  "vimax",
  "money-printer",
  "legal",
  "opencode",
  "codex",
  "ruflo",
];

export default function TerminalScheduledPanel({ surface, gardenSlug = null }: Props) {
  const [schedules, setSchedules] = useState<ScheduledChatJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [text, setText] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  // The token under the caret, which is what the menu filters on.
  const [slashQuery, setSlashQuery] = useState("");
  const [title, setTitle] = useState("");

  // Cadence controls, used only while the advanced panel is open.
  const [cadence, setCadence] = useState<ScheduleCadence>("daily");
  const [time, setTime] = useState("09:00");
  const [weekday, setWeekday] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [custom, setCustom] = useState("0 9 * * *");

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const paletteRef = useRef<CommandHubHandle>(null);
  const slashMenuRef = useRef<SlashCommandMenuHandle>(null);
  const promptSlugRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/schedules", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        schedules?: ScheduledChatJob[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Schedules could not be loaded.");
      setSchedules(payload.schedules ?? []);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Schedules could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const listener = () => void load();
    window.addEventListener(SCHEDULES_CHANGED_EVENT, listener);
    return () => window.removeEventListener(SCHEDULES_CHANGED_EVENT, listener);
  }, [load]);

  const parsed = useMemo(() => parseScheduleRequest(text), [text]);
  const manualCron = useMemo(
    () => cronFromCadence({ cadence, time, weekday, dayOfMonth, custom }),
    [cadence, time, weekday, dayOfMonth, custom],
  );
  const cron = advancedOpen ? manualCron : parsed.cron;
  const cronValid = isValidCronExpression(cron);
  const preview = cronValid
    ? `${describeCronExpression(cron)} · first run ${formatRunTime(nextCronOccurrence(cron).toISOString())}`
    : "That cron expression is not valid.";

  /**
   * Drops a capability token into the sentence at the caret. A lone "/" means
   * the box itself opened the palette, so the token replaces it rather than
   * being appended to it.
   */
  function insertToken(command: string) {
    const node = inputRef.current;
    const token = `${command} `;
    const replaced = slashQueryReplacementRange(text, node?.selectionStart);
    const start = replaced ? replaced.start : node?.selectionStart ?? text.length;
    const end = replaced ? replaced.end : node?.selectionEnd ?? start;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const spacer = before && !/\s$/.test(before) ? " " : "";
    setText(`${before}${spacer}${token}${after}`);
    const cursor = before.length + spacer.length + token.length;
    window.setTimeout(() => {
      node?.focus();
      node?.setSelectionRange(cursor, cursor);
    }, 0);
  }

  function insertCapability(item: CommandHubItem) {
    if (item.kind === "prompt") {
      // Keep the schedule pointed at the prompt it was built from, and borrow
      // its name unless one was typed.
      promptSlugRef.current = item.slug ?? null;
      if (!title.trim()) setTitle(item.name);
    }
    const token = `/${item.token ?? item.slug ?? item.name}`;
    // A coding skill only means something behind a coding runtime, exactly as
    // it does in the chat composer.
    insertToken(item.requiresOpenCode ? `${OPENCODE_COMMAND} ${token}` : token);
  }

  async function create() {
    const prompt = (advancedOpen ? text.trim() : parsed.prompt).trim();
    if (!prompt || !cronValid || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || parsed.title,
          prompt,
          cron,
          surface,
          gardenSlug,
          promptSlug: promptSlugRef.current,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "This schedule could not be saved.");
      notifySchedulesChanged();
      await load();
      setText("");
      setTitle("");
      promptSlugRef.current = null;
      setAdvancedOpen(false);
      setMessage("Scheduled. Each run opens its own chat.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "This schedule could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function patch(job: ScheduledChatJob, body: Record<string, unknown>, note: string) {
    setMessage(null);
    try {
      const response = await fetch(`/api/schedules/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("This schedule could not be updated.");
      notifySchedulesChanged();
      await load();
      setMessage(note);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "This schedule could not be updated.");
    }
  }

  async function runNow(job: ScheduledChatJob) {
    setMessage(null);
    try {
      const response = await fetch(`/api/schedules/${job.id}/run`, { method: "POST" });
      if (!response.ok) throw new Error("This schedule could not be run.");
      notifySchedulesChanged();
      await load();
      setMessage(`"${job.title}" is running now in its own chat.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "This schedule could not be run.");
    }
  }

  async function remove(job: ScheduledChatJob) {
    if (!window.confirm(`Delete the schedule "${job.title}"? Chats it already opened are kept.`)) {
      return;
    }
    setMessage(null);
    try {
      const response = await fetch(`/api/schedules/${job.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("This schedule could not be deleted.");
      notifySchedulesChanged();
      await load();
      setMessage("Schedule deleted.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "This schedule could not be deleted.");
    }
  }

  const scoped = gardenSlug
    ? schedules.filter(
        (job) => job.surface === "garden_chat" && job.gardenSlug === gardenSlug,
      )
    : schedules;
  const visible = showActiveOnly ? scoped.filter((job) => job.enabled) : scoped;

  return (
    // The same paper surface the artifacts archive uses: these panels share one
    // slot beside the transcript and should read as one place.
    <section
      aria-label="Scheduled chats"
      className="flex h-full min-h-0 flex-col bg-[var(--paper-surface)] text-[var(--ink)]"
    >
      {/* The composer stays put and only the list below it scrolls, so the
          capability palette can open over the list instead of being clipped by
          a scroll container. */}
      <div className="shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-[var(--ink-heading)]">Scheduled</h2>
          <button
            type="button"
            onClick={() => setShowActiveOnly((value) => !value)}
            aria-pressed={showActiveOnly}
            className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
              showActiveOnly
                ? "border-[var(--botanical)] text-[var(--botanical)]"
                : "border-[var(--line)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16l-6.2 7.3v5.2L10.2 20v-7.7L4 5Z" />
            </svg>
            {showActiveOnly ? "Active" : "All"}
          </button>
        </div>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          Ask for a task, a reminder, or something to watch. Each run opens a new chat in{" "}
          {scheduleTargetLabel({ surface, gardenSlug })} and sends the prompt as its first message.
        </p>

        <div className="neu-inset relative mt-3 rounded-2xl border px-3 py-2">
          <SlashCommandMenu
            ref={slashMenuRef}
            open={slashMenuOpen}
            query={slashQuery}
            surface={surface}
            availableRuntimeAgentIds={SCHEDULE_RUNTIME_AGENT_IDS}
            placement="below"
            onClose={() => setSlashMenuOpen(false)}
            onSelect={(item) => {
              setSlashMenuOpen(false);
              insertCapability(item);
            }}
          />
          <div className="flex items-start gap-1.5">
            <CommandHub
              ref={paletteRef}
              open={paletteOpen}
              onOpenChange={(nextOpen) => {
                setPaletteOpen(nextOpen);
                if (nextOpen) setSlashMenuOpen(false);
              }}
              onSelect={insertCapability}
              onSelectBrowserAgent={() => insertToken(AGENT_TARS_SLASH_COMMAND)}
              onSelectAgentBrowser={() => insertToken(AGENT_BROWSER_SLASH_COMMAND)}
              onSelectAgentReach={() => insertToken(AGENT_REACH_COMMAND)}
              onSelectCareerOps={() => insertToken(CAREER_OPS_COMMAND)}
              onSelectDeepResearch={() => insertToken(DEEP_RESEARCH_SLASH_COMMAND)}
              onSelectOpenPlanter={() => insertToken(OPENPLANTER_COMMAND)}
              onSelectSocialsManager={() => insertToken(SOCIALS_MANAGER_COMMAND)}
              onSelectHardwareBlueprint={() => insertToken(HARDWARE_BLUEPRINT_COMMAND)}
              onSelectParametricCad={() => insertToken(PARAMETRIC_CAD_COMMAND)}
              onSelectHyperframes={() => insertToken(HYPERFRAMES_COMMAND)}
              onSelectOpenMontage={() => insertToken(OPENMONTAGE_COMMAND)}
              onSelectOpenwork={() => insertToken(OPENWORK_COMMAND)}
              onSelectDeerFlow={() => insertToken(DEER_FLOW_COMMAND)}
              onSelectVimax={() => insertToken(VIMAX_COMMAND)}
              onSelectMoneyPrinter={() => insertToken(MONEY_PRINTER_COMMAND)}
              onSelectLegal={() => insertToken(LEGAL_COMMAND)}
              onSelectOpenCode={() => insertToken(OPENCODE_COMMAND)}
              onSelectCodex={() => insertToken(CODEX_COMMAND)}
              onSelectRuflo={() => insertToken(RUFLO_COMMAND)}
              compact
              placement="below"
              surface={surface}
              gardenSlug={gardenSlug}
              requestedOutcome={text}
            />
            <button
              type="button"
              onClick={() => setAdvancedOpen((value) => !value)}
              aria-expanded={advancedOpen}
              aria-label={advancedOpen ? "Hide cadence controls" : "Set the cadence by hand"}
              title={advancedOpen ? "Hide cadence controls" : "Set the cadence by hand"}
              className="mt-2 shrink-0 rounded-full p-1 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink)]"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                <circle cx="12" cy="12" r="8.5" />
                <path strokeLinecap="round" d="M12 8.5v7M8.5 12h7" />
              </svg>
            </button>
            <textarea
              ref={inputRef}
              value={text}
              rows={1}
              onChange={(event) => {
                const next = event.target.value;
                setText(next);
                // Typing in a leading slash token filters ready commands without
                // opening the full capability manager — including the token of a
                // sentence that already has a body, so an existing capability can
                // be swapped. Backspacing to "/" stays quiet.
                const { inputType } = event.nativeEvent as Partial<InputEvent>;
                const slashQuery = slashQueryAt(next, event.target.selectionStart);
                if (slashQuery && (slashMenuOpen || !inputType?.startsWith("delete"))) {
                  setSlashQuery(slashQuery.query);
                  setSlashMenuOpen(true);
                  setPaletteOpen(false);
                } else if (slashMenuOpen) {
                  setSlashMenuOpen(false);
                }
              }}
              onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                if (slashMenuRef.current?.handleKeyDown(event)) return;
                if (paletteRef.current?.handleKeyDown(event)) return;
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void create();
                }
              }}
              placeholder="Schedule a task"
              aria-label="Schedule a task"
              className="mt-2 max-h-32 w-full resize-none bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
            />
            <button
              type="button"
              onClick={() => void create()}
              disabled={saving || !text.trim() || !cronValid}
              aria-label="Create this schedule"
              className="neu-button-accent mt-1.5 shrink-0 rounded-full bg-[var(--botanical)] p-1.5 text-white transition disabled:opacity-40"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0-6 6m6-6 6 6" />
              </svg>
            </button>
          </div>

          {text.trim() ? (
            <p className="mt-1.5 border-t border-[var(--line)] pt-1.5 text-[11px] text-[var(--ink-muted)]">
              {advancedOpen ? "Cadence" : parsed.recognized ? "Understood" : "Assuming"}:{" "}
              <span className="font-medium text-[var(--ink)]">{preview}</span>
              {!advancedOpen ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen(true)}
                    className="font-medium text-[var(--botanical)] underline-offset-2 hover:underline"
                  >
                    change
                  </button>
                </>
              ) : null}
            </p>
          ) : null}

          {advancedOpen ? (
            <div className="mt-2 border-t border-[var(--line)] pt-2">
              <label className="block text-xs font-medium">
                Name
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={parsed.title}
                  className="neu-control mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm outline-none focus:border-[var(--botanical)]"
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SCHEDULE_CADENCES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={cadence === item.id}
                    onClick={() => setCadence(item.id)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      cadence === item.id
                        ? "border-[var(--botanical)] bg-[var(--botanical)] font-medium text-white"
                        : "border-[var(--line)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {cadence === "custom" ? (
                  <label className="col-span-2 block text-xs font-medium">
                    Cron expression
                    <input
                      value={custom}
                      onChange={(event) => setCustom(event.target.value)}
                      placeholder="0 9 * * 1-5"
                      className="neu-control mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--botanical)]"
                    />
                  </label>
                ) : (
                  <label className="block text-xs font-medium">
                    {cadence === "hourly" ? "Minute past the hour" : "Time"}
                    <input
                      type="time"
                      value={time}
                      onChange={(event) => setTime(event.target.value)}
                      className="neu-control mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm outline-none focus:border-[var(--botanical)]"
                    />
                  </label>
                )}
                {cadence === "weekly" ? (
                  <label className="block text-xs font-medium">
                    Day
                    <select
                      value={weekday}
                      onChange={(event) => setWeekday(Number(event.target.value))}
                      className="neu-control mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm outline-none focus:border-[var(--botanical)]"
                    >
                      {WEEKDAY_LABELS.map((label, index) => (
                        <option key={label} value={index}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {cadence === "monthly" ? (
                  <label className="block text-xs font-medium">
                    Day of month
                    <input
                      type="number"
                      min={1}
                      max={28}
                      value={dayOfMonth}
                      onChange={(event) => setDayOfMonth(Number(event.target.value))}
                      className="neu-control mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm outline-none focus:border-[var(--botanical)]"
                    />
                  </label>
                ) : null}
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--ink-muted)]">
                Runs use this computer&apos;s clock and only fire while Breadboard is running. A prompt
                that would need a permission decision is recorded as failed instead of waiting.
              </p>
            </div>
          ) : null}
        </div>

        {message ? (
          <p role="status" className="mt-2 text-xs text-[#8a6f00]">
            {message}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <ul className="space-y-0.5">
          {TEMPLATES.map((template) => (
            <li key={template.name}>
              <button
                type="button"
                onClick={() => {
                  setText(template.description);
                  setTitle(template.name);
                  promptSlugRef.current = null;
                  inputRef.current?.focus();
                }}
                className="flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-[var(--paper-strong)]"
              >
                <span className="mt-0.5 shrink-0 text-[var(--ink-muted)]">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                    <circle cx="12" cy="12" r="8.5" />
                    <path strokeLinecap="round" d="M12 8.5v7M8.5 12h7" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-[var(--ink-heading)]">
                    {template.emoji} {template.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">
                    {template.description}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-[var(--line)] pt-3">
          <h3 className="text-xs font-semibold text-[var(--ink-muted)]">
            {showActiveOnly ? "Active schedules" : "All schedules"}
          </h3>
          {loading && scoped.length === 0 ? (
            <p className="mt-4 text-center text-xs text-[var(--ink-muted)]">Loading schedules…</p>
          ) : visible.length === 0 ? (
            <p className="mt-4 text-center text-xs text-[var(--ink-muted)]">
              {scoped.length === 0 ? "Nothing is scheduled yet." : "Nothing is active right now."}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {visible.map((job) => (
                <li key={job.id} className="neu-surface-subtle rounded-xl border p-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--ink-heading)]">{job.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-[var(--ink-muted)]">{job.prompt}</p>
                      <p className="mt-2 text-[10px] text-[var(--ink-muted)]">
                        {job.cronDescription} · {scheduleTargetLabel(job)}
                      </p>
                      <p className="mt-1 text-[10px] text-[var(--ink-muted)]">
                        {job.enabled
                          ? `Next ${formatRunTime(job.nextRunAt)} (${formatRelativeRunTime(job.nextRunAt)})`
                          : "Paused"}
                        {job.lastRunAt
                          ? ` · Last ${job.lastStatus === "failed" ? "failed" : "ran"} ${formatRunTime(job.lastRunAt)}`
                          : ""}
                      </p>
                      {job.lastStatus === "failed" && job.lastError ? (
                        <p className="mt-1 text-[10px] text-[#9a4438]">{job.lastError}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={() => void runNow(job)}
                        className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)]"
                      >
                        Run now
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void patch(
                            job,
                            { enabled: !job.enabled },
                            job.enabled ? "Schedule paused." : "Schedule resumed.",
                          )
                        }
                        className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)]"
                      >
                        {job.enabled ? "Pause" : "Resume"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(job)}
                        className="rounded-lg px-2 py-1 text-xs text-[#9a4438]"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
