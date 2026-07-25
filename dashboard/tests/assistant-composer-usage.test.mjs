import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("Usage lives in the shared Intelligence menu", () => {
  const composerSource = source("../src/app/components/assistant-composer.tsx");
  const intelligenceIndex = composerSource.indexOf(">Intelligence</div>");
  const modelIndex = composerSource.indexOf("<span>Model</span>", intelligenceIndex);
  const usageIndex = composerSource.indexOf("<UsageLimitsPopover", modelIndex);

  assert.ok(intelligenceIndex >= 0, "Intelligence menu should exist");
  assert.ok(modelIndex > intelligenceIndex, "Model choices should follow reasoning choices");
  assert.ok(usageIndex > modelIndex, "Usage should be shown after the model choices");
});

test("Intelligence remains editable during a run and its panels do not block the menu", () => {
  const composerSource = source("../src/app/components/assistant-composer.tsx");
  const usageSource = source("../src/app/components/usage-limits-popover.tsx");

  assert.match(composerSource, /onClick=\{toggleIntelligence\}/);
  assert.match(composerSource, /\{showIntelligence \? \(/);
  assert.doesNotMatch(composerSource, /showIntelligence && !activeRun/);
  assert.doesNotMatch(
    composerSource,
    /onReasoningEffortChange\(option\.value\);\s*setShowIntelligence/,
  );
  assert.doesNotMatch(
    composerSource,
    /onModelChange\(item\);\s*setShowIntelligence/,
  );
  assert.match(composerSource, /changes apply to the next message/);
  assert.match(composerSource, /showBackdrop=\{false\}/);
  assert.match(usageSource, /open\?: boolean/);
  assert.match(usageSource, /onOpenChange\?: \(open: boolean\) => void/);
});

test("every ChatMock interface gets Usage through AssistantComposer only", () => {
  const composerSource = source("../src/app/components/assistant-composer.tsx");
  const interfaces = [
    source("../src/app/gardens/[clusterSlug]/workspace-client.tsx"),
    source("../src/app/garden/garden-assistant.tsx"),
    source("../src/app/components/knowledge-terminal.tsx"),
  ];

  assert.match(composerSource, /import UsageLimitsPopover/);
  assert.equal(composerSource.match(/<UsageLimitsPopover/g)?.length, 1);
  for (const interfaceSource of interfaces) {
    assert.match(interfaceSource, /<AssistantComposer/);
    assert.doesNotMatch(interfaceSource, /UsageLimitsPopover/);
  }
});
