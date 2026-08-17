import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  currentLearnElapsedMs,
  learnTimerRunsForStatus,
  transitionLearnTimer,
} from "../src/lib/learn-timer.ts";
import { LEARN_STATUSES } from "../src/lib/learn-utils.ts";

const learnSource = fs.readFileSync(
  new URL("../src/lib/learn.ts", import.meta.url),
  "utf8",
);
const workspaceSource = fs.readFileSync(
  new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
  "utf8",
);

/** Body of a top-level `function name(` / `async function name(` declaration. */
function namedFunction(name) {
  const start = learnSource.search(
    new RegExp(`(?:export )?(?:async )?function ${name}\\(`),
  );
  assert.ok(start >= 0, `${name} must exist in learn.ts`);

  // Skip the parameter list, which may itself be a destructured object.
  let index = learnSource.indexOf("(", start);
  let parenDepth = 0;
  for (; index < learnSource.length; index += 1) {
    if (learnSource[index] === "(") parenDepth += 1;
    if (learnSource[index] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) break;
    }
  }

  // The body brace is the one that ends its line; braces inside a return type
  // such as `Promise<{ recoveredJobIds: string[] }>` are always inline.
  let bodyStart = -1;
  for (; index < learnSource.length; index += 1) {
    if (learnSource[index] !== "{") continue;
    if (/^[^\S\n]*\r?\n/.test(learnSource.slice(index + 1, index + 8))) {
      bodyStart = index;
      break;
    }
  }
  assert.ok(bodyStart > 0, `${name} must have a block body`);

  let depth = 0;
  for (let cursor = bodyStart; cursor < learnSource.length; cursor += 1) {
    const character = learnSource[cursor];
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return learnSource.slice(start, cursor + 1);
    }
  }
  throw new Error(`${name} is unbalanced`);
}

test("paused is a Learn status whose stopwatch is stopped", () => {
  assert.ok(LEARN_STATUSES.includes("paused"));
  assert.equal(learnTimerRunsForStatus("paused"), false);

  const generating = { elapsedMs: 0, startedAt: "2026-08-16T10:00:00.000Z" };
  const paused = transitionLearnTimer(
    generating,
    "paused",
    "2026-08-16T10:03:00.000Z",
  );
  assert.deepEqual(paused, { elapsedMs: 180_000 });
  // A pause that lasts an hour must not add an hour to the run's elapsed time.
  assert.equal(
    currentLearnElapsedMs(paused, Date.parse("2026-08-16T11:03:00.000Z")),
    180_000,
  );

  const resumed = transitionLearnTimer(
    paused,
    "generating_learning_pages",
    "2026-08-16T11:03:00.000Z",
  );
  assert.deepEqual(resumed, {
    elapsedMs: 180_000,
    startedAt: "2026-08-16T11:03:00.000Z",
  });
});

test("the pause gate holds the worker instead of unwinding it, and Cancel still wins", () => {
  const gate = namedFunction("awaitLearnPauseGate");
  // Holding, not throwing, is the whole difference from Cancel: the run keeps
  // every local variable it had at the checkpoint.
  assert.match(gate, /jobStatusById\(jobId\) !== "paused"\) return/);
  assert.match(gate, /await new Promise\(\(resolve\) => setTimeout\(/);
  // Cancel must remain effective while parked.
  assert.match(gate, /throwIfLearnCancelled\(jobId\)/);
  // An unresumed pause cannot hold the worker, its lease, and its HTTP task
  // open forever.
  assert.match(gate, /LEARN_MAX_PAUSE_MS[\s\S]*?status: "cancelled"/);

  const checkpoint = namedFunction("learnCheckpoint");
  assert.match(checkpoint, /throwIfLearnCancelled\(jobId\)/);
  assert.match(checkpoint, /await awaitLearnPauseGate\(jobId\)/);
});

test("pause preserves the run; only Cancel rolls it back", () => {
  const pause = namedFunction("pauseLatestLearnJob");
  assert.doesNotMatch(pause, /cleanupLearnArtifactsAfterCancel|rollbackLearnRun/);
  assert.doesNotMatch(pause, /progressPercent: 0/);
  assert.match(pause, /status: "paused"[\s\S]*?pausedFromStatus: latest\.status/);
  // Repair and publication run as single atomic steps with no awaitable
  // checkpoint, so they are refused rather than silently ignored.
  assert.match(pause, /LEARN_PAUSABLE_STATUSES\.includes\(latest\.status\)/);

  const pausableStart = learnSource.indexOf("const LEARN_PAUSABLE_STATUSES");
  assert.ok(pausableStart > 0);
  // `];` and not `]`, which would stop inside the `readonly LearnStatus[]` type.
  const pausable = learnSource.slice(
    pausableStart,
    learnSource.indexOf("];", pausableStart),
  );
  for (const status of [
    "analyzing_issues",
    "repairing",
    "revalidating",
    "publishing_repair",
    "writing_quartz",
  ]) {
    assert.doesNotMatch(pausable, new RegExp(`"${status}"`));
  }
  assert.match(pausable, /"planning"/);
  assert.match(pausable, /"generating_learning_pages"/);
});

test("resume returns the run to the phase it paused in", () => {
  const resume = namedFunction("resumeLatestLearnJob");
  assert.match(resume, /latest\.status !== "paused"/);
  assert.match(resume, /const resumeStatus = latest\.pausedFromStatus/);
  assert.match(resume, /status: resumeStatus/);

  // Any exit from "paused" — Resume, Cancel, or a worker that raced past the
  // gate — must drop the recorded phase so a later pause cannot resume stale.
  const update = namedFunction("updateLearnJob");
  assert.match(
    update,
    /pausedFromStatus:\s*\n?\s*nextStatus === "paused"[\s\S]*?:\s*undefined/,
  );
  assert.match(update, /paused_from_status = \?/);
});

test("a paused job holds the garden and stays recoverable if its worker dies", () => {
  // activeStatus gates the 15s heartbeat, the second-run guards, and Cancel's
  // own eligibility check, so a paused job must count as active.
  assert.match(namedFunction("activeStatus"), /"paused"/);
  assert.match(
    namedFunction("recoverAbandonedLearnJobs"),
    /'building_navigation',[\s\S]{0,200}'paused'/,
  );
});

test("pause lands between whole pages, never mid-page", () => {
  const generationStart = learnSource.indexOf("async function runTextbookGeneration");
  const generation = learnSource.slice(generationStart);
  const subsectionLoop = generation.indexOf(
    "for (let subsectionIndex = 0;",
  );
  assert.ok(subsectionLoop >= 0);
  const loopHead = generation.slice(subsectionLoop, subsectionLoop + 400);
  assert.match(loopHead, /await learnCheckpoint\(job\.id\)/);
});

test("the Learn panel offers Pause and Resume alongside Cancel", () => {
  assert.match(workspaceSource, /function isLearnPausable\(status\?: LearnStatus\)/);
  // A paused run is still "active": Cancel stays available and nothing new starts.
  assert.match(
    workspaceSource,
    /function isLearnActive\([\s\S]*?status === "paused"/,
  );
  assert.match(
    workspaceSource,
    /onClick=\{paused \? handleResumeLearn : handlePauseLearn\}/,
  );
  assert.match(workspaceSource, /postLearnAction\("pause", \{ expectedJobId/);
  assert.match(workspaceSource, /postLearnAction\("resume", \{ expectedJobId/);
  assert.match(workspaceSource, /const learnTimerPaused =[\s\S]{0,80}paused/);
});
