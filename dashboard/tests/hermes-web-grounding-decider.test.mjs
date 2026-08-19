import test from "node:test";
import assert from "node:assert/strict";
import {
  adjudicateWebGrounding,
  condenseRequestForDecider,
  parseWebGroundingVerdict,
  WEB_GROUNDING_DECIDER_INSTRUCTION,
} from "../src/lib/hermes/web-grounding-decider.ts";
import { planTask } from "../src/lib/hermes/task-plan.ts";

/** A stub provider that answers with a fixed classifier line. */
function stub(line, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (!ok) return new Response("no", { status });
    return Response.json({
      choices: [{ message: { content: line } }],
    });
  };
  fetcher.calls = calls;
  return fetcher;
}

test("the planner's negative is final and costs nothing", async () => {
  const fetcher = stub("WEB: should never be asked");
  const verdict = await adjudicateWebGrounding({
    request: "explain how a hash map works",
    plannerRequired: false,
    fetcher,
  });
  assert.equal(verdict.required, false);
  assert.equal(verdict.source, "planner");
  // The whole point of the asymmetry: turns the planner already cleared do not
  // wait on a provider and do not spend a call.
  assert.equal(fetcher.calls.length, 0);
});

test("an excerpt-scoped or continuation turn is not adjudicated at all", async () => {
  const fetcher = stub("WEB: should never be asked");
  for (const skipReason of ["selection", "continuation"]) {
    const verdict = await adjudicateWebGrounding({
      request: "what would be places to go?",
      plannerRequired: true,
      skip: true,
      skipReason,
      fetcher,
    });
    assert.equal(verdict.required, false);
    assert.equal(verdict.source, "skipped");
    assert.equal(verdict.reason, skipReason);
  }
  assert.equal(fetcher.calls.length, 0);
});

test("the decider can overrule a planner false positive", async () => {
  const fetcher = stub("NO_WEB: the user pasted the material to be rated");
  const verdict = await adjudicateWebGrounding({
    request: "rate these two answers about my blood test",
    plannerRequired: true,
    fetcher,
  });
  assert.equal(verdict.required, false);
  assert.equal(verdict.source, "decider");
  assert.match(verdict.reason, /pasted the material/);
  assert.equal(fetcher.calls.length, 1);
  // The classifier is asked to classify, never to answer.
  const body = fetcher.calls[0].body;
  assert.equal(body.messages[0].content, WEB_GROUNDING_DECIDER_INSTRUCTION);
  assert.match(body.messages[1].content, /Do not answer it/);
  assert.equal(body.stream, false);
});

test("the decider confirms a genuine live-information request", async () => {
  const fetcher = stub("WEB: current weather changes hourly");
  const verdict = await adjudicateWebGrounding({
    request: "what is the weather in Ankara right now?",
    plannerRequired: true,
    fetcher,
  });
  assert.equal(verdict.required, true);
  assert.equal(verdict.source, "decider");
});

test("an unreachable decider leaves the obligation off, and says so", async () => {
  // Failing toward "not armed" is only safe because the obligation stopped
  // being destructive: an unarmed gate costs a warning badge, a wrongly armed
  // one used to cost the user the whole turn. The source records that nobody
  // adjudicated, so this can never be mistaken for a real negative verdict.
  for (const fetcher of [
    stub("", { ok: false, status: 503 }),
    stub("I am not sure what you mean."),
    () => {
      throw new Error("connection refused");
    },
  ]) {
    const verdict = await adjudicateWebGrounding({
      request: "what is the latest React version?",
      plannerRequired: true,
      fetcher,
    });
    assert.equal(verdict.required, false);
    assert.equal(verdict.source, "decider_unavailable");
  }
});

