import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  cronFromCadence,
  formatRelativeRunTime,
  schedulableSurface,
} from "../src/app/components/hermes/schedule-client.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const commandHub = source("../src/app/components/hermes/command-hub.tsx");
const scheduledPanel = source("../src/app/components/hermes/terminal-scheduled-panel.tsx");
const gardenChat = source("../src/app/components/hermes/garden-agent-chat.tsx");
const dock = source("../src/app/components/scheduled-chats-dock.tsx");
const dashboard = source("../src/app/dashboard/dashboard-client.tsx");
const runner = source("../src/lib/schedules/runner.ts");
const scheduler = source("../src/lib/schedules/scheduler.ts");
const backgroundExecutor = source("../scripts/runtime-v2-background-executor.mjs");
const eventStream = source("../src/lib/hermes/event-stream.ts");

test("the Prompts palette no longer schedules anything", () => {
  // Scheduling is a place of its own; the palette only produces text.
  assert.doesNotMatch(
    commandHub,
    /openSchedule|schedulePromptItem|SchedulePanel|schedulableSurface|scheduleSurface/,
  );
  assert.doesNotMatch(commandHub, /"schedule-prompt"/);
});

test("the Scheduled panel composes with the same capability palette the chat has", () => {
  assert.match(scheduledPanel, /<CommandHub[\s\S]{0,600}onSelect=\{insertCapability\}/);
  // It opens downward: the composer sits at the top of a narrow rail.
  assert.match(scheduledPanel, /placement="below"/);
  // Choosing a capability inserts its token; choosing a prompt also links the
  // schedule to that prompt.
  assert.match(scheduledPanel, /const token = `\/\$\{item\.token \?\? item\.slug \?\? item\.name\}`/);
  assert.match(scheduledPanel, /promptSlugRef\.current = item\.slug \?\? null/);
  // A coding skill carries its runtime with it, as it does in the composer.
  assert.match(scheduledPanel, /item\.requiresOpenCode \? `\$\{OPENCODE_COMMAND\} \$\{token\}` : token/);
  // Typing "/" offers only ready slash commands; the button still owns the
  // complete capability manager.
  assert.match(scheduledPanel, /<SlashCommandMenu/);
  assert.match(scheduledPanel, /setSlashMenuOpen\(true\)[\s\S]{0,100}setPaletteOpen\(false\)/);
  assert.doesNotMatch(scheduledPanel, /next === "\/"[\s\S]{0,100}setPaletteOpen\(true\)/);
});

test("the palette can be anchored above or below its trigger", () => {
  assert.match(commandHub, /placement\?: "above" \| "below"/);
  assert.match(commandHub, /placement === "below"[\s\S]{0,200}sm:top-full/);
  assert.match(commandHub, /sm:bottom-full sm:left-0 sm:mb-3/);
});

test("garden chat keeps a place to schedule, since it has no side rail", () => {
  assert.match(gardenChat, /<TerminalScheduledPanel surface="garden_chat" gardenSlug=\{gardenSlug\} \/>/);
  assert.match(gardenChat, /toggleView\("scheduled"\)/);
});

test("only surfaces that own a chat history can schedule", () => {
  assert.equal(schedulableSurface("dashboard_terminal"), "dashboard_terminal");
  assert.equal(schedulableSurface("garden_chat", "physics"), "garden_chat");
  // A garden chat with no garden, and the Quartz page assistant, cannot.
  assert.equal(schedulableSurface("garden_chat", null), null);
  assert.equal(schedulableSurface("quartz_ai", "physics"), null);
});

