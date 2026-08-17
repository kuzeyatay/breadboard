import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  INTERACTIVE_VISUALIZER_IN_CHAT_SKILL,
  interactiveVisualizerCommandForArtifact,
  isInteractiveVisualizerSkill,
  selectedInteractiveVisualizerSkill,
  shouldRenderInteractiveVisualizerInline,
} from "../src/lib/hermes/interactive-visualizer-skills.ts";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import { resolveCommandMessage } from "../src/lib/hermes/commands.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("the in-chat visualizer is a separate ready prebuilt skill", () => {
  const original = source("../../hermes-skills/prebuilt/interactive-visualizer/SKILL.md");
  const inline = source("../../hermes-skills/prebuilt/interactive-visualizer-in-chat/SKILL.md");
  const metadata = source("../../hermes-skills/prebuilt/interactive-visualizer-in-chat/agents/openai.yaml");
  const skills = listFirstPartySkills("dashboard_terminal");
  const gardenSkills = listFirstPartySkills("garden_chat");

  assert.doesNotMatch(original, /interactive-visualizer-in-chat/);
  assert.match(inline, /^name: interactive-visualizer-in-chat$/m);
  assert.match(inline, /same\s+artifact inline/i);
  assert.match(metadata, /Interactive Visualizer in Chat/);
  assert.equal(
    skills.some((skill) =>
      skill.slug === INTERACTIVE_VISUALIZER_IN_CHAT_SKILL &&
      skill.category === "Featured" &&
      skill.availability === "ready"),
    true,
  );
  assert.equal(
    gardenSkills.some((skill) =>
      skill.slug === INTERACTIVE_VISUALIZER_IN_CHAT_SKILL &&
      skill.availability === "ready"),
    true,
  );
});

test("the new slash command resolves without selecting the existing skill", async () => {
  const resolved = await resolveCommandMessage(
    1,
    "/interactive-visualizer-in-chat demonstrate wave interference",
    process.cwd(),
    { mode: "knowledge", surface: "dashboard_terminal" },
  );
  assert.deepEqual(
    resolved.invocations.map((invocation) => invocation.slug),
    [INTERACTIVE_VISUALIZER_IN_CHAT_SKILL],
  );
  assert.match(
    resolved.text,
    /Reviewed skill guidance: interactive-visualizer-in-chat/,
  );
});

test("visualizer authorization accepts either skill and preserves inline ownership", () => {
  assert.equal(isInteractiveVisualizerSkill("interactive-visualizer"), true);
  assert.equal(isInteractiveVisualizerSkill(INTERACTIVE_VISUALIZER_IN_CHAT_SKILL), true);
  assert.equal(isInteractiveVisualizerSkill("unrelated"), false);
  assert.equal(
    selectedInteractiveVisualizerSkill(new Set([INTERACTIVE_VISUALIZER_IN_CHAT_SKILL])),
    INTERACTIVE_VISUALIZER_IN_CHAT_SKILL,
  );
  assert.equal(
    selectedInteractiveVisualizerSkill(
      new Set(["interactive-visualizer", INTERACTIVE_VISUALIZER_IN_CHAT_SKILL]),
    ),
    INTERACTIVE_VISUALIZER_IN_CHAT_SKILL,
  );

  const inlineArtifact = {
    renderer: "interactive-visualizer",
    sourceSkill: INTERACTIVE_VISUALIZER_IN_CHAT_SKILL,
  };
  assert.equal(shouldRenderInteractiveVisualizerInline(inlineArtifact), true);
  assert.equal(
    interactiveVisualizerCommandForArtifact(inlineArtifact),
    "/interactive-visualizer-in-chat ",
  );
  assert.equal(shouldRenderInteractiveVisualizerInline({
    renderer: "interactive-visualizer",
    sourceSkill: "interactive-visualizer",
  }), false);
});

