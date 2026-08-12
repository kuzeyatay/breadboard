import assert from "node:assert/strict";
import test from "node:test";

import { providerUsageLink } from "../src/lib/provider-usage.ts";

test("Claude subscription models open Anthropic's live plan usage", () => {
  assert.deepEqual(providerUsageLink("cliproxy/claude-opus-5"), {
    href: "https://claude.ai/settings/usage",
    label: "Usage",
    title: "Open live Claude usage",
  });
  assert.equal(providerUsageLink("  CLIPROXY/CLAUDE-SONNET-5  ")?.href,
    "https://claude.ai/settings/usage");
});

test("ChatGPT and unrelated subscription models keep their own usage UI", () => {
  assert.equal(providerUsageLink("gpt-5.6-sol"), null);
  assert.equal(providerUsageLink("cliproxy/gemini-3-pro"), null);
  assert.equal(providerUsageLink(undefined), null);
});
