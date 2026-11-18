// Paired, held-out replays. Only synthetic workspace data goes to the model.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { personalFixture } from "../tests/helpers/personal-context-fixture.mjs";
const active = JSON.parse(
  fs.readFileSync(path.join(process.env.APPDATA, "breadboard-desktop/Data/runtime/endpoints.json"), "utf8"),
);
const base = new URL(active.urls.chatmock);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname));
const f = await personalFixture();
const { resolvePersonalContext } = await import("../src/lib/personal-context/resolve.ts");
const { contextPrompt } = await import("../src/lib/personal-context/rank.ts");
const { learnedEvidence } = await import("../src/lib/personal-context/suggestions.ts");
const { composeMemoryContext, loadConversationMemoryBundle } =
  await import("../src/lib/conversations/memory.ts");
const { createConversation } = await import("../src/lib/conversations/store.ts");
f.canonical
  .prepare("INSERT INTO users(id,username,email,password_hash) VALUES(1,'replay','replay@example.test','x')")
  .run();
const conv = createConversation({ userId: 1, title: "Replay" });
for (const row of f.data.prepare("SELECT id,name,slug,memory_scope FROM clusters WHERE user_id=1").all()) {
  f.canonical
    .prepare("INSERT INTO clusters(id,user_id,name,slug,memory_scope) VALUES(?,1,?,?,?)")
    .run(row.id, row.name, row.slug, row.memory_scope);
}
for (const row of f.data.prepare("SELECT * FROM durable_memories WHERE user_id=1").all()) {
  f.canonical
    .prepare(
      "INSERT INTO durable_memories(user_id,kind,scope,scope_id,state,content,confidence,salience) VALUES(1,?,?,?,?,?,1,1)",
    )
    .run(row.kind, row.scope, row.scope_id, row.state, row.content);
}
for (const row of f.data
  .prepare(
    "SELECT c.*,s.working_state FROM conversations c LEFT JOIN conversation_memory_state s ON s.conversation_id=c.id WHERE c.user_id=1",
  )
  .all()) {
  const saved = createConversation(
    { userId: 1, title: row.title, defaultGardenId: row.default_garden_id, surface: row.surface },
    f.canonical,
  );
  if (row.working_state)
    f.canonical
      .prepare("INSERT OR REPLACE INTO conversation_memory_state(conversation_id,working_state) VALUES(?,?)")
      .run(saved.id, row.working_state);
}
const scenarios = [
  ["familiar site", "Open my Atlas design board.", ["forge.example.test/teams/atlas"]],
  ["closed course", "Find the labs for my Neurocomp course on Canvas.", ["campus.example.test/courses/42"]],
  ["resume", "Pick up where I left off and tell me what I need to do next.", ["drift", "ceramic", "load"]],
  ["project decision", "What did we decide about the Meridian housing?", ["ceramic"]],
  ["open work", "Find my unfinished Meridian bench task.", ["drift", "load"]],
  [
    "garden preference",
    "Prepare my next calibration review.",
    ["baseline", "error budget"],
    { gardenId: 11, surface: "garden_chat" },
  ],
  [
    "other garden",
    "Help me get my next field notes underway.",
    ["catchment", "checklist"],
    { gardenId: 10, surface: "garden_chat", allowFollowup: true },
  ],
  ["no evidence", "Find my Kestrel supplier portal.", [], { expectAsk: true }],
  ["temporary", "Open my Atlas design board.", [], { temporary: true, expectAsk: true }],
  ["personalization off", "Open my Atlas design board.", [], { personalize: false, expectAsk: true }],
  [
    "garden new chat",
    "Give me one concrete next step in my Headwater garden.",
    ["catchment"],
    { garden: "headwater", gardenId: 10 },
  ],
  [
    "terminal new chat",
    "Give me a suggestion for picking up a specific piece of my work.",
    ["drift"],
    { suggest: true },
  ],
];
if (process.argv.includes("--edge-cases")) {
  const visit = (url, title) => ({
    url,
    title,
    visitedAt: Date.now(),
    visitsByUser: { 1: { title, visitedAt: Date.now(), days: ["2026-11-17"] } },
  });
  fs.writeFileSync(
    path.join(f.dir, "browser-history.json"),
    JSON.stringify({
      version: 1,
      entries: [
        ...f.entries,
        visit("https://orchid.example.test/north", "Orchid roster · North"),
        visit("https://orchid.example.test/south", "Orchid roster · South"),
        visit("https://alder.example.test/current", "Alder studio · current course"),
        visit("https://archive.example.test/alder", "Alder studio · archived 2023 course"),
      ],
    }),
  );
  scenarios.push(
    ["two plausible targets", "Open my Orchid roster.", ["north", "south"], { expectAsk: true }],
    [
      "current versus archived",
      "Find the current course page for my Alder studio.",
      ["alder.example.test/current"],
    ],
    [
      "expired session",
      "Check my Neurocomp lab deadlines.",
      [],
      {
        expectRecovery: true,
        observation:
          "Trusted browser tool result for https://campus.example.test/courses/42: redirected to the university sign-in page. The current session has expired and no assignment data is visible.",
      },
    ],
  );
}
const model = process.env.BB_REPLAY_MODEL || "gpt-6.1-sol";
const report = { port: base.port, model, fixture: "synthetic", cases: [] };
const out = process.argv[2];
const write = () => {
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
};
const controller = AbortSignal.timeout(90000);
const catalog = await fetch(new URL("/v1/models", base), { signal: controller }).then((r) => r.json());
assert.ok(catalog.data.some((x) => x.id === model));
async function ask(q, context) {
  const r = await fetch(new URL("/v1/chat/completions", base), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer local" },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model,
      reasoning_effort: "low",
      max_completion_tokens: 650,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You are Breadboard. Decide the best immediate next step using available workspace evidence. Describe what you would open or do, including any exact URL, project detail or decision that is known. If essential information is missing, ask for it. Do not invent or report unexecuted actions. Reply with only JSON containing action (proceed or ask) and answer (short text).",
        },
        { role: "system", content: context },
        { role: "user", content: q },
      ],
    }),
  });
  if (!r.ok) throw Error("ChatMock returned " + r.status);
  const text = (await r.json()).choices?.[0]?.message?.content || "";
  const result = JSON.parse(text.replace(/^.*?(\{)/s, "$1").replace(/\}[^}]*$/s, "}"));
  return { action: result.action, answer: String(result.answer) };
}
let pos = 0;
async function run() {
  while (pos < scenarios.length) {
    const [name, q, checks, extra = {}] = scenarios[pos++];
    const baseline = composeMemoryContext(
      loadConversationMemoryBundle(
        {
          conversation: { ...conv, temporary: Number(Boolean(extra.temporary)) },
          query: q,
          activeGardenId: extra.gardenId,
          personalize: extra.personalize,
          touch: false,
        },
        f.canonical,
      ),
    );
    const start = performance.now();
    let context;
    if (extra.suggest || extra.garden)
      context = JSON.stringify(
        (await learnedEvidence(1, extra.garden, f.data, f.root))
          .slice(0, 6)
          .map((x) => [x.suggestedPrompt, x.summary]),
      );
    else context = contextPrompt(await resolvePersonalContext({ ...f.input, ...extra, query: q }, f.options));
    const lookupMs = Math.round(performance.now() - start);
    const compare = async (mode, text) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await ask(q, [baseline, text, extra.observation].filter(Boolean).join("\n\n"));
          const pass = extra.expectRecovery
            ? /sign[ -]?in|log[ -]?in|reauthenticate/i.test(result.answer) &&
              !/\b(?:deadline is|due on|added to)\b/i.test(result.answer)
            : extra.expectAsk
              ? result.action === "ask" &&
                !/forge\.example|campus\.example/i.test(result.answer) &&
                checks.every((w) => result.answer.toLowerCase().includes(w))
              : (result.action === "proceed" || extra.allowFollowup === true) &&
                checks.every((w) => result.answer.toLowerCase().includes(w.toLowerCase()));
          return { mode, ...result, pass };
        } catch (e) {
          if (attempt === 1) return { mode, error: e.message };
        }
      }
    };
    const [without, withContext] = await Promise.all([
      compare("existing-memory", null),
      compare("with-personal-context", context),
    ]);
    report.cases.push({ name, lookupMs, existing: without, updated: withContext });
    write();
    console.log(name, without.pass, withContext.pass, lookupMs);
  }
}
try {
  await Promise.all([run(), run()]);
} finally {
  f.close();
  f.canonical.close();
  fs.rmSync(f.root, { recursive: true, force: true });
}
report.result = {
  existing: report.cases.filter((x) => x.existing.pass).length,
  updated: report.cases.filter((x) => x.updated.pass).length,
  total: scenarios.length,
};
write();
console.log(report.result);
if (report.result.updated !== report.result.total || report.result.updated <= report.result.existing) {
  process.exitCode = 1;
}
