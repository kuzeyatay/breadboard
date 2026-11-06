import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { verifyGoogleFlowSource } from "../../scripts/google-flow-integrity.mjs";

test("Breadboard's exact launch command discovers real Flow tools with an isolated, signed-out store", { timeout: 30_000 }, async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  verifyGoogleFlowSource(root);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-flow-smoke-"));
  const client = new Client({ name: "breadboard-veo-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", pathToFileURL(path.join(root, "scripts", "launch-google-flow.mjs")).href, path.join(root, "google-flow-mcp", "dist", "index.js"), data],
    cwd: path.join(root, "google-flow-mcp"), stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const discovered = await client.listTools();
    assert.equal(discovered.tools.some(tool => /flow_(?:begin|complete)_account_connection/.test(tool.name)), false,
      "the native connection must not expose the external extension workflow");
    for (const name of ["flow_help", "flow_list_accounts", "flow_inspect_account", "flow_generate_video", "flow_job_status", "flow_download_job"]) {
      assert.ok(discovered.tools.some(tool => tool.name === name), `${name} must come from live MCP discovery`);
    }
    const accounts = JSON.parse((await client.callTool({ name: "flow_list_accounts", arguments: {} })).content[0].text);
    assert.equal(accounts.readyForGeneration, false);
    assert.deepEqual(accounts.accounts, []);
    assert.equal(accounts.background, true);
    assert.match(accounts.agentInstruction, /Connect in background/);
    const help = JSON.parse((await client.callTool({ name: "flow_help", arguments: {} })).content[0].text);
    assert.equal(help.ready, false);
    assert.ok(help.capabilities.some(capability => /Veo/.test(capability)));
    assert.ok(fs.statSync(path.join(data, "profiles")).isDirectory());
  } finally {
    await client.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
