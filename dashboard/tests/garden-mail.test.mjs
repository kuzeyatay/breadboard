import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test, { after } from "node:test";
import AdmZip from "adm-zip";
import { build } from "esbuild";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-garden-mail-"));
process.env.BREADBOARD_DATA_DIR = root;
process.env.QUARTZ_CONTENT_PATH = path.join(root, "content");
const { default: db } = await import("../src/lib/db.ts");
const { connectedActionWithGardenAttachments, readMailAttachment } = await import("../src/lib/garden-transfer/mail.ts");
const { buildNangoActionInvocation, nangoAction } = await import("../src/lib/nango/actions.ts");
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

const userId = Number(db.prepare("INSERT INTO users (username, email, password_hash) VALUES ('mailtest','mail@example.com','x')").run().lastInsertRowid);
const otherId = Number(db.prepare("INSERT INTO users (username, email, password_hash) VALUES ('other','other@example.com','x')").run().lastInsertRowid);
const gardenId = Number(db.prepare("INSERT INTO clusters (user_id, name, slug) VALUES (?, 'EM1', 'em1')").run(userId).lastInsertRowid);
fs.mkdirSync(path.join(root, "content/em1"), { recursive: true });
fs.writeFileSync(path.join(root, "content/em1/lecture.md"), "# Electromagnetism\n");
const args = { to: ["reader@example.com"], subject: "EM1 garden", body: "Here is EM1.", gardenSlugs: ["em1"] };

test("Gmail send and draft actions expose Garden attachments to natural-language turns", () => {
  for (const name of ["gmail_send_message", "gmail_create_draft"]) {
    assert.ok(nangoAction(name).inputSchema.properties.gardenSlugs);
    assert.throws(() => buildNangoActionInvocation(name, args), /authorized Garden scope/);
  }
});

test("an authorized mail request contains the actual round-trippable garden bytes", async () => {
  const result = await connectedActionWithGardenAttachments({ userId, allowedGardenIds: [gardenId], action: "gmail_send_message", args });
  assert.equal(result.request.endpoint, "/gmail/v1/users/me/messages/send");
  const mime = Buffer.from(result.request.body.raw, "base64url").toString("utf8");
  assert.match(mime, /To: reader@example.com/);
  assert.match(mime, /Here is EM1\./);
  assert.match(mime, /Content-Disposition: attachment; filename="em1.garden"/);
  const encoded = mime.match(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/)[1];
  const zip = new AdmZip(Buffer.from(encoded.replace(/\s/g, ""), "base64"));
  assert.equal(zip.readAsText("content/lecture.md"), "# Electromagnetism\n");
  assert.equal(JSON.parse(zip.readAsText("garden.json")).name, "EM1");
});

test("drafts retain the thread and duplicate garden slugs attach only once", async () => {
  const result = await connectedActionWithGardenAttachments({ userId, allowedGardenIds: [gardenId], action: "gmail_create_draft", args: { ...args, gardenSlugs: ["em1", "em1"], threadId: "thread-1" } });
  assert.equal(result.request.body.message.threadId, "thread-1");
  const mime = Buffer.from(result.request.body.message.raw, "base64url").toString();
  assert.equal(mime.match(/Content-Disposition: attachment/g).length, 1);
});

test("ownership and conversation scope are both required before exporting mail", async () => {
  for (const scope of [{ userId, allowedGardenIds: [] }, { userId }, { userId: otherId, allowedGardenIds: [gardenId] }]) {
    await assert.rejects(connectedActionWithGardenAttachments({ ...scope, action: "gmail_send_message", args }), /authorized set/);
  }
  await assert.rejects(connectedActionWithGardenAttachments({ userId, allowedGardenIds: [gardenId], action: "gmail_send_message", args: { ...args, gardenSlugs: ["missing"] } }), /authorized set/);
});

test("malformed recipients, unrecognized fields, and malformed garden lists fail before sending", async () => {
  for (const change of [{ to: ["reader@example.com\r\nBcc: injected@example.com"] }, { gardenSlugs: "em1" }, { attachmentPath: "C:/private.txt" }]) {
    await assert.rejects(connectedActionWithGardenAttachments({ userId, allowedGardenIds: [gardenId], action: "gmail_send_message", args: { ...args, ...change } }));
  }
});

test("mail size overflow destroys the stream and reports that no email was sent", async () => {
  const stream = Readable.from([Buffer.alloc(10), Buffer.alloc(10)]);
  await assert.rejects(readMailAttachment(stream, 15), /Gmail.*attachment limit.*No email was sent/);
  assert.equal(stream.destroyed, true);
});

test("a recipient spelling is preserved exactly, never autocorrected", async () => {
  const result = await connectedActionWithGardenAttachments({ userId, action: "gmail_send_message", args: { ...args, gardenSlugs: [], to: ["kuzeyataty@gmsil.com"] } });
  assert.match(Buffer.from(result.request.body.raw, "base64url").toString(), /To: kuzeyataty@gmsil.com/);
});

test("the connected Gmail executor forwards attachments and rejects provider failures", async () => {
  const output = path.join(root, "executor.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/composio/executor.ts", import.meta.url))],
    outfile: output, bundle: true, platform: "node", format: "esm", packages: "external",
    plugins: [{ name: "fake-gmail-provider", setup(builder) {
      builder.onResolve({ filter: /^server-only$/ }, () => ({ path: "empty", namespace: "provider-test" }));
      builder.onResolve({ filter: /^\.\/(client|service)\.ts$/ }, ({ path }) => ({ path, namespace: "provider-test" }));
      builder.onResolve({ filter: /^\.\.\/(garden-transfer\/mail|hermes\/route-core|calendar\/instance)\.ts$/ }, ({ path: relative, resolveDir }) => ({ path: pathToFileURL(path.resolve(resolveDir, relative)).href, external: true }));
      builder.onLoad({ filter: /.*/, namespace: "provider-test" }, ({ path }) => ({
        contents: path === "empty" ? "" : path.includes("client")
          ? "export const composioClient = () => ({ tools: { proxyExecute: async request => { globalThis.gardenMailProxyCalls.push(request); return globalThis.gardenMailProxyResult; } } });"
          : "export const resolveComposioConnection = async () => ({ slug: 'gmail', connectionId: 'test-account' });",
      }));
    } }],
  });
  const { executeComposioAction } = await import(pathToFileURL(output).href);
  globalThis.gardenMailProxyCalls = [];
  globalThis.gardenMailProxyResult = { status: 200, data: { id: "sent-message-1" } };
  try {
    const input = { userId, allowedGardenIds: [gardenId], action: "gmail_send_message", args };
    const result = await executeComposioAction(input);
    assert.equal(result.data.id, "sent-message-1");
    assert.equal(globalThis.gardenMailProxyCalls.length, 1);
    assert.match(Buffer.from(globalThis.gardenMailProxyCalls[0].body.raw, "base64url").toString(), /filename="em1.garden"/);
    await assert.rejects(executeComposioAction({ ...input, allowedGardenIds: [] }), /authorized set/);
    assert.equal(globalThis.gardenMailProxyCalls.length, 1);
    globalThis.gardenMailProxyResult = { status: 413, data: { error: "too large" } };
    await assert.rejects(executeComposioAction(input), /rejected the request/);
    globalThis.gardenMailProxyResult = { status: 200, data: {} };
    await assert.rejects(executeComposioAction(input), /Check Gmail before retrying/);
  } finally {
    delete globalThis.gardenMailProxyCalls;
    delete globalThis.gardenMailProxyResult;
  }
});