test("cadence choices produce the cron expression they promise", () => {
  const base = { time: "09:30", weekday: 1, dayOfMonth: 1, custom: "" };
  assert.equal(cronFromCadence({ ...base, cadence: "daily" }), "30 9 * * *");
  assert.equal(cronFromCadence({ ...base, cadence: "weekdays" }), "30 9 * * 1-5");
  assert.equal(cronFromCadence({ ...base, cadence: "weekly", weekday: 3 }), "30 9 * * 3");
  assert.equal(cronFromCadence({ ...base, cadence: "monthly", dayOfMonth: 5 }), "30 9 5 * *");
  assert.equal(cronFromCadence({ ...base, cadence: "hourly" }), "30 * * * *");
  assert.equal(
    cronFromCadence({ ...base, cadence: "custom", custom: " 0 6 * * 0 " }),
    "0 6 * * 0",
  );
  // Day-of-month is clamped into a range every month actually has.
  assert.equal(cronFromCadence({ ...base, cadence: "monthly", dayOfMonth: 31 }), "30 9 28 * *");
});

test("countdowns stay readable at every distance", () => {
  const now = Date.parse("2026-07-30T09:00:00Z");
  const iso = (ms) => new Date(now + ms).toISOString();
  assert.equal(formatRelativeRunTime(null), "Paused");
  assert.equal(formatRelativeRunTime(iso(-60_000), now), "due now");
  assert.equal(formatRelativeRunTime(iso(4 * 60_000), now), "in 4 min");
  assert.equal(formatRelativeRunTime(iso(3 * 3_600_000), now), "in 3 h");
  assert.equal(formatRelativeRunTime(iso(24 * 3_600_000), now), "tomorrow");
  assert.equal(formatRelativeRunTime(iso(3 * 24 * 3_600_000), now), "in 3 days");
});

test("the schedule form states where the chat will open and never guesses", () => {
  assert.match(scheduledPanel, /Each run opens a new chat in/);
  assert.match(scheduledPanel, /scheduleTargetLabel\(\{ surface, gardenSlug \}\)/);
  // The target comes from the surface the panel belongs to — there is no picker.
  assert.doesNotMatch(scheduledPanel, /setSurface|<select[^>]*surface/);
});

test("the dashboard keeps a persistent top-left dialogue while anything is scheduled", () => {
  assert.match(dashboard, /<ScheduledChatsDock \/>/);
  assert.match(dock, /fixed left-4 top-20/);
  assert.match(dock, /if \(schedules\.length === 0\) return null;/);
  // It must say what will happen, where, and when.
  assert.match(dock, /scheduled chat\{schedules\.length === 1 \? "" : "s"\}/);
  assert.match(dock, /New chat in \{scheduleTargetLabel\(job\)\}/);
  assert.match(dock, /formatRunTime\(job\.nextRunAt\)/);
  assert.match(dock, /Last run failed/);
});

test("a scheduled run goes through the same authenticated turn pipeline as a person", () => {
  assert.match(runner, /createConversation\(/);
  assert.match(runner, /startConversationTurn\(/);
  // Re-authorize at run time: a garden can be deleted or unshared after scheduling.
  assert.match(runner, /authorizeGardenAccess\(job\.user_id, gardenSlug\)/);
  // The pump must be attached before dispatch, exactly like the browser does.
  assert.ok(
    runner.indexOf("startSessionEventPump") < runner.indexOf("startConversationTurn("),
    "the event pump must be started before the turn is dispatched",
  );
  // An unattended run must never sit waiting on a permission prompt.
  assert.match(runner, /"blocked" in result/);
});

test("the pump can run without a browser attached, and the SSE route still uses it", () => {
  assert.match(eventStream, /export function startSessionEventPump/);
  assert.match(eventStream, /`hermes:\$\{session\.row\.id\}`/);
  assert.match(eventStream, /return pump\.response\(signal, extraHeaders\)/);
});

test("the scheduler tick is a native-owned finite worker operation", () => {
  assert.match(backgroundExecutor, /case "scheduled-chats"/);
  assert.match(backgroundExecutor, /await runDueScheduledChats\(\)/);
  assert.match(backgroundExecutor, /await drainDetachedPumps\(sourceRoot\)/);
  assert.doesNotMatch(scheduler, /setInterval|setTimeout|__breadboardChatScheduler/);
  assert.match(scheduler, /store\.claimDue\(now\)/);
  assert.match(scheduler, /store\.recordRun\(/);
});
