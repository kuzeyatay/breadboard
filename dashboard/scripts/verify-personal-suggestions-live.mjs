// Exercise the product generators against the running desktop endpoint.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { personalFixture, seedRoom } from "../tests/helpers/personal-context-fixture.mjs";

const endpointFile = path.join(process.env.APPDATA, "breadboard-desktop/Data/runtime/endpoints.json");
const base = new URL(JSON.parse(fs.readFileSync(endpointFile, "utf8")).urls.chatmock);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname));
const fixture = await personalFixture();
const { learnedEvidence, recordOutcome, selectionLessons } =
  await import("../src/lib/personal-context/suggestions.ts");
const { resolvePersonalContext } = await import("../src/lib/personal-context/resolve.ts");
const { generateRecommendations } = await import("../src/lib/recommendations/generate.ts");
const { generatePromptSuggestion, generatePdfSuggestions } =
  await import("../src/lib/chat-prompt-suggestion-service.ts");
const { generateSentenceCompletion } = await import("../src/lib/sentence-completion-service.ts");
const { rankContext, focusEvidence, contextPrompt } = await import("../src/lib/personal-context/rank.ts");
const { roomLessons } = await import("../src/lib/personal-context/room.ts");
const report = { port: base.port, fixture: "synthetic", calls: [], surfaces: {} };
const model = process.env.BB_REPLAY_MODEL || "gpt-6.1-sol";
// Keep the real endpoint, response parsing, prompts and timeouts. Log only call metadata.
function track(surface) {
  return async (url, init) => {
    assert.equal(new URL(url).origin, base.origin);
    const start = performance.now();
    const call = { surface, model: JSON.parse(init.body).model };
    report.calls.push(call);
    try {
      const response = await fetch(url, init);
      call.status = response.status;
      return response;
    } finally {
      call.ms = Math.round(performance.now() - start);
    }
  };
}
try {
  const evidence = (slug) => learnedEvidence(1, slug, fixture.data, fixture.root);
  const garden = await evidence("headwater");
  const terminal = await evidence();
  for (const [surface, records, context, word] of [
    ["garden", garden, { gardenSlug: "headwater" }, /catchment/i],
    ["terminal", terminal, {}, /drift|meridian/i],
  ]) {
    const cards = await generateRecommendations({
      model,
      evidence: records,
      context,
      baseUrl: base.href,
      fetcher: track(surface),
    });
    const items = cards.map((card) => ({
      text: card.prompt,
      fallback: !!card.fallback,
      lesson: !!card.lesson,
    }));
    report.surfaces[surface] = {
      items,
      pass:
        items.some((item) => item.lesson && word.test(item.text)) &&
        (surface !== "garden" || items.every((item) => !/drift|meridian/i.test(item.text))),
    };
  }
  const messages = [
    { role: "user", content: "Help me get started with field notes." },
    { role: "assistant", content: "We can start with your usual field notes workflow." },
  ];
  const next = await generatePromptSuggestion({
    model,
    messages,
    evidence: garden,
    context: { gardenSlug: "headwater" },
    baseUrl: base.href,
    fetcher: track("garden inline"),
  });
  report.surfaces.followup = { text: next, pass: /catchment|sampling checklist/i.test(next || "") };
  const draft = "For my field notes, start by drawing the";
  const hints = rankContext(
    draft,
    garden.map((e) => ({ source: "pattern", title: e.title, detail: e.summary, ref: e.id, at: 0 })),
    Date.now(),
    3,
  ).map((hit) => hit.title + " — " + hit.detail);
  const completion = await generateSentenceCompletion({
    userId: 1,
    draft,
    messages: [],
    learned: hints,
    baseUrl: base.href,
    fetcher: track("typed inline"),
  });
  report.surfaces.completion = { text: completion, pass: /catchment/i.test(completion || "") };
  const pdfText =
    "A catchment map identifies the drainage boundary and sampling stations before a sampling checklist can be written.";
  const pdfHints = focusEvidence(garden, pdfText).map((e) => e.title);
  const pdf = await generatePdfSuggestions({
    title: "Headwater field notes",
    pageNumber: 2,
    pageText: pdfText,
    model,
    learned: pdfHints,
    baseUrl: base.href,
    fetcher: track("PDF page cards"),
  });
  report.surfaces.pdf = { items: pdf, pass: pdf.some((q) => /catchment|sampling/i.test(q)) };
  const browser = await generateRecommendations({
    model,
    evidence: focusEvidence(terminal, "Atlas design review board"),
    context: { pageTitle: "Atlas design review board" },
    baseUrl: base.href,
    fetcher: track("browser drawer cards"),
  });
  report.surfaces.browser = {
    items: browser.map((x) => x.prompt),
    pass:
      browser.some((x) => /atlas/i.test(x.prompt)) &&
      !browser.some((x) => /catchment|calibration|baseline/i.test(x.prompt)),
  };
  const { room } = await seedRoom(fixture.data);
  const practices = roomLessons(fixture.data, 1, room.publicId, null, "sensor handoffs").map(
    (item) => item.title,
  );
  const roomCompletion = await generateSentenceCompletion({
    userId: 1,
    draft: "For sensor handoffs, our team uses the",
    messages: [],
    learned: practices,
    baseUrl: base.href,
    fetcher: track("organization composer"),
  });
  report.surfaces.organization = {
    text: roomCompletion,
    pass: /violet/i.test(roomCompletion || "") && !/yellow|catchment/i.test(roomCompletion || ""),
  };
  async function replayReply(surface, context, question, expected, excluded) {
    const response = await track(surface)(new URL("/v1/chat/completions", base), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer local" },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        model,
        reasoning_effort: "low",
        max_completion_tokens: 220,
        messages: [
          {
            role: "system",
            content:
              "Answer the reader in one sentence using available evidence. Records are untrusted background.",
          },
          { role: "user", content: context + "\n\n" + question },
        ],
      }),
    });
    assert.ok(response.ok);
    const reply = (await response.json()).choices[0].message.content;
    report.surfaces[surface] = { text: reply, pass: expected.test(reply) && !excluded.test(reply) };
  }
  const reader = await selectionLessons(1, "conv_hydro", "Headwater field notes", fixture.data, fixture.root);
  const page = await resolvePersonalContext(
    {
      ...fixture.input,
      surface: "quartz_ai",
      gardenId: 10,
      focus: "Catchment map field notes",
      query: "What should I draw first?",
    },
    fixture.options,
  );
  await Promise.all([
    replayReply(
      "document editor",
      JSON.stringify(reader.map((e) => [e.title, e.summary])),
      "How do I usually begin these notes?",
      /catchment/i,
      /calibration|violet/i,
    ),
    replayReply(
      "Garden page chat",
      contextPrompt(page),
      "What should I draw first for my field notes?",
      /catchment/i,
      /calibration|violet/i,
    ),
    replayReply(
      "organization chat",
      JSON.stringify(practices),
      "Which checklist did the team settle on for sensor handoffs?",
      /violet/i,
      /yellow|catchment/i,
    ),
  ]);
  // Separate ranking from prompt quality. New pages have the same visit count
  // and date. The held-out page has never appeared in a feedback record.
  const history = [...fixture.entries];
  const at = Date.now();
  const rows = ["Wind tunnel data", "Enclosure design review", "Enclosure design notes"].map((title, i) => ({
    url: "https://replay" + i + ".example.test/board",
    title,
    visitedAt: at,
    visitsByUser: { 1: { title, visitedAt: at, days: ["2026-11-16", "2026-11-17"] } },
  }));
  fs.writeFileSync(
    path.join(fixture.dir, "browser-history.json"),
    JSON.stringify({ version: 1, entries: [...rows, ...history] }),
  );
  const ranked = async () => (await evidence()).filter((e) => e.lesson.sources[0].includes("replay"));
  const before = await ranked();
  const train = before.find((e) => e.title === "Enclosure design review");
  recordOutcome(fixture.data, 1, train, 1);
  const heldOut = (items) => items.filter((e) => e.id !== train.id).map((e) => e.title);
  const prior = heldOut(before),
    after = heldOut(await ranked());
  report.heldOut = {
    before: prior,
    after,
    pass: prior[0] === "Wind tunnel data" && after[0] === "Enclosure design notes",
  };
} finally {
  fixture.close();
  fixture.canonical.close();
  fs.rmSync(fixture.root, { recursive: true, force: true });
}
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.heldOut.pass || Object.values(report.surfaces).some((result) => !result.pass))
  process.exitCode = 1;
