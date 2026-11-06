import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

test("Hermes resolves saved notes and reads bounded, owned creation evidence", async (t) => {
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    const candidate = specifier.startsWith("@/")
      ? new URL(`../src/${specifier.slice(2)}${path.extname(specifier) ? "" : ".ts"}`, import.meta.url)
      : /^\.{1,2}\//.test(specifier) && !path.extname(specifier) && context.parentURL?.startsWith("file:")
        ? new URL(`${specifier}.ts`, context.parentURL) : null;
    if (candidate && fs.existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    return nextResolve(specifier, context);
  } });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-page-history-"));
  process.env.BREADBOARD_DATA_DIR = root;
  process.env.QUARTZ_CONTENT_PATH = path.join(root, "content");
  process.env.BREADBOARD_EMBEDDINGS = "off";
  const { default: db } = await import("../src/lib/db.ts");
  const { executeGardenTool } = await import("../src/lib/hermes/garden-tools.ts");
  const { issueCapabilityToken } = await import("../src/lib/hermes/capability-token.ts");
  t.after(() => { hooks.deregister(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const user = name => Number(db.prepare("INSERT INTO users (username,email,password_hash) VALUES (?,?,?)").run(name, `${name}@example.test`, "unused").lastInsertRowid);
  const owner = user("owner");
  const visitor = user("visitor");
  const gardenId = Number(db.prepare("INSERT INTO clusters (user_id,name,slug) VALUES (?,?,?)").run(owner, "EM 1", "em1").lastInsertRowid);
  const folder = path.join(root, "content/em1/Introduction");
  fs.mkdirSync(folder, { recursive: true });
  const slug = "fields-vectors-and-cartesian-coordinates-1790174177632";
  const relPath = `Introduction/${slug}.md`;
  const markdown = `---\ntitle: "Fields, vectors, and Cartesian coordinates"\nknowledge_type: user-note\nsource: user-note\ndate: "2026-09-23"\n---\n# Fields, vectors, and Cartesian coordinates\nA vector field assigns a vector at each location. Cartesian coordinates describe these locations.\n`;
  fs.writeFileSync(path.join(folder, `${slug}.md`), markdown);
  fs.writeFileSync(path.join(folder, "draft.md"), markdown.replace("knowledge_type: user-note", "knowledge_type: user-note\ndraft: true"));
  fs.writeFileSync(path.join(folder, "private.md"), markdown.replace("knowledge_type: user-note", "knowledge_type: generated-note\ninternal: true"));
  fs.writeFileSync(path.join(folder, "generated.md"), markdown.replace("knowledge_type: user-note", "knowledge_type: generated-note"));
  const token = (userId = owner, surface = "garden_chat", allowedTools = ["garden_search", "garden_get_page", "garden_get_page_context"]) => issueCapabilityToken({
    userId, surface, hermesSessionId: "history-test", gardenId: "em1", allowedTools,
  });
  const call = (args = {}, rawToken = token()) => executeGardenTool({ rawToken, tool: "garden_get_page_context", args: { slug: relPath, includeHistory: true, ...args } });
  const conversation = (publicId, userId = owner, temporary = 0) => Number(db.prepare(
    "INSERT INTO conversations (public_id,user_id,title,default_garden_id,surface,temporary) VALUES (?,?,?,?,'garden_chat',?)",
  ).run(publicId, userId, `Chat ${publicId}`, gardenId, temporary).lastInsertRowid);
  const message = (id, order, role, content, evidence) => db.prepare(`INSERT INTO conversation_messages
    (conversation_id,client_message_id,role,surface,content,status,order_index,metadata)
    VALUES (?, ?, ?, 'garden_chat', ?, 'complete', ?, ?)`).run(id, `message-${order}`, role, content, order,
      evidence === undefined ? null : JSON.stringify({ verification: { evidence } }));
  const save = (garden = "em1", resultPath = `${slug}.md`) => ({ success: true, timestamp: "2026-09-23T14:36:19Z",
    details: { toolName: "garden_save_note", args: { gardenId: garden, title: "Fields, vectors, and Cartesian coordinates" },
      result: { gardenId: garden, saved: true, relPath: resultPath } } });
  const chat = conversation("conv_origin");
  message(chat, 0, "user", "Combine my introduction notes with Engineering Electromagnetics; end at Cartesian coordinates.");
  message(chat, 1, "user", "api_key=do-not-expose-this");
  message(chat, 2, "user", "Create a new markdown with that.");
  message(chat, 3, "assistant", "Saved the note.", [save()]);
  message(chat, 4, "assistant", "Unrelated Garden write.", [save("other-garden")]);
  message(chat, 5, "assistant", "Failed save is not a creation.", [{ ...save(), success: false }]);
  const privateChat = conversation("conv_other", visitor);
  message(privateChat, 0, "assistant", "other-user-content", [save()]);
  const temporary = conversation("conv_temporary", owner, 1);
  message(temporary, 0, "assistant", "temporary-content", [save()]);
  const edit = Number(db.prepare(`INSERT INTO hermes_proposals
    (garden_id,surface,kind,page_slug,payload,status,created_by_user_id) VALUES ('em1','garden_chat','page_revision',?,'{}','pending',?)`)
    .run(slug, owner).lastInsertRowid);
  const editChat = conversation("conv_revision");
  message(editChat, 0, "user", "Add Cartesian products from Math 1.");
  message(editChat, 1, "assistant", "Proposed an edit.", [{ success: true, details: { toolName: "garden_propose_page_revision",
    args: { gardenId: "em1", pageSlug: slug, rationale: "Explain Cartesian products." }, result: { proposalId: edit } } }]);

  await t.test("title/topic search includes user and generated notes but excludes drafts and internal pages", async () => {
    const found = await executeGardenTool({ rawToken: token(), tool: "garden_search", args: { query: "fields vector and cratesion coordinates" } });
    assert.equal(found.ok, true, JSON.stringify(found));
    assert.ok(found.data.chunks.some(chunk => chunk.relPath === relPath), JSON.stringify(found.data));
    assert.ok(found.data.chunks.some(chunk => chunk.relPath === "Introduction/generated.md"));
    assert.ok(found.data.chunks.every(chunk => !["Introduction/draft.md", "Introduction/private.md"].includes(chunk.relPath)));
  });
  await t.test("moved note resolves save, original requests, and proposal status", async () => {
    const result = await call();
    assert.equal(result.ok, true, JSON.stringify(result));
    const history = result.data.history;
    assert.deepEqual(history.events.map(event => event.status), ["saved", "failed", "pending"]);
    assert.equal(history.events[0].identityMatch, "unique_slug");
    assert.equal(history.events[0].pathAtTime, `${slug}.md`);
    assert.equal(history.events[0].conversationRef, "conv_origin");
    assert.match(JSON.stringify(history.conversations), /Engineering Electromagnetics/);
    assert.doesNotMatch(JSON.stringify(history), /do-not-expose|other-user-content|temporary-content|conv_other|conv_temporary/);
    db.prepare("UPDATE hermes_proposals SET status='applied',decided_at='2026-09-24' WHERE id=?").run(edit);
    assert.equal((await call()).data.history.events.at(-1).status, "applied");
    assert.equal(fs.readFileSync(path.join(folder, `${slug}.md`), "utf8"), markdown, "History never rewrites notes");
  });
  await t.test("history cannot be read through public, non-owner, out-of-scope or ungranted calls", async () => {
    for (const rawToken of [token(visitor), token(owner, "quartz_ai"), token(owner, "garden_chat", ["garden_get_page"])]) {
      const result = await call({}, rawToken);
      assert.equal(result.ok, false);
      assert.equal(result.data, undefined);
    }
    assert.equal((await call({ gardenId: "other-garden" })).ok, false);
    const missing = await call({ slug: "fields-vector-cratesion-coordinates" });
    assert.equal(missing.ok, false);
    assert.ok(missing.data.availableMatches.some(entry => entry.relPath === relPath));
  });
  await t.test("same basenames do not attribute one page's history to another", async () => {
    fs.mkdirSync(path.join(root, "content/em1/Other"));
    fs.writeFileSync(path.join(root, "content/em1/Other", `${slug}.md`), markdown);
    assert.deepEqual((await call()).data.history.events, []);
    fs.unlinkSync(path.join(root, "content/em1/Other", `${slug}.md`));
  });
  await t.test("history pages remain bounded and complete without duplicate events", async () => {
    for (let i = 6; i < 70; i++) message(chat, i, "assistant", "Recorded move", [{ success: true,
      details: { toolName: "garden_move_page", args: { slug: relPath }, result: { gardenId: "em1", moved: true, relPath } } }]);
    const ids = [];
    let historyOffset = 0;
    do {
      const result = await call({ historyOffset });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.ok(result.data.history.events.length <= 12);
      ids.push(...result.data.history.events.map(event => event.messageId));
      historyOffset = result.data.history.nextOffset;
    } while (historyOffset !== null);
    assert.equal(ids.length, 67);
    assert.equal(new Set(ids).size, ids.length);
  });
});
