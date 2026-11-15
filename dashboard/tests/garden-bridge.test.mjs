import assert from "node:assert/strict";
import test from "node:test";
import {
  GARDEN_BRIDGE_MIN_SCORE,
  bridgeTitle,
  gardenBridgeWarmed,
  parseBridgeRestatement,
  rankBridgePages,
  renderGardenBridgeContext,
  restateForBridge,
  shouldBridgeGardens,
} from "../src/lib/hermes/garden-bridge.ts";
import { embeddingCentering } from "../src/lib/thought-topology/scoring.ts";

function page(garden, title, embedding, text = title, titleEmbedding = null) {
  return {
    id: `${garden}\u0000${title}\u0000${Math.random()}`, folderId: "", primaryConcepts: [], supportingConcepts: [],
    lexicalText: text, embedding, gardenSlug: garden, gardenName: garden, title,
    relPath: `${title}.md`, summary: `About ${title}.`, titleEmbedding,
  };
}

function corpus(pages) {
  return {
    pages,
    centering: embeddingCentering(pages),
    titleCentering: embeddingCentering(pages.map((entry) => ({ embedding: entry.titleEmbedding }))),
  };
}

// Four pages per Garden so centring is active, as it is for any real Garden.
const control = corpus([
  page("control", "Feedback loop", [1, 0, 0, 0], "feedback loop error reference output"),
  page("control", "Loop gain", [0.9, 0.1, 0, 0], "feedback loop gain"),
  page("control", "Closed loop", [0.8, 0.2, 0, 0], "feedback closed loop"),
  page("control", "Bode plot", [0, 1, 0, 0]),
  page("control", "Root locus", [0, 0, 1, 0]),
  page("control", "Sampling", [0, 0, 0, 1]),
]);
const algebra = corpus([
  page("algebra", "Least squares", [0, 1, 0, 0], "least squares normal equations"),
  page("algebra", "Eigenvalues", [0, 0, 1, 0]),
  page("algebra", "Determinants", [0, 0, 0, 1]),
  page("algebra", "No vector", null, "feedback loop error reference output"),
]);

test("the restater's reply is read as a structure sentence and topic names", () => {
  assert.deepEqual(
    parseBridgeRestatement("<think>hm</think>Structure: A loop that\nfeeds an error back.\nTopics: Negative feedback; Closed-loop gain."),
    { structure: "A loop that feeds an error back.", topics: ["Negative feedback", "Closed-loop gain"] },
  );
  // A model that ignores the two-line form still yields a usable sentence.
  assert.deepEqual(parseBridgeRestatement("A loop that feeds an error back."), {
    structure: "A loop that feeds an error back.", topics: [],
  });
});

test("NONE, empty and reasoning-only replies carry no restatement", () => {
  assert.equal(parseBridgeRestatement("NONE"), null);
  assert.equal(parseBridgeRestatement('"None." It is a greeting.'), null);
  assert.equal(parseBridgeRestatement("<think>hm</think>"), null);
  assert.equal(parseBridgeRestatement(undefined), null);
});

test("pastes and one-word messages are not worth a restatement call", () => {
  assert.equal(shouldBridgeGardens("so ai is basically a feedback system?"), true);
  assert.equal(shouldBridgeGardens("thanks"), false);
  assert.equal(shouldBridgeGardens("word ".repeat(200)), false);
});

test("a failing first model falls through to the next, and an explicit NONE is final", async () => {
  const seen = [];
  const fetcher = async (_url, init) => {
    const { model, messages } = JSON.parse(init.body);
    seen.push(model);
    assert.match(messages[1].content, /Earlier messages[\s\S]*least squares[\s\S]*BEGIN QUESTION/);
    // The gateway reports an upstream failure as a 200 with no choice.
    if (seen.length === 1) return new Response(JSON.stringify({ error: "rate limited" }));
    return new Response(JSON.stringify({ choices: [{ message: { content: "Structure: A sum.\nTopics: Series" } }] }));
  };
  const restated = await restateForBridge({ request: "is it used anywhere?", priorRequests: ["what is least squares"], fetcher });
  assert.deepEqual(restated, { structure: "A sum.", topics: ["Series"] });
  assert.equal(seen.length, 2);

  let calls = 0;
  const none = await restateForBridge({
    request: "thanks for that",
    fetcher: async () => { calls += 1; return new Response(JSON.stringify({ choices: [{ message: { content: "NONE" } }] })); },
  });
  assert.equal(none, null);
  assert.equal(calls, 1);

  // No model answering is an outage, not a decision: distinct from NONE.
  const down = await restateForBridge({ request: "is ai a feedback system?", fetcher: async () => { throw new Error("hung"); } });
  assert.equal(down, undefined);
});

