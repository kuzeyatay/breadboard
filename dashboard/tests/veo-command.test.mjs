import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-veo-command-"));
process.env.BREADBOARD_DATA_DIR = data;
process.env.HERMES_FIRST_PARTY_SKILLS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../hermes-skills/prebuilt");
const { default: db } = await import("../src/lib/db.ts");
const { resolveCommandMessage } = await import("../src/lib/hermes/commands.ts");
const { getAgentRuntime } = await import("../src/lib/agent-runtime/runtime.ts");
const { parseMcpConfig, saveMcpConnection } = await import("../src/lib/hermes/mcp-connections.ts");
db.prepare("INSERT INTO users(id, username, email, password_hash) VALUES (1, 'veo', 'veo@example.test', 'x')").run();
after(() => { db.close(); fs.rmSync(data, { recursive: true, force: true }); });

test("/veo resolves the Featured skill and automatically selects only its Flow connection", async t => {
  saveMcpConnection(1, parseMcpConfig({
    displayName: "Google Flow", slug: "google-flow", transport: "remote", url: "https://flow.example.test/mcp", oauth: false,
  }));
  const runtime = getAgentRuntime();
  const added = t.mock.method(runtime, "addMcpConnection", async () => {});
  const tools = ["google-flow_flow_help", "google-flow_flow_list_accounts", "google-flow_flow_generate_video", "google-flow_flow_job_status", "unrelated_search"];
  t.mock.method(runtime, "listCapabilities", async () => ({
    tools, mcp: { "google-flow": { status: "connected" }, unrelated: { status: "connected" } },
  }));
  const result = await resolveCommandMessage(1, "/veo a lighthouse in a storm", data, { mode: "knowledge", surface: "garden_chat" });
  assert.deepEqual(added.mock.calls.map(call => call.arguments[1]), ["google-flow"]);
  assert.deepEqual(result.invocations.map(({ kind, slug }) => [kind, slug]), [["skill", "veo"], ["mcp", "google-flow"]]);
  assert.equal(result.userText, "a lighthouse in a storm");
  assert.equal(result.tools["google-flow_flow_generate_video"], true);
  assert.equal(result.tools.unrelated_search, false);
  assert.match(result.text, /Reviewed skill guidance: veo/);
  assert.match(result.text, /automatically attached the skill's required connection: google-flow/);
  assert.match(result.text, /sourceSkill="veo"/);
});
