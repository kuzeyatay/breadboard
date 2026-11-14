import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { blenderRuntimePaths } from "../scripts/blender-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const paths = blenderRuntimePaths(root, process.env.BREADBOARD_DATA_DIR || path.join(root, "dashboard"));

test("the installed pinned Blender MCP exposes the tools used by the native skill", {
  timeout: 30_000, skip: fs.existsSync(paths.python) ? false : "Run npm run setup:blender to install the optional runtime",
}, async () => {
  const client = new Client({ name: "breadboard-blender-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: paths.python, args: ["-X", "utf8", paths.launcher], cwd: paths.directory, stderr: "pipe" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    for (const name of ["get_addon_status", "get_scene_info", "execute_blender_code", "look"]) {
      assert.ok(tools.some(tool => tool.name === name), `${name} must be discovered from upstream`);
    }
    const execute = tools.find(tool => tool.name === "execute_blender_code");
    assert.ok(execute.inputSchema.required.includes("code"));
    // Read-only: no scene changes even when a user's Blender happens to be open.
    const result = await client.callTool({ name: "get_scene_info", arguments: { fields: ["settings"], limit: 1 } });
    const text = result.content.filter(item => item.type === "text").map(item => item.text).join("\n");
    assert.ok(text.length > 0);
    if (/^Error/i.test(text)) assert.match(text, /connect|Blender|refused|socket/i);
  } finally {
    await client.close();
  }
});
