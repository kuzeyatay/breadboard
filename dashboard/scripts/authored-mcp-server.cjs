// Bread writes the tool bodies. This stdio host owns the protocol and each server's
// private state. Only JSON crosses the WebAssembly interpreter boundary.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { ListToolsRequestSchema, CallToolRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline } = require("quickjs-emscripten-core");
const variant = require("@jitl/quickjs-singlefile-cjs-release-sync").default;

async function main() {
  const [filename, digest] = process.argv.slice(2);
  const bytes = fs.readFileSync(filename);
  if (createHash("sha256").update(bytes).digest("hex") !== digest) throw Error("Server definition has changed.");
  const definition = JSON.parse(bytes);
  const engine = await newQuickJSWASMModuleFromVariant(variant);
  const options = () => ({ memoryLimitBytes: 16 * 1024 * 1024, maxStackSizeBytes: 256 * 1024,
    shouldInterrupt: shouldInterruptAfterDeadline(Date.now() + 1000), type: "global" });
  const handlers = new Map();
  for (const tool of definition.tools) {
    const fn = "(function(args, state) { 'use strict';\n" + tool.code + "\n})";
    engine.evalCode("typeof " + fn, options());
    handlers.set(tool.name, { tool, fn });
  }
  const probing = process.argv[4] === "--probe";
  const db = new DatabaseSync(probing ? ":memory:" : path.join(path.dirname(filename), "state.sqlite"));
  db.exec("PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)");
  const read = db.prepare("SELECT value FROM state WHERE id=1");
  const write = db.prepare("INSERT INTO state VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value");
  const server = new Server({ name: definition.name, version: digest.slice(0, 12) }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: definition.tools.map(({ name, description, inputSchema, readOnly }) => ({
      name, description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const handler = handlers.get(params.name);
    if (!handler) throw Error("Unknown tool.");
    const { tool, fn } = handler;
    const argsObject = params.arguments ?? {};
    for (const key of tool.inputSchema.required) {
      if (!Object.hasOwn(argsObject, key)) throw Error("Missing argument: " + key);
    }
    for (const [key, value] of Object.entries(argsObject)) {
      const type = tool.inputSchema.properties[key]?.type;
      const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
      if (type === "integer" ? !Number.isInteger(value) : actual !== type) throw Error("Unexpected argument or type: " + key);
    }
    // The installation probe exercises real code against an empty, disposable
    // state. A tool that normally writes can be tested without duplicating work.
    const persist = !probing && !tool.readOnly;
    if (persist) db.exec("BEGIN IMMEDIATE");
    try {
      const state = probing ? "{}" : read.get()?.value ?? "{}";
      const args = JSON.stringify(params.arguments ?? {});
      const expression = "(() => { const state = JSON.parse(" + JSON.stringify(state) + "); " +
        "const result = " + fn + "(JSON.parse(" + JSON.stringify(args) + "), state); " +
        "if (result === undefined || typeof result?.then === 'function') throw Error('Return a synchronous JSON value'); " +
        "return JSON.stringify({result" + (persist ? ",state" : "") + "}); })()";
      const encoded = engine.evalCode(expression, options());
      if (typeof encoded !== "string" || Buffer.byteLength(encoded) > 512 * 1024) throw Error("Tool result or state exceeds 512 KiB.");
      const output = JSON.parse(encoded);
      if (!Object.hasOwn(output, "result")) throw Error("Tool did not return JSON.");
      if (persist) {
        write.run(JSON.stringify(output.state));
        db.exec("COMMIT");
      }
      return { content: [{ type: "text", text: JSON.stringify(output.result) }] };
    } catch (error) {
      if (persist) db.exec("ROLLBACK");
      return { isError: true, content: [{ type: "text", text: String(error?.message ?? error).slice(0, 500) }] };
    }
  });
  await server.connect(new StdioServerTransport());
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
