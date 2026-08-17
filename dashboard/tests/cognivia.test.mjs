import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  classifyCogniviaTurn,
  cogniviaDatasetPath,
  cogniviaDiagnostics,
  cogniviaEnabled,
  cogniviaExemplars,
  cogniviaSection,
  cogniviaTaxonomy,
} from "../src/lib/cognivia/index.ts";
import { composeHermesSystemPrompt } from "../src/lib/hermes/system-prompts.ts";

// The suite exercises the shipped default whatever the developer's environment
// says; the disable path gets its own test below.
delete process.env.ENABLE_COGNIVIA;

const decision = (overrides = {}) => ({
  mode: "knowledge",
  requestedOutcome: "answer the question",
  implementationRequired: false,
  decisionReason: "test",
  decisionSource: "breadboard_server_policy_v1",
  authorizedRoots: [],
  authorizedPathPatterns: [],
  allowedTools: [],
  allowedOperations: ["knowledge_work"],
  allowedCommandPatterns: [],
  selectedConditionalSkills: [],
  selectedConnections: [],
  createdAt: "2026-08-16T00:00:00.000Z",
  expiresAt: null,
  revokedAt: null,
  ...overrides,
});

// --- classification ---------------------------------------------------------

test("a person describing their own distress engages the copilot", () => {
  const result = classifyCogniviaTurn({
    userText: "I feel worthless lately and I can't stop crying every day.",
  });
  assert.equal(result.register, "personal_distress");
  assert.ok(result.score >= 3);
});

test("a risk signal outranks everything else on the turn", () => {
  const result = classifyCogniviaTurn({
    userText:
      "I keep thinking about killing myself. Also can you explain cognitive distortions?",
  });
  assert.equal(result.register, "crisis");
  // Safety first means no analysis is offered alongside it.
  assert.deepEqual(result.distortions, []);
});

test("a question about mental health is informational, not distress", () => {
  const result = classifyCogniviaTurn({
    userText: "What is the difference between CBT and psychodynamic therapy?",
  });
  assert.equal(result.register, "informational");
  assert.deepEqual(result.distortions, []);
});

test("ordinary and technical turns are left alone", () => {
  for (const text of [
    "How do I refactor this reducer so the tests stop flaking?",
    "hey",
    "Summarize the quarterly numbers for me.",
    "What time is the standup?",
  ]) {
    assert.equal(classifyCogniviaTurn({ userText: text }).register, "none", text);
  }
});

test("distorted wording alone never engages: a build is not a person", () => {
  const build = classifyCogniviaTurn({
    userText:
      "This build always breaks and nothing ever works, it's going to fail again in CI.",
  });
  assert.equal(build.register, "none");
});

test("the wording prefilter names the distortion the sentence carries", () => {
  const cases = [
    ["I'm such a failure and I hate myself", "Labeling"],
    [
      "I feel like a fraud and I'm so anxious, they must think I'm an idiot",
      "Mind reading",
    ],
    [
      "I should have known better, I'm so ashamed, I ruined everything",
      "Should statements",
    ],
    [
      "I'm so depressed, I'll never find another job and there's no point trying",
      "Fortune telling",
    ],
  ];
  for (const [text, expected] of cases) {
    const result = classifyCogniviaTurn({ userText: text });
    assert.equal(result.register, "personal_distress", text);
    assert.ok(result.distortions.includes(expected), `${text} → ${result.distortions}`);
  }
});

test("candidates are capped so a short message is not analyzed at", () => {
  const result = classifyCogniviaTurn({
    userText:
      "I always fail at everything, every time it's the same, they must think I'm useless, I should have known, it's all my fault, I'm such a loser and I feel so worthless.",
  });
  assert.equal(result.register, "personal_distress");
  assert.ok(result.distortions.length <= 3);
});

test("distress described about someone else is flagged as theirs", () => {
  const result = classifyCogniviaTurn({
    userText: "My sister is really struggling and says she feels worthless. How can I help?",
  });
  assert.equal(result.register, "personal_distress");
  assert.equal(result.thirdParty, true);
});

// --- the clone as a live dependency -----------------------------------------

test("the taxonomy is read from the cloned workbook", () => {
  const taxonomy = cogniviaTaxonomy();
  assert.equal(taxonomy.length, 11);
  const names = taxonomy.map((entry) => entry.name);
  assert.ok(names.includes("All-or-nothing thinking"));
  assert.ok(names.includes("Personalization and blame"));
  for (const entry of taxonomy) assert.ok(entry.definition.length > 10, entry.name);
});