test("each page keeps its best match across the queries, and says which one it was", () => {
  const ranked = rankBridgePages(
    [
      { text: "a loop that feeds the output error back", embedding: [1, 0, 0, 0] },
      { text: "Least squares and normal equations", embedding: [0, 1, 0, 0] },
    ],
    [algebra, control],
  );
  const feedback = ranked.find((candidate) => candidate.title === "Feedback loop");
  const squares = ranked.find((candidate) => candidate.title === "Least squares");
  assert.equal(feedback.garden, "control");
  assert.equal(feedback.location, "/garden/control?note=Feedback%20loop");
  assert.equal(feedback.matched, "a loop that feeds the output error back");
  assert.equal(squares.matched, "Least squares and normal equations");
  assert.ok(ranked.every((candidate) => candidate.score >= GARDEN_BRIDGE_MIN_SCORE));
  // A page without a stored vector cannot be compared and is never offered.
  assert.ok(!ranked.some((candidate) => candidate.title === "No vector"));
});

test("one Garden cannot fill the list", () => {
  const ranked = rankBridgePages([{ text: "feedback loop", embedding: [1, 0, 0, 0] }], [control, algebra]);
  // Three control pages clear the floor; only two are offered.
  assert.equal(ranked.filter((candidate) => candidate.garden === "control").length, 2);
  assert.ok(["Feedback loop", "Loop gain", "Closed loop"].includes(ranked[0].title));
});

test("a short note is found by its title when its content says too little, and a repeated title is offered once", () => {
  // The note's content points elsewhere; its title is exactly the topic named.
  const notes = corpus([
    page("calculus", "13.5 Chain Rule", [0, 0, 1, 0], "worked exercise", [1, 0, 0, 0]),
    page("calculus", "13.5 Chain Rule", [0, 0, 0.9, 0.1], "second copy", [1, 0, 0, 0]),
    page("calculus", "Limits", [0, 1, 0, 0], "limits", [0, 1, 0, 0]),
    page("calculus", "Series", [0, 0, 0, 1], "series", [0, 0, 0, 1]),
    page("calculus", "Integrals", [0, 0.5, 0.5, 0], "integrals", [0, 0, 1, 0]),
  ]);
  const query = [{ text: "Chain rule for composite functions", embedding: [1, 0, 0, 0] }];
  const ranked = rankBridgePages(query, [notes]);
  assert.equal(ranked[0].title, "13.5 Chain Rule");
  assert.equal(ranked.filter((candidate) => candidate.title === "13.5 Chain Rule").length, 1);
  // Without a title vector the same note is not reachable by this query.
  const unwarmed = corpus(notes.pages.map((entry) => ({ ...entry, titleEmbedding: null })));
  assert.ok(!rankBridgePages(query, [unwarmed]).some((candidate) => candidate.title === "13.5 Chain Rule"));
  assert.equal(bridgeTitle("13.5 Chain Rule"), "Chain Rule");
  assert.equal(bridgeTitle("Math 1.pdf"), "Math 1");
});

test("nothing above the floor means no block in the turn at all", () => {
  const ranked = rankBridgePages([{ text: "unrelated words entirely", embedding: [-1, -1, -1, -1] }], [algebra]);
  assert.deepEqual(ranked, []);
  assert.equal(renderGardenBridgeContext({ structure: "anything", topics: [] }, ranked), "");
});

