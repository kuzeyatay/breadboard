// ASCII Art Diagrams: the reviewed jasnell pack is available to Bread's
// Hermes assistant and selected automatically for explicitly text-only visual
// output before the normal rendered Diagram Design capability.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { resolveCommandMessage } from "../src/lib/hermes/commands.ts";
import { diagramCommandText } from "../src/lib/hermes/diagram-intent.ts";
import {
  asciiDiagramCommandText,
  ASCII_ART_DIAGRAMS_SKILL,
  shouldAutoSelectAsciiDiagram,
} from "../src/lib/hermes/ascii-diagram-intent.ts";
import { visualizerCommandText } from "../src/lib/hermes/interactive-visualizer-intent.ts";
import { listApprovedSkills, listFirstPartySkills } from "../src/lib/hermes/skills.ts";

const sourceRoot = new URL("../../opencode-skill-ascii-art-diagrams/", import.meta.url);
const targetRoot = new URL("../../hermes-skills/prebuilt/ascii-art-diagrams/", import.meta.url);

function selects(text, priorMessages) {
  return shouldAutoSelectAsciiDiagram({
    text,
    surface: "dashboard_terminal",
    authenticated: true,
    priorMessages,
  });
}

test("the reviewed upstream pack and its executable support files ship with Breadboard", () => {
  const skill = fs.readFileSync(new URL("SKILL.md", targetRoot), "utf8");
  for (const marker of [
    "source: https://github.com/jasnell/opencode-skill-ascii-art-diagrams",
    "upstream_revision: 45be22b",
    "category: reviewed-guidance",
    "surfaces: [garden_chat, dashboard_terminal]",
    "PLAN, DRAW, and VERIFY",
    "scripts/grid.py",
    "scripts/verify.py",
    "fenced `text` block",
  ]) {
    assert.ok(skill.includes(marker), `adapted skill lost ${marker}`);
  }

  // Breadboard changes only SKILL.md. The detailed reference and Python
  // helpers remain byte-identical to the reviewed clone.
  for (const relative of ["README.md", "REFERENCE.md", "scripts/grid.py", "scripts/verify.py"]) {
    assert.deepEqual(
      fs.readFileSync(new URL(relative, targetRoot)),
      fs.readFileSync(new URL(relative, sourceRoot)),
      `${relative} drifted from the reviewed clone`,
    );
  }
});

test("ASCII Art Diagrams is a ready knowledge-work skill on both Hermes chat surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find(
      (candidate) => candidate.slug === ASCII_ART_DIAGRAMS_SKILL,
    );
    assert.ok(skill, `ascii-art-diagrams missing from ${surface}`);
    assert.equal(skill.classification, "eligible_general", surface);
    assert.equal(skill.availability, "ready", surface);
    assert.ok(skill.enabled && skill.healthy, surface);
    assert.deepEqual(skill.capabilityContract?.requiredTools, []);
    assert.ok(
      listApprovedSkills(surface).some(
        (candidate) => candidate.slug === ASCII_ART_DIAGRAMS_SKILL,
      ),
      `ascii-art-diagrams is not approved on ${surface}`,
    );
  }
});

test("explicit ASCII and text-diagram requests select the skill", () => {
  for (const text of [
    "draw an ASCII diagram of the auth flow",
    "make a plain-text architecture diagram for this service",
    "show the deployment topology as ASCII art",
    "create a text-only flowchart for onboarding",
    "give me a terminal-style box-and-arrow layout",
    "visualize this sequence in monospace",
    "text diagram of the request lifecycle please",
    "diagram this using +---+ boxes and | pipes",
    "No Mermaid; ASCII please",
  ]) {
    assert.equal(selects(text), true, `should select: ${text}`);
  }
});

test("ordinary diagrams, discussion, other formats, and prose are not stolen", () => {
  for (const text of [
    "draw an architecture diagram of the auth flow",
    "what is ASCII art?",
    "explain why ASCII diagrams can be useful",
    "ASCII diagrams are compact",
    "the terminal-style diagram looks broken",
    "convert this ASCII diagram to SVG",
    "write Mermaid, not ASCII",
    "make an interactive text diagram of the cache",
    "I need a plain text log of the command output",
    "/diagram-design draw the architecture",
  ]) {
    assert.equal(selects(text), false, `should not select: ${text}`);
  }
});