test("NO_WEB is never read as WEB", () => {
  // "WEB" is a substring of "NO_WEB", so a loose positive test matches every
  // negative verdict too — which would turn the decider into a rubber stamp.
  for (const line of [
    "NO_WEB: answered from the pasted report",
    "no_web - nothing to look up",
    "NO WEB: general knowledge",
  ]) {
    assert.equal(parseWebGroundingVerdict(line)?.required, false, line);
  }
  for (const line of ["WEB: prices change", "web - needs current data"]) {
    assert.equal(parseWebGroundingVerdict(line)?.required, true, line);
  }
  for (const junk of ["", "maybe?", null, undefined, 42]) {
    assert.equal(parseWebGroundingVerdict(junk), null);
  }
  // Reasoning traces are stripped before the verdict line is read.
  assert.equal(
    parseWebGroundingVerdict("<think>hmm, WEB?</think>\nNO_WEB: pasted text")
      ?.required,
    false,
  );
});

test("an oversized paste keeps both ends and drops its middle", () => {
  const request = `${"head ".repeat(600)}MIDDLE${"tail ".repeat(400)}`;
  const condensed = condenseRequestForDecider(request);
  assert.ok(condensed.length < request.length);
  assert.match(condensed, /characters of pasted material omitted/);
  // The instruction usually opens the message and sometimes closes it; the
  // middle of a paste is the part that carries no instruction at all — and is
  // exactly where the planner picks up its stray keywords.
  assert.ok(condensed.startsWith("head"));
  assert.ok(condensed.trimEnd().endsWith("tail"));
  assert.ok(!condensed.includes("MIDDLE"));
});

test("the turn that motivated this layer: a pasted report with citations", async () => {
  // Conversation 138. The user pasted ChatGPT's blood-test answer to have it
  // rated against Breadboard's own. The deterministic planner armed the web
  // obligation twice over — the paste carried seven citation URLs, and its
  // prose supplied a recommendation "intent"/"object" pair — no web tool had
  // any reason to run, and the finished 30k-token analysis was replaced with
  // "I couldn't verify this with a live web source".
  const request = [
    "please rate answers to this, your answer and chatgpts answer, whih is better?",
    "be objective do not favor any side just because,",
    "Yes. There are a few abnormal results worth following up, but I do not see",
    "anything in this report that looks immediately dangerous.",
    "Your hemoglobin is normal at 14.1 g/dL, your RBC count is at the very top of",
    "the normal range, and RDW is normal.",
    "Insulin resistance is typically managed through diet, physical activity and",
    "sleep habits.",
    "https://www.hematology.org/education/patients/anemia/iron-deficiency?utm_source=chatgpt.com",
    "https://www.nhlbi.nih.gov/health/thalassemia/diagnosis?utm_source=chatgpt.com",
  ].join("\n");

  // The planner still proposes — a pasted URL is a real signal in general, and
  // weakening it would create false negatives no later layer could recover,
  // because the planner's "no" ends the decision.
  const plan = planTask({ request, authenticated: true });
  assert.equal(plan.requiresWebEvidence, true);

  // The decider is what makes the proposal survivable.
  const fetcher = stub("NO_WEB: the user asks for a comparison of pasted text");
  const verdict = await adjudicateWebGrounding({
    request,
    plannerRequired: plan.requiresWebEvidence,
    fetcher,
  });
  assert.equal(verdict.required, false);
  assert.equal(verdict.source, "decider");
});

test("two stray words far apart no longer read as a recommendation request", () => {
  // "top" (intent) and "activity" (object) sat 6.5 KB apart in the pasted
  // report and were tested independently over the whole message.
  const scattered = `your RBC count is at the very top of the normal range. ${"clinical prose. ".repeat(200)} managed through diet, physical activity and sleep.`;
  assert.equal(planTask({ request: scattered, authenticated: true }).requiresWebEvidence, false);

  // A real recommendation request keeps the pair in one phrase, and still fires.
  for (const real of [
    "what are the best cafes around here?",
    "which laptop should I buy?",
    "recommend some good restaurants nearby",
  ]) {
    assert.equal(
      planTask({ request: real, authenticated: true }).requiresWebEvidence,
      true,
      real,
    );
  }
});
