import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";

import { groupAssistantModels, formatAssistantModelName } from "../src/lib/ai-models.ts";
import { resolveLearnRequestModel } from "../src/lib/learn-route-errors.ts";

/**
 * Learn can be run on the chatgpt.com page, same as any other model.
 *
 * The Learn picker is fed the shared model list, so a web model reaches it
 * without a list of its own - which is exactly the property worth pinning,
 * because the way to lose it is a filter added to either end.
 */

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(dashboardRoot, ...parts), "utf8");
const workspaceSource = read("src", "app", "gardens", "[clusterSlug]", "workspace-client.tsx");

describe("Learn on OpenAI (web)", () => {
  test("the picker offers web models in their own section, marked (web)", () => {
    const groups = groupAssistantModels([
      "gpt-5.6-sol",
      "openaiweb/auto",
      "openaiweb/gpt-5-6",
      "cliproxy/claude-sonnet-5",
    ]);
    const web = groups.find((group) => group.vendorId === "openaiweb");
    assert.ok(web, `no OpenAI (web) section in ${JSON.stringify(groups)}`);
    assert.equal(web.vendorLabel, "OpenAI (web)");
    assert.deepEqual(web.models, ["openaiweb/auto", "openaiweb/gpt-5-6"]);
    assert.equal(formatAssistantModelName("openaiweb/gpt-5-6"), "GPT-5.6 (web)");
  });

  test("the Learn picker is fed the shared model list, never a filtered one", () => {
    // The groups handed to LearnModelPicker are the current selection plus
    // whatever /api/models reported, with nothing removed in between.
    assert.match(
      workspaceSource,
      /const learnPanelModelGroups = groupAssistantModels\(\s*Array\.from\(new Set\(\[learnPanelModel, \.\.\.models\]\)\),\s*\);/,
    );
    assert.match(workspaceSource, /groups=\{learnPanelModelGroups\}/);
  });

  test("the generate route accepts a web model id like any other", () => {
    assert.equal(
      resolveLearnRequestModel({ model: "openaiweb/gpt-5-6" }, "gpt-5.6-sol"),
      "openaiweb/gpt-5-6",
    );
    // The sentinels stay refused: a Learn run names one concrete model.
    assert.throws(() => resolveLearnRequestModel({ model: "default" }, "gpt-5.6-sol"));
  });
});
