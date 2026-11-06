// Preload for the unmodified Flow MCP entrypoint. The shell owns the browser.
import path from "node:path";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { installBreadboardFlowBrowser } from "./google-flow-browser.mjs";
const directory = process.argv[2];
if (process.argv.length !== 3 || !directory || !path.isAbsolute(directory)) {
  throw new Error("Google Flow requires an absolute Breadboard account directory.");
}
mkdirSync(directory, { recursive: true, mode: 0o700 });
process.env.FLOW_MCP_DATA_DIR = directory;
installBreadboardFlowBrowser(directory);
// Native account setup belongs to Settings. Do not advertise the upstream
// extension handoff, which copies cookies into an external browser profile.
const { McpServer } = await import(pathToFileURL(path.resolve(path.dirname(process.argv[1]),
  "../node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js")).href);
const register = McpServer.prototype.registerTool;
McpServer.prototype.registerTool = function (name, ...args) {
  if (["flow_begin_account_connection", "flow_complete_account_connection", "flow_login_bridge_status"].includes(name)) return;
  if (name === "flow_list_accounts" || name === "flow_help") {
    const [config, handler] = args;
    return register.call(this, name, config, async (...input) => {
      const result = await handler(...input);
      if (result.isError) return result;
      for (const block of result.content ?? []) {
        if (block.type !== "text") continue;
        const value = JSON.parse(block.text);
        value.browser = "breadboard";
        value.background = true;
        if (name === "flow_list_accounts" && !value.readyForGeneration) value.agentInstruction =
          "No verified Flow account exists. Use Settings → Connections → Google Flow · Veo → Connect in background. Sign in to Google in Breadboard's browser if needed. Never launch an external browser or use an extension handoff.";
        if (name === "flow_help") value.capabilities = value.capabilities
          .filter(line => !/isolated.*(?:profile|session)/i.test(line))
          .concat("Run in a dedicated hidden Breadboard tab using its existing Google sign-in; no extension or API key is needed.");
        block.text = JSON.stringify(value);
      }
      return result;
    });
  }
  return register.call(this, name, ...args);
};
process.argv = process.argv.slice(0, 2);