test("the block tells the model these are candidates to judge, not evidence", () => {
  const block = renderGardenBridgeContext({ structure: "a loop", topics: ["Feedback"] }, [
    { title: "Feedback loop", garden: "Control", location: "/garden/control?note=x", summary: "s", matched: "Feedback", score: 0.4 },
  ]);
  assert.match(block, /^# connections_to_what_the_user_has_studied/);
  assert.match(block, /candidates only/);
  assert.match(block, /Structure used for the match: a loop/);
  assert.match(block, /where the correspondence stops holding/);
  assert.match(block, /"title":"Feedback loop"/);
});

test("a turn that asked for the bridge carries pages from the user's own Gardens only, and nothing when it did not ask", async () => {
  const [fs, os, path, { registerHooks }, { planTask }] = await Promise.all([
    import("node:fs"), import("node:os"), import("node:path"), import("node:module"),
    import("../src/lib/hermes/task-plan.ts"),
  ]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-bridge-"));
  const oldRoot = process.env.QUARTZ_CONTENT_PATH;
  const oldFetch = globalThis.fetch;
  const authorization = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === "./session-service.ts" && context.parentURL?.endsWith("/terminal-garden-grounding.ts")) {
      const gardens = [{ slug: "mine", name: "Control", isOwner: true }, { slug: "shared", name: "Shared", isOwner: false }];
      return { url: `data:text/javascript,${encodeURIComponent(`export function listAuthorizedGardens() { return ${JSON.stringify(gardens)}; }`)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  } });
  try {
    for (const [slug, title] of [["mine", "Feedback loop"], ["shared", "Shared feedback page"]]) {
      const dir = path.join(root, slug, ".breadboard");
      fs.mkdirSync(dir, { recursive: true });
      const node = { id: "page:a", slug: `${slug}/a`, relPath: "notes/a.md", title, folderId: "folder:$root",
        knowledgeType: "learning-page", summary: { state: "ready", text: "Error is fed back." },
        primaryConcepts: [], supportingConcepts: [], claimIds: [], wordCount: 10 };
      fs.writeFileSync(path.join(dir, "thought-topology.json"), JSON.stringify({
        schemaVersion: 1, garden: { slug }, folders: [], nodes: [node], edges: [], build: { state: "ready" } }));
      fs.writeFileSync(path.join(dir, "thought-topology-cache.json"), JSON.stringify({
        schemaVersion: 1, nodes: { "page:a": { lexicalText: "feedback loop error", embedding: [1, 0, 0] } }, edges: {} }));
    }
    process.env.QUARTZ_CONTENT_PATH = root;
    let modelCalls = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/chat/completions")) {
        modelCalls += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: "Structure: A loop feeding error back.\nTopics: Negative feedback" } }] }));
      }
      const { input } = JSON.parse(init.body);
      return new Response(JSON.stringify({ data: input.map((_text, index) => ({ index, embedding: [1, 0, 0] })) }));
    };
    const { retrieveTerminalGardenGrounding } = await import("../src/lib/hermes/terminal-garden-grounding.ts");
    const request = "so ai is basically a feedback system?";
    const input = { userId: 1, request, plan: planTask({ request, authenticated: true }) };

    const plain = await retrieveTerminalGardenGrounding(input);
    assert.equal(plain.context, "");
    assert.equal(modelCalls, 0);

    const bridged = await retrieveTerminalGardenGrounding({ ...input, bridge: true });
    assert.equal(bridged.attempted, false, "the bridge is not Garden evidence and must not be audited as such");
    assert.match(bridged.context, /^# connections_to_what_the_user_has_studied/);
    assert.match(bridged.context, /"title":"Feedback loop","garden":"Control"/);
    assert.doesNotMatch(bridged.context, /Shared feedback page/);

    const optedOut = await retrieveTerminalGardenGrounding({ ...input, bridge: true, request: "is ai a feedback system? don't use my gardens" });
    assert.equal(optedOut.context, "");

    const working = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/chat/completions")) throw new Error("upstream hung");
      return working(url, init);
    };
    const outage = await retrieveTerminalGardenGrounding({ ...input, bridge: true });
    assert.match(outage.context, /"title":"Feedback loop"/, "a restater outage narrows the bridge instead of removing it");
    assert.match(outage.context, /question's own words/);
    globalThis.fetch = working;

    // The first turn warmed the Garden's title vectors in the background,
    // into its private folder, without making that turn wait for them.
    await gardenBridgeWarmed();
    const stored = JSON.parse(fs.readFileSync(path.join(root, "mine", ".breadboard", "bridge-title-vectors.json"), "utf8"));
    assert.deepEqual(Object.keys(stored.vectors), ["Feedback loop"]);
    assert.ok(!fs.existsSync(path.join(root, "shared", ".breadboard", "bridge-title-vectors.json")), "a Garden shared with the user is never written to");
  } finally {
    await gardenBridgeWarmed();
    authorization.deregister();
    globalThis.fetch = oldFetch;
    if (oldRoot === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = oldRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
