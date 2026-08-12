import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import { resolveCommandMessage } from "../src/lib/hermes/commands.ts";

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("Save to Garden is a ready prebuilt skill on both authenticated chat surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find(
      (candidate) => candidate.slug === "save-to-garden",
    );
    assert.ok(skill, `missing on ${surface}`);
    assert.equal(skill.availability, "ready");
    assert.equal(skill.category, "Prebuilt");
    assert.deepEqual(skill.capabilityContract?.requiredTools, [
      "garden_list",
      "garden_save_note",
    ]);
  }
  assert.equal(
    listFirstPartySkills("quartz_ai").some(
      (skill) => skill.slug === "save-to-garden" && skill.availability === "ready",
    ),
    false,
  );
});

test("Save to Garden captures a response and an explicit Garden folder", () => {
  const manifest = source("../hermes-skills/prebuilt/save-to-garden/SKILL.md");
  const adapter = source("../hermes-config/tool/garden.ts");
  const gardenTools = source("src/lib/hermes/garden-tools.ts");

  assert.match(manifest, /most recent substantive assistant answer/);
  assert.match(manifest, /garden_list/);
  assert.match(manifest, /garden_save_note/);
  assert.match(manifest, /Pass the requested nested folder as `folder`/);
  assert.match(adapter, /folder: tool\.schema\.string\(\)/);
  assert.match(adapter, /folder: args\.folder/);
  assert.match(gardenTools, /folder: proposalFolder\(args\.folder\)/);
  assert.match(gardenTools, /content: String\(args\.content/);
});

test("selecting the skill saves the note instead of queueing a review", () => {
  const manifest = source("../hermes-skills/prebuilt/save-to-garden/SKILL.md");
  const gardenTools = source("src/lib/hermes/garden-tools.ts");

  // The user selecting /save-to-garden IS the approval; a proposal would only
  // ask them for it a second time.
  assert.match(manifest, /Call `garden_save_note` exactly once/);
  assert.doesNotMatch(manifest, /Call `garden_create_note_proposal`/);
  assert.match(manifest, /do not turn it into a proposal/);

  // The write goes through the same canonical document service the authoring UI
  // and an applied proposal use — not a second markdown writer.
  assert.match(gardenTools, /const \{ createGardenDocument \} = await import\("\.\.\/garden-documents\.ts"\)/);
  assert.match(gardenTools, /clusterSlug: cluster\.slug/);
});

test("direct saving is confined to a signed-in owner adding a new note", () => {
  const gardenTools = source("src/lib/hermes/garden-tools.ts");
  const scopes = source("src/lib/hermes/tool-scopes.ts");

  // Anonymous Quartz readers and non-owners keep the proposal path; nothing
  // about this tool can edit or overwrite existing pages.
  assert.match(
    gardenTools,
    /token\.surface !== "dashboard_terminal" && token\.surface !== "garden_chat"/,
  );
  assert.match(gardenTools, /token\.userId !== cluster\.user_id/);
  assert.equal(gardenTools.includes("garden_save_note"), true);
  assert.equal(
    /PROPOSAL_TOOLS: readonly string\[\] = \[[^\]]*garden_save_note/.test(scopes),
    false,
    "a direct write must not be classified as a proposal tool",
  );

  const quartzTools = scopes.slice(
    scopes.indexOf("export const QUARTZ_TOOLS"),
    scopes.indexOf("export const GBRAIN_TOOLS"),
  );
  assert.equal(
    quartzTools.includes("garden_save_note"),
    false,
    "public Quartz AI must never reach the direct writer",
  );
});

test("the slash command injects reviewed guidance without changing the user's request", async () => {
  const resolved = await resolveCommandMessage(
    1,
    "/save-to-garden add this to Physics under Week 3",
    process.cwd(),
    { mode: "knowledge", surface: "dashboard_terminal" },
  );
  assert.deepEqual(
    resolved.invocations.map((invocation) => invocation.slug),
    ["save-to-garden"],
  );
  assert.equal(resolved.userText, "add this to Physics under Week 3");
  assert.match(resolved.text, /Reviewed skill guidance: Save response to Garden/);
  assert.match(resolved.text, /\[User request\]\nadd this to Physics under Week 3/);
});

test("the conversation that proposes a note can also review it", () => {
  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  const cards = source("src/app/components/hermes/inline-proposal-cards.tsx");
  const route = source("src/app/api/hermes/proposals/route.ts");
  const store = source("src/lib/hermes/runtime-store.ts");

  // The Terminal has no proposals tab, so the transcript itself must offer the
  // decision; it is shared with Garden Chat and skipped for public readers.
  assert.match(panel, /<InlineProposalCards/);
  assert.match(panel, /conversationId=\{sessionId\}/);
  assert.match(panel, /surface !== "quartz_ai" \? \(\s*\/\/ Garden proposals/);

  // Deciding goes through the owner-checked canonical endpoint, never a
  // second write path.
  assert.match(cards, /\/api\/gardens\/\$\{encodeURIComponent\(proposal\.gardenId\)\}\/proposals\/\$\{proposal\.id\}/);
  assert.match(cards, /decision/);
  assert.match(cards, /GARDEN_DOCUMENTS_CHANGED_EVENT/);

  // Listing is scoped and owner-only: no pending proposal is offered for a
  // garden the viewer cannot decide on.
  assert.match(route, /proposal_scope_required/);
  assert.match(route, /getConversationForUser\(conversationId, userId\)/);
  assert.match(route, /if \(!isOwner\) return \[\];/);
  assert.match(store, /p\.status = 'pending'/);
  assert.match(store, /p\.created_by_user_id = \?/);
});

test("applying a note proposal performs the canonical Garden write before closing it", () => {
  const proposalRoute = source(
    "src/app/api/gardens/[gardenId]/proposals/[proposalId]/route.ts",
  );
  const documentRoute = source("src/app/api/documents/route.ts");
  const documentService = source("src/lib/garden-documents.ts");
  const gardenChat = source("src/app/components/hermes/garden-agent-chat.tsx");

  assert.match(proposalRoute, /proposal\.kind === "note"/);
  assert.ok(
    proposalRoute.indexOf("await createGardenDocument") <
      proposalRoute.indexOf("setProposalStatus(id, decision)"),
    "a failed write must leave the proposal pending",
  );
  assert.match(proposalRoute, /folder: typeof payload\.folder/);
  assert.match(documentRoute, /createGardenDocument/);
  assert.match(documentService, /normalizeGardenFolder/);
  assert.match(documentService, /publishQuartzAfterMutation/);
  assert.match(gardenChat, /GARDEN_DOCUMENTS_CHANGED_EVENT/);
});
