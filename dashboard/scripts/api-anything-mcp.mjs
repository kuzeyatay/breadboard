// The same embedded implementation for standalone coding agents and their
// subagents. The host chooses the account; tool arguments cannot change it.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { API_ANYTHING_POLICY, API_ANYTHING_TOOLS } from "./api-anything-contract.mjs";
import { callApiAnythingTool } from "./api-anything-client.mjs";
import fs from "node:fs";
import path from "node:path";

const [user, repoRoot, configuredDataRoot] = process.argv.slice(2);
const publicOnly = user === "public";
const userId = publicOnly ? 1 : Number(user);
let dataRoot = configuredDataRoot;
if (!Number.isSafeInteger(userId) || userId < 1 || !repoRoot || !dataRoot) throw new Error("Missing website API host scope.");
// Shared upstream services have no per-user tool boundary. Give those services
// only the bundled public catalog, in a fresh empty home, never a person's jar.
if (publicOnly) {
  const parent = path.join(dataRoot, "runtime-v2", "api-anything", "public");
  fs.mkdirSync(parent, { recursive: true });
  dataRoot = fs.mkdtempSync(path.join(parent, "session-"));
  process.once("exit", () => { fs.rmSync(dataRoot, { recursive: true, force: true }); });
}
const server = new Server({ name: "breadboard-api-anything", version: "1.0.0" },
  { capabilities: { tools: {} }, instructions: API_ANYTHING_POLICY });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: API_ANYTHING_TOOLS.map(tool => ({ ...tool,
  annotations: { readOnlyHint: tool.name !== "call_operation", openWorldHint: tool.name === "call_operation" } })) }));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const result = await callApiAnythingTool({ userId, repoRoot, dataRoot, tool: request.params.name,
    args: request.params.arguments ?? {}, signal: extra.signal });
  return { content: [{ type: "text", text: JSON.stringify(result) }], isError: result.ok === false };
});
await server.connect(new StdioServerTransport());
