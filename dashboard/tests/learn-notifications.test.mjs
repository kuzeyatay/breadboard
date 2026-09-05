import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

import {
  chatNotificationHref,
  chatNotificationTargetKey,
  isChatNotificationRecord,
  isChatNotificationTarget,
  LEARN_NOTIFICATION_ANY_JOB,
} from "../src/lib/chat-notification-inbox.ts";
import {
  dismissLearnNotifications,
  dismissLearnNotificationsForGarden,
  ensureLearnNotificationBaseline,
  ensureLearnNotificationSchema,
  learnNotificationMessage,
  learnNotificationPhaseForStatus,
  listPendingLearnNotifications,
  parseLearnNotificationId,
} from "../src/lib/chat-notifications/learn.ts";
import {
  LEARN_ACTIVE_STAGE_LABELS,
  LEARN_STAGE_LABELS,
} from "../src/lib/learn-stage-labels.ts";
import { LEARN_STATUSES } from "../src/lib/learn-utils.ts";

const source = (relative) =>
  fs.readFileSync(new URL(relative, import.meta.url), "utf8");

const T0 = "2026-09-03T09:00:00.000Z";
const T1 = "2026-09-03T09:05:00.000Z";
const T2 = "2026-09-03T09:10:00.000Z";
const T3 = "2026-09-03T09:15:00.000Z";

function learnDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE clusters (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE
    );
    CREATE TABLE learn_jobs (
      id TEXT PRIMARY KEY,
      garden_id TEXT NOT NULL,
      user_id INTEGER,
      model TEXT NOT NULL DEFAULT 'model',
      status TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'full',
      current_step TEXT,
      progress_percent INTEGER NOT NULL DEFAULT 0,
      current_section_title TEXT,
      current_page_title TEXT,
      error TEXT,
      paused_from_status TEXT,
      active_elapsed_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO users (id) VALUES (1), (2);
    INSERT INTO clusters (id, user_id, name, slug) VALUES
      (5, 1, 'EM1 – Electromagnetism', 'electromagnetism-1'),
      (6, 1, 'Signals', 'signals'),
      (7, 2, 'Someone else', 'someone-else');
  `);
  ensureLearnNotificationSchema(db);
  return db;
}

function putJob(db, job) {
  db.prepare(`
    INSERT INTO learn_jobs
      (id, garden_id, status, current_step, progress_percent, current_section_title,
       current_page_title, error, paused_from_status, created_at, updated_at)
    VALUES (@id, @garden, @status, @step, @progress, @section, @page, @error, @pausedFrom,
            @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      current_step = excluded.current_step,
      progress_percent = excluded.progress_percent,
      current_section_title = excluded.current_section_title,
      current_page_title = excluded.current_page_title,
      error = excluded.error,
      paused_from_status = excluded.paused_from_status,
      updated_at = excluded.updated_at
  `).run({
    step: null,
    progress: 0,
    section: null,
    page: null,
    error: null,
    pausedFrom: null,
    createdAt: job.updatedAt,
    ...job,
  });
}

test("every Learn status maps to a notice phase or is deliberately silent", () => {
  for (const status of LEARN_STATUSES) {
    const phase = learnNotificationPhaseForStatus(status);
    if (status === "idle") {
      assert.equal(phase, null, "idle rows are not news");
    } else {
      assert.ok(phase, `${status} has no notice phase`);
    }
  }
  assert.equal(learnNotificationPhaseForStatus("generating_visuals"), "active");
  assert.equal(learnNotificationPhaseForStatus("generating_textbook"), "active");
  assert.equal(learnNotificationPhaseForStatus("paused"), "paused");
  assert.equal(learnNotificationPhaseForStatus("bogus"), null);
});

test("the stage labels the panel shows are the labels the notices use", () => {
  const workspace = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");
  assert.match(workspace, /LEARN_ACTIVE_STAGE_LABELS/);
  assert.doesNotMatch(
    workspace,
    /planning: "Planning the Learning Map"/,
    "the panel must not keep a private copy of the stage wording",
  );
  for (const [status, label] of Object.entries(LEARN_ACTIVE_STAGE_LABELS)) {
    assert.equal(LEARN_STAGE_LABELS[status], label);
  }
  assert.equal(
    learnNotificationMessage(
      {
        status: "generating_learning_pages",
        current_step: null,
        progress_percent: 42.4,
        current_section_title: "Gauss's law",
        current_page_title: null,
        error: null,
        paused_from_status: null,
      },
      "active",
    ),
    "Writing lesson pages · 42% · Section: Gauss's law",
  );
  assert.equal(
    learnNotificationMessage(
      {
        status: "paused",
        current_step: null,
        progress_percent: 10,
        current_section_title: null,
        current_page_title: null,
        error: null,
        paused_from_status: "planning",
      },
      "paused",
    ),
    "Paused during: Planning the Learning Map.",
  );
  const long = "x".repeat(400);
  const failed = learnNotificationMessage(
    {
      status: "failed",
      current_step: null,
      progress_percent: 0,
      current_section_title: null,
      current_page_title: null,
      error: long,
      paused_from_status: null,
    },
    "failed",
  );
  assert.ok(failed.length <= 240);
  assert.match(failed, /…$/);
});

test("notice ids round-trip and reject anything that is not a job phase", () => {
  assert.deepEqual(parseLearnNotificationId("learn_job-1:active"), {
    jobId: "job-1",
    phase: "active",
  });
  assert.deepEqual(parseLearnNotificationId(" learn_abc:failed "), {
    jobId: "abc",
    phase: "failed",
  });
  assert.equal(parseLearnNotificationId("learn_abc:bogus"), null);
  assert.equal(parseLearnNotificationId("learn_abc"), null);
  assert.equal(parseLearnNotificationId("msg_12"), null);
  assert.equal(parseLearnNotificationId("learn_a b:active"), null);
});

test("the first read draws a line under runs that already finished", () => {
  const db = learnDatabase();
  putJob(db, { id: "old", garden: "electromagnetism-1", status: "complete", updatedAt: T0 });
  const baseline = ensureLearnNotificationBaseline(db, 1, () => T1);
  assert.equal(baseline, T1);
  assert.deepEqual(listPendingLearnNotifications(db, 1), []);

  putJob(db, { id: "new", garden: "electromagnetism-1", status: "complete", updatedAt: T2 });
  const [notice] = listPendingLearnNotifications(db, 1);
  assert.ok(notice);
  assert.equal(notice.id, "learn_new:complete");
  assert.equal(notice.kind, "learn");
  assert.equal(notice.title, "Learn complete");
  assert.equal(notice.type, "success");
  assert.equal(notice.chatTitle, "EM1 – Electromagnetism");
  assert.equal(notice.response, "");
  assert.deepEqual(notice.target, {
    surface: "garden_learn",
    gardenSlug: "electromagnetism-1",
    chatId: "new",
  });
  assert.ok(isChatNotificationRecord(notice), "the client validator must accept it");
});

test("a running job is one status notice whose message follows its progress", () => {
  const db = learnDatabase();
  ensureLearnNotificationBaseline(db, 1, () => T0);
  putJob(db, {
    id: "run",
    garden: "electromagnetism-1",
    status: "planning",
    progress: 5,
    updatedAt: T1,
  });
  let [notice] = listPendingLearnNotifications(db, 1);
  assert.equal(notice.id, "learn_run:active");
  assert.equal(notice.title, "Learn in progress");
  assert.equal(notice.progressPercent, 5);
  assert.equal(notice.message, "Planning the Learning Map · 5%");

  putJob(db, {
    id: "run",
    garden: "electromagnetism-1",
    status: "generating_learning_pages",
    step: "Writing lesson 3 of 8",
    progress: 40,
    page: "Faraday's law",
    updatedAt: T2,
  });
  [notice] = listPendingLearnNotifications(db, 1);
  assert.equal(notice.id, "learn_run:active", "same notice, not a second card");
  assert.equal(notice.progressPercent, 40);
  assert.equal(notice.message, "Writing lesson 3 of 8 · 40% · Page: Faraday's law");
  assert.equal(notice.updatedAt, T2);
});

test("dismissing the progress card does not silence the outcome that follows", () => {
  const db = learnDatabase();
  ensureLearnNotificationBaseline(db, 1, () => T0);
  putJob(db, { id: "run", garden: "electromagnetism-1", status: "planning", updatedAt: T1 });
  assert.equal(
    dismissLearnNotifications(db, 1, [{ jobId: "run", phase: "active" }]),
    1,
  );
  assert.deepEqual(listPendingLearnNotifications(db, 1), []);

  putJob(db, {
    id: "run",
    garden: "electromagnetism-1",
    status: "writing_quartz",
    progress: 90,
    updatedAt: T2,
  });
  assert.deepEqual(
    listPendingLearnNotifications(db, 1),
    [],
    "the active phase stays dismissed for the rest of the run",
  );

  putJob(db, {
    id: "run",
    garden: "electromagnetism-1",
    status: "failed",
    error: "Council rejected the coverage plan",
    updatedAt: T3,
  });
  const [failure] = listPendingLearnNotifications(db, 1);
  assert.equal(failure.id, "learn_run:failed");
  assert.equal(failure.type, "error");
  assert.equal(failure.message, "Council rejected the coverage plan");
  assert.equal(failure.progressPercent, undefined);

  assert.equal(dismissLearnNotifications(db, 1, [{ jobId: "run", phase: "failed" }]), 1);
  assert.deepEqual(listPendingLearnNotifications(db, 1), []);
  assert.equal(
    dismissLearnNotifications(db, 1, [{ jobId: "run", phase: "failed" }]),
    0,
    "a repeat dismissal is a no-op",
  );
});

test("only the newest run per Garden owns the live status card", () => {
  const db = learnDatabase();
  ensureLearnNotificationBaseline(db, 1, () => T0);
  putJob(db, { id: "stale", garden: "electromagnetism-1", status: "planning", updatedAt: T1 });
  putJob(db, { id: "fresh", garden: "electromagnetism-1", status: "generating_visuals", updatedAt: T2 });
  putJob(db, { id: "other", garden: "signals", status: "building_navigation", updatedAt: T2 });
  const ids = listPendingLearnNotifications(db, 1).map((notice) => notice.id);
  assert.deepEqual(ids.sort(), ["learn_fresh:active", "learn_other:active"]);
});

test("paused and awaiting-review runs are announced as parked, not running", () => {
  const db = learnDatabase();
  ensureLearnNotificationBaseline(db, 1, () => T0);
  putJob(db, {
    id: "p",
    garden: "electromagnetism-1",
    status: "paused",
    pausedFrom: "generating_learning_pages",
    updatedAt: T1,
  });
  putJob(db, { id: "r", garden: "signals", status: "awaiting_confirmation", updatedAt: T2 });
  const notices = listPendingLearnNotifications(db, 1);
  assert.deepEqual(
    notices.map((notice) => [notice.id, notice.title, notice.message]),
    [
      ["learn_p:paused", "Learn paused", "Paused during: Writing lesson pages."],
      ["learn_r:awaiting_confirmation", "Learn awaiting review", "The Learning Map is ready for review."],
    ],
  );
  assert.ok(notices.every((notice) => notice.progressPercent === undefined));
});

test("Gardens belonging to another account never leak into the inbox", () => {
  const db = learnDatabase();
  ensureLearnNotificationBaseline(db, 1, () => T0);
  ensureLearnNotificationBaseline(db, 2, () => T0);
  putJob(db, { id: "theirs", garden: "someone-else", status: "complete", updatedAt: T1 });
  putJob(db, { id: "mine", garden: "signals", status: "complete", updatedAt: T1 });
  assert.deepEqual(
    listPendingLearnNotifications(db, 1).map((notice) => notice.id),
    ["learn_mine:complete"],
  );
  assert.deepEqual(
    listPendingLearnNotifications(db, 2).map((notice) => notice.id),
    ["learn_theirs:complete"],
  );
  assert.equal(
    dismissLearnNotifications(db, 1, [{ jobId: "theirs", phase: "complete" }]),
    0,
    "dismissing someone else's job changes nothing",
  );
  assert.equal(listPendingLearnNotifications(db, 2).length, 1);
});

test("looking at a Garden's Learn panel retires every notice for that Garden only", () => {
  const db = learnDatabase();
  ensureLearnNotificationBaseline(db, 1, () => T0);
  putJob(db, { id: "a", garden: "electromagnetism-1", status: "complete", updatedAt: T1 });
  putJob(db, { id: "b", garden: "electromagnetism-1", status: "generating_visuals", updatedAt: T2 });
  putJob(db, { id: "c", garden: "signals", status: "failed", updatedAt: T2 });
  assert.equal(listPendingLearnNotifications(db, 1).length, 3);
  assert.equal(dismissLearnNotificationsForGarden(db, 1, "electromagnetism-1"), 2);
  assert.deepEqual(
    listPendingLearnNotifications(db, 1).map((notice) => notice.id),
    ["learn_c:failed"],
  );
  assert.equal(dismissLearnNotificationsForGarden(db, 1, "someone-else"), 0);
});

test("an inbox without learn tables answers empty instead of throwing", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1);");
  ensureLearnNotificationSchema(db);
  assert.deepEqual(listPendingLearnNotifications(db, 1), []);
  assert.equal(dismissLearnNotifications(db, 1, [{ jobId: "x", phase: "active" }]), 0);
});

test("Learn targets open the Garden with its panel showing", () => {
  const target = { surface: "garden_learn", gardenSlug: "electromagnetism-1", chatId: "job" };
  assert.ok(isChatNotificationTarget(target));
  assert.equal(
    isChatNotificationTarget({ surface: "garden_learn", chatId: "job" }),
    false,
    "a Learn target needs its Garden",
  );
  assert.equal(chatNotificationHref(target), "/gardens/electromagnetism-1?learn=1");
  assert.equal(chatNotificationTargetKey(target), "garden_learn:electromagnetism-1:job");
  assert.equal(LEARN_NOTIFICATION_ANY_JOB, "*");

  const page = source("../src/app/gardens/[clusterSlug]/page.tsx");
  assert.match(page, /initialLearnPanelOpen=\{initialLearnPanelOpen\}/);
  assert.match(page, /requested\.learn/);
});

test("the inbox route and the corner card carry Learn notices end to end", () => {
  const route = source("../src/app/api/chat-notifications/route.ts");
  assert.match(route, /listPendingLearnNotifications\(db, userId\)/);
  assert.match(route, /parseLearnNotificationId/);
  assert.match(route, /seen\.surface === "garden_learn"/);
  assert.match(route, /dismissLearnNotificationsForGarden/);

  const schema = source("../src/lib/conversations/schema.ts");
  assert.match(schema, /ensureLearnNotificationSchema\(database\)/);

  const toast = source("../src/app/components/toast.tsx");
  assert.match(toast, /progressPercent/);
  assert.match(toast, /role="progressbar"/);
  assert.match(toast, /activeLearnNotificationGarden\(\)/);
  assert.match(toast, /LEARN_NOTIFICATION_OPENED_EVENT/);
  assert.match(toast, /dismissLearnToasts/);
  assert.doesNotMatch(toast, /localStorage/);

  const workspace = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");
  assert.match(workspace, /setActiveLearnNotificationGarden\(clusterSlug\)/);
  assert.match(workspace, /return \(\) => setActiveLearnNotificationGarden\(null\)/);
  assert.match(workspace, /target\.surface === "garden_learn"/);
  assert.match(workspace, /useState\(initialLearnPanelOpen\)/);
});