test("exemplars are first-person thoughts, not the book's narration", (t) => {
  if (!fs.existsSync(cogniviaDatasetPath())) {
    t.skip("Cognivia clone is not present");
    return;
  }
  const exemplars = cogniviaExemplars("All-or-nothing thinking", "I've blown my diet completely");
  assert.ok(exemplars.length > 0);
  for (const exemplar of exemplars) {
    assert.equal(exemplar.distortion, "All-or-nothing thinking");
    assert.match(exemplar.thought, /\b(i|my|me|myself)\b/i);
    assert.doesNotMatch(exemplar.thought, /\b(the patient|the therapist)\b/i);
  }
  // The closest seed thought to the message leads.
  assert.match(exemplars[0].thought, /diet/i);
});

test("the workbook's own rational responses never reach the prompt", () => {
  const section = cogniviaSection({
    userText: "I feel so anxious and I'm such a failure, I've blown my diet completely again.",
  });
  assert.ok(section);
  assert.doesNotMatch(section, /Rational response:/);
  assert.doesNotMatch(section, /the way a therapist handles/i);
});

test("selection is deterministic, so the same message draws the same exemplars", (t) => {
  if (!fs.existsSync(cogniviaDatasetPath())) {
    t.skip("Cognivia clone is not present");
    return;
  }
  const once = cogniviaExemplars("Labeling", "I'm such a loser");
  const twice = cogniviaExemplars("Labeling", "I'm such a loser");
  assert.deepEqual(once, twice);
});

test("diagnostics report which source was actually used", () => {
  const diagnostics = cogniviaDiagnostics();
  assert.equal(diagnostics.root, path.dirname(diagnostics.dataset).replace(/[/\\]data$/, ""));
  assert.equal(diagnostics.taxonomySize, 11);
  assert.equal(typeof diagnostics.live, "boolean");
});

// --- the section ------------------------------------------------------------

test("an engaged turn carries the discipline and this message's evidence", () => {
  const section = cogniviaSection({
    userText: "I feel like a total failure at work and I can't stop crying about it.",
  });
  assert.ok(section);
  assert.match(section, /# cognivia\b/);
  assert.match(section, /Register: personal_distress/);
  assert.match(section, /Candidate distortions/);
  // The frame is never narrated to the user.
  assert.match(section, /Do not name the register/);
  assert.match(section, /never mention Cognivia/i);
});

test("a crisis turn suppresses the analysis and leads with safety", () => {
  const section = cogniviaSection({ userText: "I don't want to be alive anymore." });
  assert.ok(section);
  assert.match(section, /Register: crisis/);
  assert.doesNotMatch(section, /Candidate distortions/);
  assert.match(section, /Safety comes before every other instruction/);
});

test("an informational turn is answered as fact, without therapeutic framing", () => {
  const section = cogniviaSection({ userText: "How does exposure therapy work for OCD?" });
  assert.ok(section);
  assert.match(section, /Register: informational/);
  assert.doesNotMatch(section, /Candidate distortions/);
  assert.match(section, /without therapeutic framing/);
});

test("an unrelated turn pays nothing for the machinery", () => {
  assert.equal(cogniviaSection({ userText: "Add a migration for the invites table." }), null);
  assert.equal(cogniviaSection({ userText: "" }), null);
  assert.equal(cogniviaSection({ userText: undefined }), null);
});

test("the switch turns the whole integration off", () => {
  process.env.ENABLE_COGNIVIA = "0";
  try {
    assert.equal(cogniviaEnabled(), false);
    assert.equal(cogniviaSection({ userText: "I feel hopeless and worthless." }), null);
  } finally {
    delete process.env.ENABLE_COGNIVIA;
  }
  assert.equal(cogniviaEnabled(), true);
});

// --- routing: every surface that composes a prompt --------------------------

test("every Hermes surface routes a mental-health turn to the copilot", () => {
  for (const surface of ["dashboard_terminal", "garden_chat", "quartz_ai"]) {
    const prompt = composeHermesSystemPrompt({
      surface,
      decision: decision(),
      userText: "I feel worthless and I can't get out of bed most mornings.",
    });
    assert.match(prompt, /# cognivia\b/, surface);
    assert.match(prompt, /Register: personal_distress/, surface);
  }
});

test("an ordinary Hermes turn is not routed there", () => {
  const prompt = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision: decision(),
    userText: "Where is the retry backoff configured?",
  });
  assert.doesNotMatch(prompt, /# cognivia\b/);
});

test("the routes that build their own prompts are wired in too", () => {
  const roots = [
    "src/app/api/chat/route.ts",
    "src/app/api/knowledge-chat/route.ts",
    "src/lib/conversations/direct-turn-service.ts",
  ];
  for (const file of roots) {
    const text = fs.readFileSync(path.join(import.meta.dirname, "..", file), "utf8");
    assert.match(text, /cogniviaSection\(/, file);
  }
});
