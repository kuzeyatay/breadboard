import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import db from "../src/lib/db.ts";
import { authorizeQuartzAccess } from "../src/lib/openharness/quartz-support.ts";

// Exercises the REAL authorization code against the REAL schema using uniquely
// named throwaway rows, cleaned up afterward. Tests: Quartz public/private
// access rules and the ON DELETE CASCADE from chat_sessions to runtime sessions.

const P = "__test_oh__";
let userId;
const ids = { pubChat: null, pubNoChat: null, priv: null };

function cleanup() {
  db.prepare("DELETE FROM openharness_runtime_sessions WHERE workspace_key LIKE ?").run(`${P}%`);
  db.prepare("DELETE FROM chat_sessions WHERE title LIKE ?").run(`${P}%`);
  db.prepare("DELETE FROM clusters WHERE slug LIKE ?").run(`${P}%`);
  db.prepare("DELETE FROM users WHERE username LIKE ?").run(`${P}%`);
}

before(() => {
  cleanup();
  const u = db
    .prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)")
    .run(`${P}owner`, `${P}owner@x.com`, "h");
  userId = Number(u.lastInsertRowid);
  ids.pubChat = Number(
    db.prepare("INSERT INTO clusters (user_id, name, slug, visibility, chat_accessible) VALUES (?, ?, ?, 'public', 1)")
      .run(userId, "Pub Chat", `${P}pubchat`).lastInsertRowid,
  );
  ids.pubNoChat = Number(
    db.prepare("INSERT INTO clusters (user_id, name, slug, visibility, chat_accessible) VALUES (?, ?, ?, 'public', 0)")
      .run(userId, "Pub NoChat", `${P}pubnochat`).lastInsertRowid,
  );
  ids.priv = Number(
    db.prepare("INSERT INTO clusters (user_id, name, slug, visibility, chat_accessible) VALUES (?, ?, ?, 'private', 0)")
      .run(userId, "Private", `${P}priv`).lastInsertRowid,
  );
});

after(cleanup);

test("public garden with AI enabled: anonymous access allowed", () => {
  const result = authorizeQuartzAccess(`${P}pubchat`, null);
  assert.equal(result.isOwner, false);
  assert.equal(result.cluster.slug, `${P}pubchat`);
});

test("public garden with AI disabled: anonymous access forbidden (403)", () => {
  assert.throws(() => authorizeQuartzAccess(`${P}pubnochat`, null), (err) => err.status === 403);
});

test("private garden without authorization: forbidden", () => {
  assert.throws(() => authorizeQuartzAccess(`${P}priv`, null), (err) => err.status === 403);
});

test("private garden with the owner authenticated: allowed", () => {
  const result = authorizeQuartzAccess(`${P}priv`, userId);
  assert.equal(result.isOwner, true);
});

test("a different authenticated user cannot reach a private garden", () => {
  const otherId = Number(
    db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)")
      .run(`${P}other`, `${P}other@x.com`, "h").lastInsertRowid,
  );
  assert.throws(() => authorizeQuartzAccess(`${P}priv`, otherId), (err) => err.status === 403);
});

test("unknown garden reports not found (404)", () => {
  assert.throws(() => authorizeQuartzAccess(`${P}nope`, null), (err) => err.status === 404);
});

test("deleting a chat session cascades to its runtime session (no orphaned runtime access)", () => {
  const cs = Number(
    db.prepare("INSERT INTO chat_sessions (cluster_id, user_id, title) VALUES (?, ?, ?)")
      .run(ids.pubChat, userId, `${P}session`).lastInsertRowid,
  );
  const rt = Number(
    db.prepare(
      "INSERT INTO openharness_runtime_sessions (surface, user_id, chat_session_id, agent_name, cluster_id, garden_id, workspace_key) VALUES ('garden_chat', ?, ?, 'breadboard-garden', ?, ?, ?)",
    ).run(userId, cs, ids.pubChat, `${P}pubchat`, `${P}wk`).lastInsertRowid,
  );
  assert.ok(db.prepare("SELECT 1 FROM openharness_runtime_sessions WHERE id = ?").get(rt));
  // Delete the Breadboard chat session.
  db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(cs);
  // The runtime session must be gone (ON DELETE CASCADE), leaving no active
  // runtime access dangling to a deleted conversation.
  assert.equal(db.prepare("SELECT 1 FROM openharness_runtime_sessions WHERE id = ?").get(rt), undefined);
});
