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

test("the Usage field never shows a quota fail-over badge", () => {
  // It once announced "Gemini 3.7 Flash High is out of quota — using GPT-5.6
  // Sol" beside a Google report showing 93% of the quota left: ChatMock's
  // short-term cooldown is not the plan's quota. The field now describes the
  // chosen model's own usage and nothing else.
  const composerSource = source("../src/app/components/assistant-composer.tsx");
  const usageSource = source("../src/app/components/usage-limits-popover.tsx");
  assert.doesNotMatch(usageSource, /is out of quota|usingFallback|modelFailover|formatResetWindow/);
  assert.doesNotMatch(composerSource, /modelFailover/);
  assert.match(usageSource, /const effectiveModel = activeModel;/);
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

test("the Intelligence popup stack opens to the right of its trigger", () => {
  const composerSource = source("../src/app/components/assistant-composer.tsx");

  assert.match(
    composerSource,
    /neu-popover absolute bottom-full left-0 z-40/,
  );
  assert.doesNotMatch(
    composerSource,
    /neu-popover absolute bottom-full right-0 z-40/,
  );
});

test("the Intelligence popup stack paints above workspace rail dividers", () => {
  const globalStyles = source("../src/app/globals.css");
  const graphSource = source("../src/app/components/knowledge-graph.tsx");

  assert.match(
    globalStyles,
    /\.bb-composer-overlay\s*\{[^}]*z-index:\s*30;/s,
  );
  assert.match(graphSource, /absolute inset-y-0 left-0 z-20/);
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
