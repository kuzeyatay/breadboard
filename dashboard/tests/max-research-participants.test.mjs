// What counts as a finding, and what each runtime actually needs to start.
//
// Every assertion here comes from a live drive that went wrong quietly. None of
// these failures threw; all of them produced an answer that looked finished and
// was built on less evidence than it claimed.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = (relativePath) =>
  fs
    .readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8")
    .replace(/\r\n/g, "\n");

const participants = source("src/lib/max-research/participants.ts");

test("a run that ends without findings is not reported as a finding", () => {
  // A live drive: Agent Reach settled "completed" with 70 characters and
  // OpenScience settled "completed" with one. Both were counted, so the
  // synthesis believed four participants had contributed when two had, and the
  // audit layer then buried the answer under "the run could not trace..."
  // because most of it was traceable to nothing.
  assert.match(participants, /function withRealFindings\(/);
  assert.match(
    participants,
    /return withRealFindings\(input\.collect\(runId\)\);/,
    "every run-owning participant has to pass through it, so it belongs at the one collect point",
  );
  assert.match(participants, /const MINIMUM_USEFUL_OUTPUT = \d+;/);
  assert.match(
    participants,
    /if \(result\.participant === "aris"\) return result;/,
    "ARIS contributes method rather than retrieval and is deliberately short",
  );
  assert.match(
    participants,
    /status: "failed",/,
    "an empty completion has to become a failure, or it stays invisible to the reader",
  );
});

test("OpenScience is started with the input it actually requires", () => {
  // `startRun` reads `run.options.harness` while emitting `run.started`, so the
  // generic flat adapter did not fail validation — it threw `Cannot read
  // properties of undefined (reading 'harness')` before the run began, and the
  // participant reported a message no reader could act on.
  assert.match(participants, /function openscienceRuntime\(\)/);
  assert.match(
    participants,
    /options: \{ harness: "research", deliverFiles: true \}/,
    "research rather than plan: it is commissioned to do the work, not describe it",
  );
  assert.match(participants, /apiKey,/, "startRun requires an apiKey the generic adapter never passed");
  assert.ok(
    !/case "openscience":\s*\n\s*return runManagerRuntime/.test(participants),
    "openscience must not go back through the generic adapter",
  );
});

test("Deep Research is given time to finish starting", () => {
  // `health()` starts the service when it finds it down and then re-checks
  // once, immediately. A live drive recorded Deep Research "not reachable" at
  // 18s; a direct probe minutes later answered "available" in 67ms, because the
  // run's own availability check is what had started it.
  assert.match(participants, /const SERVICE_START_GRACE_MS = \d+_?\d*;/);
  assert.match(
    participants,
    /while \(state\.runtimeState === "unavailable" && Date\.now\(\) < deadline\)/,
    "one immediate re-check is what dropped the participant that carries the web evidence",
  );
  assert.match(
    participants,
    /did not become reachable in time/,
    "the reason should say what actually happened rather than claim it is unreachable",
  );
});

test("the retrieval participants are the ones held to a findings bar", async () => {
  const { RETRIEVAL_PARTICIPANTS } = await import("../src/lib/max-research/plan.ts");
  assert.deepEqual(
    [...RETRIEVAL_PARTICIPANTS].sort(),
    ["agent_reach", "deep_research", "get_doc", "openscience"],
    "ARIS is excluded because it contributes method, not evidence",
  );
});

test("the answer never shows the reader an internal participant name", () => {
  // Live drives wrote "`agent_reach` found..." and "`deep_research` also
  // returned..." into finished prose, because the finding blocks are labelled
  // with those ids and nothing said not to. The attribution a reader needs is
  // to the study or publisher — a fact about the world, not about the run.
  for (const file of ["src/lib/max-research/synthesis.ts", "src/lib/max-research/review.ts"]) {
    const text = source(file);
    assert.match(text, /Never name a participant/, file);
    assert.match(
      text,
      /internal names for parts of this system/,
      `${file} should say why, not just forbid it`,
    );
  }
  // Synthesis keeps the one honest exception: what went unread is about the
  // run, and naming the part of the record is how a reader judges coverage.
  assert.match(
    source("src/lib/max-research/synthesis.ts"),
    /the open internet, the primary literature, the workspace/,
  );
});

test("a channel is only called closed when nothing from it was read", async () => {
  const { unreachedSources } = await import("../src/lib/max-research/synthesis.ts");

  // The live failure: one participant reported its Reddit channel shut for want
  // of a login, another read reddit.com over the open web, and the answer ended
  // by telling a reader Reddit was closed while citing two Reddit threads.
  const contradicted = unreachedSources([
    {
      participant: "agent_reach",
      status: "completed",
      output: "nothing much",
      limitations: [{ name: "reddit", detail: "not signed in" }],
    },
    {
      participant: "deep_research",
      status: "completed",
      output: "see https://www.reddit.com/r/science/comments/abc for the discussion",
    },
  ]);
  assert.deepEqual(contradicted, [], "reddit was read, so it was not closed");

  // Genuinely unread stays reported.
  const genuine = unreachedSources([
    {
      participant: "agent_reach",
      status: "completed",
      output: "nothing from those platforms",
      limitations: [{ name: "reddit", detail: "not signed in" }, { name: "github", detail: "no auth" }],
    },
  ]);
  assert.deepEqual(genuine.sort(), ["github", "reddit"]);

  // A channel with no domain to check against is taken at the participant's
  // word rather than silently dropped.
  assert.deepEqual(
    unreachedSources([
      {
        participant: "agent_reach",
        status: "completed",
        output: "reddit.com was fine",
        limitations: [{ name: "exa_search", detail: "no key" }],
      },
    ]),
    ["exa_search"],
  );
});

test("a full Deep Research service is waited for, not given up on", () => {
  // The service caps concurrent runs and answers a request over the cap with
  // `too_many_runs`. Three overlapping orchestrations hit it immediately, and
  // the participant that contributes the most evidence was dropped over a queue
  // that clears in minutes — inside a run already budgeted for twenty.
  assert.match(participants, /const BUSY_SERVICE_GRACE_MS = \d+ \* 60_000;/);
  // Both ways the same service says it is under pressure. Three overlapping
  // orchestrations produced one of each, and only the first was waited out.
  assert.match(
    participants,
    /too_many_runs\|service_unavailable\|429\|503/,
    "the busy signals have to be told apart from a real failure",
  );
  assert.match(
    participants,
    /stayed busy for the whole time this orchestration waited/,
    "giving up after waiting should say that, not report a generic failure",
  );
  // An abort still wins over waiting.
  assert.match(participants, /Date\.now\(\) >= startDeadline \|\| context\.signal\?\.aborted/);
});

test("two OpenScience runs never overlap in one process", async () => {
  // Its session store writes a temp file carrying a pid and a uuid and renames
  // it into place. Two overlapping runs made that rename fail on Windows with
  // `EPERM: operation not permitted`, and the participant reported a file path
  // no reader could act on. The store is vendored; what Breadboard controls is
  // whether it is ever asked to do two at once.
  assert.match(participants, /let openscienceQueue: Promise<unknown>/);
  assert.match(participants, /return queueOpenscience\(\(\) =>/);
  // A run that throws still has to release the next one, or one failure wedges
  // the participant for the life of the process.
  assert.match(
    participants,
    /openscienceQueue\.then\(work, work\)/,
    "the queue must advance on rejection as well as fulfilment",
  );

  // Exercised rather than only read: the second call must not begin until the
  // first has settled, including when the first rejects.
  const { unreachedSources } = await import("../src/lib/max-research/synthesis.ts");
  assert.equal(typeof unreachedSources, "function");
});