test("the inline variant stays an artifact while embedding its sandbox in the response", () => {
  const cards = source("../src/app/components/hermes/inline-artifact-cards.tsx");
  const embed = source("../src/app/components/hermes/inline-interactive-visualizer.tsx");
  const viewer = source("../src/app/components/hermes/artifact-viewer.tsx");
  const previewRoute = source(
    "../src/app/api/hermes/artifacts/[artifactId]/preview/route.ts",
  );
  const runtime = source("../src/lib/hermes/interactive-visualizer-runtime.ts");
  const customRuntime = source("../src/lib/hermes/interactive-visualizer-custom.ts");
  const service = source("../src/lib/hermes/interactive-visualizer-service.ts");
  const route = source("../src/app/api/hermes/tools/artifacts/route.ts");
  const skill = source("../../hermes-skills/prebuilt/interactive-visualizer-in-chat/SKILL.md");
  const terminal = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
  const gardenChat = source("../src/app/components/hermes/garden-agent-chat.tsx");
  const workspace = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");

  assert.match(cards, /shouldRenderInteractiveVisualizerInline\(artifact\)/);
  assert.match(cards, /<InlineInteractiveVisualizer/);
  assert.match(embed, /sandbox="allow-scripts"/);
  assert.match(embed, /host-presentation/);
  assert.match(embed, /Open .* in the artifact viewer/);
  assert.match(
    embed,
    /if \(!artifact\.previewAvailable \|\| artifact\.status !== "ready"\) \{\s*return null;/,
  );
  assert.doesNotMatch(embed, /`Building \$\{artifact\.title\}/);
  assert.match(runtime, /data-presentation="inline"/);
  assert.match(runtime, /data\.presentation==="inline"/);
  assert.match(customRuntime, /CUSTOM_INTERACTIVE_VISUALIZER_SCHEMA_VERSION = 2/);
  assert.match(customRuntime, /box-shadow/);
  assert.match(customRuntime, /Gemini-style flat surfaces/);
  assert.match(customRuntime, /visual-integrity assertion/);
  assert.match(customRuntime, /must use a --viz-\* host token/);
  assert.match(customRuntime, /inline SVG icon, not text glyphs/);
  assert.match(customRuntime, /breadboard:themechange/);
  assert.match(previewRoute, /\[hidden\]\{display:none!important\}/);
  assert.match(previewRoute, /guardInteractiveVisualizerPreview/);
  for (const host of [embed, viewer]) {
    assert.ok(
      host.indexOf('explicitTheme === "light"') <
        host.indexOf('prefers-color-scheme: dark'),
      "an explicit light host theme must win over a dark operating-system preference",
    );
  }
  assert.match(skill, /Call `interactive_visualizer_create` exactly once/);
  assert.match(skill, /Do not use the terminal/);
  assert.match(skill, /cards inside cards/);
  assert.match(skill, /shared named anchors/);
  assert.match(skill, /visual integrity/);
  assert.match(route, /action === "interactive_visualizer_create"/);
  assert.match(service, /sourceSkill: input\.context\.sourceSkill/);
  assert.match(service, /isInlineInteractiveVisualizerSkill\(input\.artifact\.source_skill\)/);
  assert.match(service, /inlineInChat: true/);
  assert.match(route, /selectedInteractiveVisualizerSkill\(selectedSkills\)/);
  for (const surface of [terminal, gardenChat, workspace]) {
    assert.match(surface, /interactiveVisualizerCommandForArtifact\(artifact\)/);
  }
});

test("the inline visualizer keeps its artifact card directly below the embed", () => {
  const cards = source("../src/app/components/hermes/inline-artifact-cards.tsx");
  const embed = source("../src/app/components/hermes/inline-interactive-visualizer.tsx");
  const branchStart = cards.indexOf(
    "shouldRenderInteractiveVisualizerInline(artifact) &&",
  );
  const imageBranch = cards.indexOf('artifact.kind === "image"', branchStart);
  assert.ok(branchStart >= 0);
  assert.ok(imageBranch > branchStart);
  const inlineBranch = cards.slice(branchStart, imageBranch);
  const visualizer = inlineBranch.indexOf("<InlineInteractiveVisualizer");
  const artifactCard = inlineBranch.indexOf("<InlineArtifactFileCard");

  assert.ok(visualizer >= 0);
  assert.ok(
    artifactCard > visualizer,
    "the rectangular artifact card must follow the inline visualization",
  );
  assert.match(inlineBranch, /artifact\.status === "ready"/);
  assert.match(inlineBranch, /artifact\.previewAvailable/);
  assert.match(
    inlineBranch,
    /onOpen=\{\(\) => context\.setOpenId\(artifact\.id\)\}/,
  );
  assert.match(cards, /function InlineArtifactFileCard/);
  assert.match(embed, /onClick=\{onOpen\}/);
  assert.match(
    embed,
    /aria-label=\{`Open \$\{artifact\.title\} in the artifact viewer`\}/,
  );
});

test("the in-chat visualizer cannot complete without its current-run artifact", () => {
  const turnService = source("../src/lib/conversations/turn-service.ts");
  const runStore = source("../src/lib/hermes/run-store.ts");
  const eventStream = source("../src/lib/hermes/event-stream.ts");
  const artifactStore = source("../src/lib/hermes/artifact-store.ts");

  assert.match(
    turnService,
    /selectedInteractiveVisualizerSkill\([\s\S]*resolved\.invocations[\s\S]*requiredArtifacts/,
  );
  assert.match(runStore, /requiredArtifacts\?: RuntimeArtifactRequirement\[\]/);
  assert.match(turnService, /readyEventType: "artifact\.completed"/);
  assert.match(eventStream, /missingRequiredArtifact\(\)/);
  assert.match(eventStream, /code: "required_artifact_missing"/);
  assert.match(eventStream, /finalize\("failed"\)/);
  const gateIndex = eventStream.indexOf(
    "const missingArtifact = missingRequiredArtifact()",
  );
  assert.ok(gateIndex >= 0);
  assert.ok(
    gateIndex < eventStream.indexOf("          emit(event);", gateIndex),
    "the artifact gate must run before the upstream idle event is emitted",
  );
  assert.match(
    artifactStore,
    /event\.run_id = \?[\s\S]*event\.event_type = \?[\s\S]*event\.status = 'ready'[\s\S]*message\.client_message_id = \?[\s\S]*artifact\.renderer_id = \?[\s\S]*artifact\.source_skill = \?/,
  );
});
