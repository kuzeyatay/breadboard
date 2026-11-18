import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { personalFixture, seedRoom } from "./helpers/personal-context-fixture.mjs";
const f = await personalFixture();
const { resolvePersonalContext, contextSources } = await import("../src/lib/personal-context/resolve.ts");
const { learnedEvidence, recordOutcome, applyEventSuggestion, selectionLessons } =
  await import("../src/lib/personal-context/suggestions.ts");
const { setContextFeedback } = await import("../src/lib/personal-context/learning.ts");
const { CalendarStore } = await import("../src/lib/calendar/store.ts");
const { createCalendarEvent } = await import("../src/lib/calendar/agent-actions.ts");
const { episodicVote } = await import("../src/vendor/cadence/episodic-vote.ts");
const { roomLessons } = await import("../src/lib/personal-context/room.ts");
const { focusEvidence } = await import("../src/lib/personal-context/rank.ts");
const query = (q, extra = {}) => resolvePersonalContext({ ...f.input, query: q, ...extra }, f.options);
after(() => {
  f.close();
  f.canonical.close();
  fs.rmSync(f.root, { recursive: true, force: true });
});
test("a document and its selection inherit the owner's conversation and honor later privacy changes", async () => {
  const notes = () => selectionLessons(1, "conv_hydro", "Field notes and catchment map", f.data, f.root);
  assert.match(JSON.stringify(await notes()), /catchment map/);
  assert.deepEqual(await selectionLessons(2, "conv_hydro", "catchment", f.data, f.root), []);
  for (const [column, value, restore] of [
    ["temporary", 1, 0],
    ["buzz_room_id", 45, null],
  ]) {
    f.data.prepare("UPDATE conversations SET " + column + "=? WHERE id=2").run(value);
    try {
      assert.deepEqual(await notes(), []);
    } finally {
      f.data.prepare("UPDATE conversations SET " + column + "=? WHERE id=2").run(restore);
    }
  }
  assert.deepEqual(await selectionLessons(1, "conv_wrong", "catchment", f.data, f.root), []);
});
test("correcting a taught name replaces its prior meaning within the same real conversation", async () => {
  const { createConversation } = await import("../src/lib/conversations/store.ts");
  const { maintainDurableMemoryFromUserTurn } = await import("../src/lib/conversations/memory.ts");
  f.canonical
    .prepare(
      "INSERT INTO users(id,username,email,password_hash) VALUES(1,'reader','reader@example.test','x')",
    )
    .run();
  const conversation = createConversation({ userId: 1, title: "Garden shorthand" }, f.canonical);
  const remember = (content) => maintainDurableMemoryFromUserTurn({ conversation, content }, f.canonical);
  const original = remember("When I say the ledger I mean the green binder.");
  const revised = remember("Actually, when I say the ledger I mean the violet notebook.");
  assert.equal(original.memory_key, revised.memory_key);
  assert.match(revised.content, /violet notebook/);
  assert.deepEqual(
    f.canonical
      .prepare("SELECT state FROM durable_memories WHERE memory_key=? ORDER BY id")
      .pluck()
      .all(revised.memory_key),
    ["superseded", "confirmed"],
  );
});
test("organization decisions respect room membership, current corrections, threads and deletion", async () => {
  const { room, root } = await seedRoom(f.data);
  assert.deepEqual(roomLessons(f.data, 2, room.publicId, null, "handoffs"), []);
  assert.deepEqual(roomLessons(f.data, 1, room.publicId, null, "validation"), []);
  assert.match(roomLessons(f.data, 1, room.publicId, root.id, "validation")[0].title, /cobalt/);
  assert.match(roomLessons(f.data, 1, room.publicId, null, "sensor handoffs")[0].title, /violet/);
  assert.ok(!JSON.stringify(roomLessons(f.data, 1, room.publicId, null, "")).includes("yellow"));
  f.data.prepare("DELETE FROM organization_members WHERE user_id=1").run();
  assert.deepEqual(roomLessons(f.data, 1, room.publicId, root.id, "validation"), []);
});
test("readers and private page chat resolve the current page without crossing workspaces", async () => {
  for (const surface of ["quartz_ai", "garden_chat", "dashboard_terminal"]) {
    const hits = await query("What should I draw first?", {
      surface,
      gardenId: 10,
      focus: "Field notes and the catchment map",
    });
    assert.ok(
      hits.some((hit) => hit.title.includes("catchment map")),
      surface,
    );
    assert.ok(!JSON.stringify(hits).includes("baseline trace"));
  }
  const records = await learnedEvidence(1, undefined, f.data, f.root);
  assert.deepEqual(focusEvidence(records, "Cuneiform transcription handbook"), []);
  assert.deepEqual(
    await query("Explain this step", { surface: "quartz_ai", gardenId: 12, focus: "drift" }),
    [],
  );
  assert.deepEqual(await query("Open my board", { surface: "quartz_ai", gardenId: 10, userId: 0 }), []);
});
test("familiar sites resolve in a closed tab and omit unassigned or foreign history", async () => {
  const hits = await query("Open my Neurocomp Canvas course");
  assert.equal(hits[0].ref, "https://campus.example.test/courses/42");
  assert.ok(!(await query("Open my Atlas board")).some((h) => h.ref.includes("other-account")));
  assert.ok(!hits.some((h) => h.ref.includes("unassigned")));
});
test("resume links the working file, last decision and an actual open task", async () => {
  const hits = await query("Pick up where I left off");
  assert.ok(hits.some((h) => h.ref.includes("drift-draft")));
  assert.ok(hits.some((h) => h.detail?.includes("ceramic housing")));
  assert.ok(hits.some((h) => h.source === "task"));
});
test("private, impersonal, anonymous, internal and unrelated turns skip all source reads", async () => {
  const noRead = {
    database: new Proxy(
      {},
      {
        get() {
          throw Error("unexpected read");
        },
      },
    ),
    expand() {
      throw Error("unexpected expansion");
    },
  };
  for (const extra of [
    { temporary: true },
    { personalize: false },
    { internal: true },
    { surface: "quartz_ai" },
    { query: "Explain binary search" },
  ])
    assert.deepEqual(
      await resolvePersonalContext({ ...f.input, query: "Open my board", ...extra }, noRead),
      [],
    );
});
test("new Garden chat suggestions learn only inside the selected garden", async () => {
  const a = await learnedEvidence(1, "headwater", f.data, f.root),
    b = await learnedEvidence(1, "meridian", f.data, f.root);
  assert.ok(a.some((e) => e.title.includes("catchment map")));
  assert.ok(b.some((e) => e.title.includes("baseline trace")));
  assert.ok(!JSON.stringify(b).includes("catchment"));
  assert.deepEqual(await learnedEvidence(2, "headwater", f.data, f.root), []);
  assert.ok(!JSON.stringify(await query("Open my catchment worksheet")).includes("hydro-draft"));
});
test("choice feedback reverses predictions and ignores duplicate exposure", () => {
  assert.equal(episodicVote([], ["review"]), 0);
  const episodes = [
    { context: ["review"], outcome: 1 },
    { context: ["review"], outcome: 1 },
  ];
  assert.equal(episodicVote(episodes, ["review"]), 0.75);
  assert.equal(episodicVote([...episodes, { context: ["review"], outcome: -1 }], ["review"]), -0.125);
});
test("correction and dismissal are scoped and revoked evidence disappears", async () => {
  const items = await learnedEvidence(1, undefined, f.data, f.root),
    site = items.find((e) => e.lesson?.kind === "revisit");
  assert.ok(site);
  recordOutcome(f.data, 1, site, 1);
  recordOutcome(f.data, 1, site, 1);
  assert.equal(f.data.prepare("SELECT count(*) FROM personal_suggestion_outcomes").pluck().get(), 1);
  recordOutcome(f.data, 1, site, -1);
  assert.ok(!(await learnedEvidence(1, undefined, f.data, f.root)).some((x) => x.id === site.id));
  setContextFeedback(f.data, 1, 0, site.lesson.key, "Use Atlas for enclosure reviews.");
  assert.ok((await query("Open my Atlas board")).some((x) => x.detail?.includes("enclosure reviews")));
  fs.writeFileSync(
    path.join(f.dir, "browser-history.json"),
    JSON.stringify({ version: 1, entries: f.entries.filter((x) => !x.url.includes("forge.")) }),
  );
  assert.ok(!(await query("Open my Atlas board")).some((x) => x.ref.includes("forge.")));
});
test("verified calendar writes survive retries and a changed time needs acceptance", async () => {
  const store = new CalendarStore(f.data);
  const input = {
    title: "Bench review",
    startsAt: "2026-11-21T11:00",
    sourceUrl: "https://tracker.example.test/issues/77",
  };
  const a = createCalendarEvent(store, 1, input),
    b = createCalendarEvent(store, 1, input);
  assert.equal(b.created, false);
  assert.equal(a.event.id, b.event.id);
  createCalendarEvent(store, 1, { ...input, startsAt: "2026-11-21T13:00" });
  assert.equal(store.getEvent(1, a.event.id).startsAt, input.startsAt);
  const proposal = (await learnedEvidence(1, undefined, f.data, f.root)).find(
    (x) => x.lesson?.eventId === a.event.id,
  );
  assert.ok(proposal);
  applyEventSuggestion(f.data, 1, proposal);
  assert.equal(store.getEvent(1, a.event.id).startsAt, "2026-11-21T13:00");
  assert.ok(
    !(await learnedEvidence(1, undefined, f.data, f.root)).some((x) => x.lesson?.eventId === a.event.id),
  );
});
test("a changed Plan deadline proposes a calendar update and a manual edit cancels it", async () => {
  const store = new CalendarStore(f.data),
    sourceUrl = "https://tracker.example.test/items/17";
  const { event } = createCalendarEvent(store, 1, {
    title: "Plan field run",
    startsAt: "2026-11-23",
    sourceUrl,
  });
  f.data
    .prepare(
      "UPDATE plan_tasks SET source_url=?,due_date='2026-11-26',updated_at=datetime('now','+1 hour') WHERE id=17",
    )
    .run(sourceUrl);
  const change = (await learnedEvidence(1, undefined, f.data, f.root)).find(
    (x) => x.lesson?.eventId === event.id,
  );
  assert.match(change?.summary || "", /2026-11-26/);
  store.updateEvent(1, event.id, { startsAt: "2026-11-24T00:00", endsAt: "2026-11-24T23:59", allDay: true });
  assert.throws(() => applyEventSuggestion(f.data, 1, change), /source has changed/);
  assert.ok(
    !(await learnedEvidence(1, undefined, f.data, f.root)).some((x) => x.lesson?.eventId === event.id),
  );
});
