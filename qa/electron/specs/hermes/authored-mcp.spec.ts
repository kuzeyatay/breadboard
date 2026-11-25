import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { request } from "@playwright/test";
import { test, expect } from "../../fixtures";

test("Bread codes, installs and uses a server that another chat can read", async ({ qa }) => {
  test.setTimeout(15 * 60_000);
  const page = await qa.dismissWelcome();
  const origin = new URL(page.url()).origin;
  // Keep this API client's login independent of the shell's window replacement on sign-in.
  const client = await request.newContext({ baseURL: origin });
  // Exercise the same authenticated endpoints and message stream as the Garden
  // composer, in a fresh account against the real configured model.
  const post = async (route: string, data: object) => {
    const response = await client.post(route, { data, timeout: route === "/api/chat" ? 360_000 : 90_000 });
    expect(response.status(), (await response.text()).slice(0, 600)).toBeLessThan(300);
    return response;
  };
  await post("/api/register", { name: "MCP QA", password: qa.run.bootstrap.auth.password });
  const { csrfToken } = await (await client.get("/api/auth/csrf")).json();
  const login = await client.post("/api/auth/callback/credentials", {
    form: { csrfToken, password: qa.run.bootstrap.auth.password, json: "true", callbackUrl: origin + "/dashboard" },
    maxRedirects: 0,
  });
  expect(login.status()).toBeLessThan(400);
  const session = await (await client.get("/api/auth/session")).json();
  expect(session.user).toBeTruthy();
  const { slug } = await (await post("/api/clusters", { name: "MCP lab" })).json();
  const newChat = async (title: string) => (await (await post("/api/chat-sessions", { clusterSlug: slug, title })).json()).session.id;
  const ask = async (chatSessionId: number, content: string) => {
    const result = await post("/api/chat", { clusterSlug: slug, chatSessionId, clientMessageId: randomUUID(),
      messages: [{ role: "user", content }], yoloMode: true });
    return result.text();
  };
  const marker = "lab-" + randomUUID();
  const first = await newChat("Author");
  const createReply = await ask(first, `Code a custom MCP server called Lab ledger with put and get tools using private stored state. Install it, then use its put tool to store the value "${marker}" under the key sample. Verify using get.`);
  const db = new DatabaseSync(path.join(qa.run.paths.dataDir, "database/brain.db"), { readOnly: true });
  try {
    expect(db.prepare("SELECT slug FROM hermes_mcp_connections WHERE enabled=1 AND slug='custom-lab-ledger'").get(),
      createReply.slice(-1200)).toBeTruthy();
    const authored = db.prepare("SELECT slug FROM hermes_mcp_connections WHERE slug LIKE 'custom-%' ORDER BY slug").all();
    expect(authored.map(row => row.slug)).toEqual(["custom-lab-ledger"]);
    const second = await newChat("Read ledger");
    expect(second).not.toBe(first);
    const reply = await ask(second, "Use the saved Lab ledger MCP get tool to retrieve the value under sample. Reply with the value.");
    expect(reply).toContain(marker);
    const calls = db.prepare(`SELECT DISTINCT runtime_session_id FROM hermes_audit_events WHERE
      event_type='mcp.tool_completed' AND json_extract(payload, '$.slug')='custom-lab-ledger'
      AND json_extract(payload, '$.success')=1`).all();
    expect(calls).toHaveLength(2);
  } finally {
    db.close();
    await client.dispose();
  }
});
