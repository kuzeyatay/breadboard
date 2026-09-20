import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import {
  chatgptWebBootstrapUrl,
  isChatgptWebBootstrapUrl,
  resolveDebuggingTargetId,
} from "../src/main/browser-agent-session";
import { isChatgptWebTabRequest } from "../src/shared/ipc-contract";

const nonce = "0123456789abcdef0123456789abcdef";

test("the ChatGPT tab bootstrap document is inert and nonce-specific", () => {
  const url = chatgptWebBootstrapUrl(nonce);
  assert.equal(url, `about:blank#breadboard-chatgpt-web=${nonce}`);
  assert.equal(isChatgptWebBootstrapUrl(url), true);
  assert.equal(isChatgptWebBootstrapUrl("about:blank#breadboard-chatgpt-web=short"), false);
  assert.equal(isChatgptWebBootstrapUrl("https://chatgpt.com/"), false);
  assert.throws(() => chatgptWebBootstrapUrl("not-a-nonce"), /nonce/u);
});

test("a tab request is a plain object with a boolean foreground and an optional reset", () => {
  assert.equal(isChatgptWebTabRequest({ foreground: true }), true);
  assert.equal(isChatgptWebTabRequest({ foreground: true, reset: true }), true);
  assert.equal(isChatgptWebTabRequest({ foreground: false, reset: undefined }), true);
  assert.equal(isChatgptWebTabRequest({ foreground: true, reset: "yes" }), false);
  assert.equal(isChatgptWebTabRequest({ foreground: "yes" }), false);
  assert.equal(isChatgptWebTabRequest(null), false);
  assert.equal(isChatgptWebTabRequest([true]), false);
});

test("a tab request may name a lane, which is a short slug", () => {
  assert.equal(isChatgptWebTabRequest({ foreground: false, lane: "interactive" }), true);
  assert.equal(isChatgptWebTabRequest({ foreground: false, lane: "batch" }), true);
  assert.equal(isChatgptWebTabRequest({ foreground: false, lane: "" }), false);
  assert.equal(isChatgptWebTabRequest({ foreground: false, lane: "Not A Lane" }), false);
  assert.equal(isChatgptWebTabRequest({ foreground: false, lane: 7 }), false);
});

async function withFakeDevTools(
  targets: (port: number) => unknown[],
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = http.createServer((request, response) => {
    if (request.url === "/json/list") {
      const port = (server.address() as AddressInfo).port;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(targets(port)));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("the target id is read from the exact bootstrap page, never a look-alike", async () => {
  const url = chatgptWebBootstrapUrl(nonce);
  await withFakeDevTools(
    (port) => [
      { type: "page", id: "OTHER", url: "https://chatgpt.com/", webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/OTHER` },
      { type: "page", id: "REMOTE", url, webSocketDebuggerUrl: `ws://10.0.0.5:${port}/devtools/page/REMOTE` },
      { type: "page", id: "MINE", url, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/MINE` },
    ],
    async (port) => {
      assert.equal(await resolveDebuggingTargetId(port, url, 2_000), "MINE");
      assert.equal(await resolveDebuggingTargetId(port, chatgptWebBootstrapUrl("f".repeat(32)), 300), null);
    },
  );
});

test("an invalid port never resolves", async () => {
  assert.equal(await resolveDebuggingTargetId(80, chatgptWebBootstrapUrl(nonce), 100), null);
});
