import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function source(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("retry retires existing inline artifacts without deleting the archive", () => {
  const cards = source("../src/app/components/hermes/inline-artifact-cards.tsx");
  const runtimePanel = source("../src/app/components/hermes/agent-runtime-panel.tsx");
  const gardenWorkspace = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");

  assert.match(cards, /retireVersion\?: number/);
  assert.match(cards, /for \(const artifact of currentSnapshot\.artifacts\) ids\.add\(artifact\.id\)/);
  assert.match(cards, /knownArtifacts\.filter\(\(artifact\) => !retiredIds\.has\(artifact\.id\)\)/);
  assert.match(cards, /retirementPending/);

  assert.match(
    runtimePanel,
    /setInlineArtifactRetireVersion\(\(current\) => current \+ 1\);\s*onRetryMessage/,
  );
  assert.match(
    runtimePanel,
    /<InlineArtifactCards[\s\S]*?retireVersion=\{inlineArtifactRetireVersion\}/,
  );

  assert.match(
    gardenWorkspace,
    /setInlineArtifactRetireVersion\(\(current\) => current \+ 1\);\s*void handleSubmit/,
  );
  assert.match(
    gardenWorkspace,
    /legacyChatSessionId=\{chatSessionId\}[\s\S]*?retireVersion=\{inlineArtifactRetireVersion\}/,
  );

  assert.doesNotMatch(cards, /DELETE|archiveArtifact|removeArtifact/);
});
