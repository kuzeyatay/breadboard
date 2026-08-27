import fs from "node:fs";
import readline from "node:readline";

if (process.env.FAKE_MCP_COUNTER) {
  fs.appendFileSync(process.env.FAKE_MCP_COUNTER, "started\n", "utf8");
}

const lines = readline.createInterface({ input: process.stdin });

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "runtime-v2-test-mcp", version: "1" },
      },
    });
    return;
  }
  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [{
          name: "echo",
          description: "Echo bounded arguments.",
          inputSchema: { type: "object", properties: { text: { type: "string" } } },
          annotations: { readOnlyHint: true },
        }],
      },
    });
    return;
  }
  if (message.method === "notifications/cancelled") {
    if (process.env.FAKE_MCP_CANCEL_COUNTER) {
      fs.appendFileSync(process.env.FAKE_MCP_CANCEL_COUNTER, "cancelled\n", "utf8");
    }
    return;
  }
  if (message.method === "tools/call") {
    const reply = () => send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: String(message.params?.arguments?.text ?? "") }],
      },
    });
    const delayMs = Number(message.params?.arguments?.delayMs ?? 0);
    if (Number.isSafeInteger(delayMs) && delayMs > 0 && delayMs <= 5_000) {
      setTimeout(reply, delayMs);
    } else {
      reply();
    }
  }
});
