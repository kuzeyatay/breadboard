// Diagram Design: the vendored cathrynlavery/diagram-design pack shipped as a
// prebuilt skill that selects itself when someone asks for a drawing.
//
// Three things are locked here: the shipped SKILL.md is the clone plus a
// Breadboard preamble and an extracted digest (drift control), the skill is a
// ready knowledge-work skill on both chat surfaces (not one confined to
// OpenCode by its markup-heavy manifest), and the intent module fires on the
// sentences people write without stealing the neighbouring runtimes' turns.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { listApprovedSkills, listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  diagramCommandText,
  shouldAutoSelectDiagramDesign,
  DIAGRAM_DESIGN_SKILL,
} from "../src/lib/hermes/diagram-intent.ts";
import { visualizerCommandText } from "../src/lib/hermes/interactive-visualizer-intent.ts";
import {
  buildSkill,
  readReferences,
  shippedSupportFiles,
  cloneRoot,
  targetRoot,
} from "../../scripts/build-diagram-design-skill.mjs";

const shippedSkill = `${targetRoot}/SKILL.md`;

function selects(text, priorMessages) {
  return shouldAutoSelectDiagramDesign({
    text,
    surface: "dashboard_terminal",
    authenticated: true,
    priorMessages,
  });
}

test("the shipped SKILL.md is the clone's system plus a Breadboard preamble and digest", () => {
  const shipped = fs.readFileSync(shippedSkill, "utf8");
  // Rebuilding from the clone must reproduce the shipped file byte for byte.
  // That is the whole drift control: refresh the clone and this fails until
  // `node scripts/build-diagram-design-skill.mjs` is re-run and re-reviewed.
  assert.equal(
    shipped,
    buildSkill(fs.readFileSync(`${cloneRoot}/SKILL.md`, "utf8"), readReferences()),
    "run `node scripts/build-diagram-design-skill.mjs` — the clone and the shipped skill have drifted",
  );
  // The preamble is what makes the upstream procedure runnable here, so its
  // pointers have to survive an edit of either side.
  for (const marker of [
    'kind: "html"',
    "artifact_create",
    "No script runs",
    "The style-guide gate does not apply here",
  ]) {
    assert.ok(shipped.includes(marker), `preamble lost ${marker}`);
  }
});

test("the digest carries every type's layout grammar, since references are not injected", () => {
  const shipped = fs.readFileSync(shippedSkill, "utf8");
  const references = readReferences();
  assert.equal(references.length, 27, "the pack ships 27 visual types");
  for (const { filename } of references) {
    assert.ok(
      shipped.includes(`references/${filename}`),
      `${filename} is missing from the layout digest`,
    );
  }
  // A spot check that the extraction is the reference's own words, not a
  // heading with an empty body under it.
  assert.match(shipped, /\*\*Lifelines\*\*: dashed vertical lines/);
});

test("the reference tree and templates ship beside SKILL.md", () => {
  for (const relative of shippedSupportFiles()) {
    assert.ok(
      fs.existsSync(`${targetRoot}/${relative}`),
      `${relative} is not shipped with the skill`,
    );
  }
  assert.ok(fs.existsSync(`${targetRoot}/assets/template.html`));
  // The 100+ rendered examples and screenshots stay in the clone.
  assert.equal(fs.existsSync(`${targetRoot}/assets/example-sequence.html`), false);
});

test("Diagram Design is a ready knowledge-work skill on both chat surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find(
      (candidate) => candidate.slug === DIAGRAM_DESIGN_SKILL,
    );
    assert.ok(skill, `diagram-design missing from ${surface}`);
    // Confined to scoped_implementation, the skill would be unselectable on the
    // knowledge turns it exists for — a drawing is not repository coding.
    assert.equal(skill.classification, "eligible_general", surface);
    assert.equal(skill.availability, "ready", surface);
    assert.ok(skill.enabled && skill.healthy, surface);
    assert.deepEqual(skill.capabilityContract?.requiredArtifactKinds, ["html"]);
    assert.ok(
      listApprovedSkills(surface).some(
        (candidate) => candidate.slug === DIAGRAM_DESIGN_SKILL,
      ),
      `diagram-design is not approved on ${surface}`,
    );
  }
});