test("ASCII intent wins before rendered Diagram Design, while generic intent still renders", () => {
  const asciiText = "draw an ASCII architecture diagram of the gateway";
  const ascii = asciiDiagramCommandText({
    text: asciiText,
    surface: "dashboard_terminal",
    authenticated: true,
  });
  assert.deepEqual(ascii, {
    text: `/${ASCII_ART_DIAGRAMS_SKILL} ${asciiText}`,
    automatic: true,
  });
  assert.equal(
    diagramCommandText({
      text: ascii.text,
      surface: "dashboard_terminal",
      authenticated: true,
    }).automatic,
    false,
  );

  const genericText = "draw an architecture diagram of the gateway";
  assert.equal(
    asciiDiagramCommandText({
      text: genericText,
      surface: "dashboard_terminal",
      authenticated: true,
    }).automatic,
    false,
  );
  assert.equal(
    diagramCommandText({
      text: genericText,
      surface: "dashboard_terminal",
      authenticated: true,
    }).automatic,
    true,
  );
});

test("interactive visualization keeps first refusal", () => {
  const visualizer = visualizerCommandText({
    text: "build an interactive diagram of how the cache warms",
    surface: "dashboard_terminal",
    authenticated: true,
  });
  assert.equal(visualizer.automatic, true);
  assert.equal(
    asciiDiagramCommandText({
      text: visualizer.text,
      surface: "dashboard_terminal",
      authenticated: true,
    }).automatic,
    false,
  );
});

test("a follow-up keeps the ASCII workflow that drew the prior diagram", () => {
  const prior = [
    { role: "user", content: "draw the flow as ASCII" },
    {
      role: "assistant",
      content: "Used /ascii-art-diagrams.\n```text\n+---+\n| A |\n+---+\n```",
    },
  ];
  assert.equal(selects("make the boxes wider", prior), true);
  assert.equal(selects("align the arrows", prior), true);
  assert.equal(
    selects("make the boxes wider", [
      { role: "assistant", content: "I renamed the CSS variables." },
    ]),
    false,
  );
});

test("selection is limited to authenticated Bread chat surfaces", () => {
  const text = "draw an ASCII diagram of the auth flow";
  assert.equal(
    shouldAutoSelectAsciiDiagram({ text, surface: "quartz_ai", authenticated: true }),
    false,
  );
  assert.equal(
    shouldAutoSelectAsciiDiagram({
      text,
      surface: "dashboard_terminal",
      authenticated: false,
    }),
    false,
  );
});

test("Hermes command resolution injects the full reviewed workflow", async () => {
  const resolved = await resolveCommandMessage(
    1,
    `/${ASCII_ART_DIAGRAMS_SKILL} draw the auth flow`,
    undefined,
    { mode: "knowledge", surface: "dashboard_terminal" },
  );
  assert.deepEqual(
    resolved.invocations.map((item) => [item.kind, item.slug]),
    [["skill", ASCII_ART_DIAGRAMS_SKILL]],
  );
  assert.match(resolved.text, /Reviewed skill guidance: ascii-art-diagrams/);
  assert.match(resolved.text, /## Phase 1: PLAN/);
  assert.match(resolved.text, /## Phase 2: DRAW/);
  assert.match(resolved.text, /## Phase 3: VERIFY/);
  assert.match(resolved.text, /User request\]\ndraw the auth flow/);
});

test("both Hermes turn pipelines route ASCII before rendered diagrams with fallback", () => {
  for (const file of [
    "../src/lib/conversations/turn-service.ts",
    "../src/lib/hermes/garden-chat-adapter.ts",
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /asciiDiagramCommandText\(/, file);
    assert.match(source, /text: audioSelection\.text/, `${file}: ASCII chain input`);
    assert.match(source, /text: asciiDiagramSelection\.text/, `${file}: diagram chain input`);
    assert.match(source, /!asciiDiagramSelection\.automatic/, `${file}: unavailable fallback`);
    assert.match(source, /automaticAsciiDiagram/, `${file}: audit metadata`);
  }
});

test("the standing Hermes prompt prevents unselected models from improvising ASCII", () => {
  const prompt = fs.readFileSync(
    new URL("../../hermes-config/system/assistant.md", import.meta.url),
    "utf8",
  );
  assert.match(prompt, /Do not improvise an ASCII/);
  assert.match(prompt, /server selected `ascii-art-diagrams`/);
});