test("the sentences people actually write select the skill", () => {
  for (const text of [
    "draw me an architecture diagram of the payment service",
    "can you make a flowchart for the refund path?",
    "a swimlane of the onboarding process please",
    "sequence diagram showing the OAuth handshake",
    "diagram the auth handshake",
    "map out our hiring process",
    "org chart for the platform team",
    "I need a 2x2 of build vs buy",
    "redraw this .drawio at slide size",
    "make this mermaid presentable",
    "sketch out how requests reach the database",
    "give me a gantt for the Q3 milestones",
  ]) {
    assert.equal(selects(text), true, `should select: ${text}`);
  }
});

test("it stays out of the neighbouring runtimes' turns", () => {
  for (const text of [
    // Talking about diagrams.
    "what is a sequence diagram",
    "which tool should I use for architecture diagrams?",
    "how do I make a flowchart in draw.io",
    "what's the difference between an ER diagram and a class diagram",
    // Markup, not a drawing.
    "write me the mermaid code for the login flow",
    "give me that as mermaid syntax",
    // Image generation.
    "draw me a picture of a fox in a hat",
    "make a logo for the project",
    // The interactive visualizer's territory.
    "build an interactive diagram of the solar system",
    "simulate how the queue drains",
    // Ordinary chat that happens to contain a noun.
    "the timeline slipped by two weeks",
    "what's on the roadmap for next quarter?",
    // An explicit command decides for itself.
    "/interactive-visualizer diagram the auth flow",
  ]) {
    assert.equal(selects(text), false, `should not select: ${text}`);
  }
});

test("an interactive request reaches the visualizer, not this skill", () => {
  const text = "build an interactive diagram of how the cache warms";
  const visualizer = visualizerCommandText({
    text,
    surface: "dashboard_terminal",
    authenticated: true,
  });
  assert.equal(visualizer.automatic, true);
  // The chain hands this module the visualizer's output, and a text that
  // already starts with a slash is never claimed twice.
  assert.equal(
    diagramCommandText({
      text: visualizer.text,
      surface: "dashboard_terminal",
      authenticated: true,
    }).automatic,
    false,
  );
});

test("a follow-up keeps the guidance the first diagram was drawn with", () => {
  const prior = [
    { role: "user", content: "draw the architecture" },
    { role: "assistant", content: "Here's the architecture diagram — coral marks the gateway." },
  ];
  assert.equal(selects("make the boxes wider", prior), true);
  assert.equal(selects("drop the cache node and redraw", prior), true);
  // The same follow-up after an unrelated turn is just a follow-up.
  assert.equal(
    selects("make the boxes wider", [
      { role: "assistant", content: "I renamed the CSS variables." },
    ]),
    false,
  );
});

test("selection is scoped to authenticated chat surfaces", () => {
  const text = "draw me an architecture diagram of the payment service";
  assert.equal(
    shouldAutoSelectDiagramDesign({ text, surface: "quartz_ai", authenticated: true }),
    false,
  );
  assert.equal(
    shouldAutoSelectDiagramDesign({
      text,
      surface: "dashboard_terminal",
      authenticated: false,
    }),
    false,
  );
});

test("the command text is the skill's slash command plus the untouched message", () => {
  const text = "draw me an architecture diagram of the payment service";
  assert.deepEqual(
    diagramCommandText({ text, surface: "garden_chat", authenticated: true }),
    { text: `/${DIAGRAM_DESIGN_SKILL} ${text}`, automatic: true },
  );
});

test("both turn pipelines select it, or the feature works on one surface only", () => {
  for (const file of [
    "../src/lib/conversations/turn-service.ts",
    "../src/lib/hermes/garden-chat-adapter.ts",
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /diagramCommandText\(/, file);
    assert.match(source, /text: asciiDiagramSelection\.text/, `${file}: chain order`);
    assert.match(source, /text: diagramSelection\.text/, `${file}: chain order`);
    assert.match(source, /!diagramSelection\.automatic/, `${file}: unavailable fallback`);
  }
});
