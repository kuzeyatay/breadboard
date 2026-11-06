import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { searchScore, searchSnippet, searchPlaces } from "../src/lib/breadboard-search.ts";

test("search ranking prefers exact titles and requires every query term", () => {
  assert.ok(searchScore("Fourier", "", "fourier") > searchScore("Lecture", "Fourier transform", "fourier"));
  assert.ok(searchScore("Fourier analysis", "", "analysis four") > 0);
  assert.equal(searchScore("Fourier", "", "fourier optics"), 0);
  assert.equal(searchScore("Anything", "", ""), 0);
  assert.equal(searchScore("Anything", "", "%"), 0);
  assert.equal(searchPlaces("settings")[0].title, "Settings");
  assert.equal(searchPlaces("terminal")[0].href, "/new-tab");
  assert.deepEqual(searchPlaces("dashboard"), []);
  assert.deepEqual(searchPlaces("browser"), []);
  assert.match(searchSnippet(`${"introduction ".repeat(100)}Fourier transforms are useful`, "fourier"), /Fourier/);
});

test("Breadboard search finds content across sources and respects ownership", async t => {
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    const candidate = specifier.startsWith("@/")
      ? new URL(`../src/${specifier.slice(2)}${path.extname(specifier) ? "" : ".ts"}`, import.meta.url)
      : /^\.{1,2}\//.test(specifier) && !path.extname(specifier) && context.parentURL?.startsWith("file:")
        ? new URL(`${specifier}.ts`, context.parentURL) : null;
    if (candidate && fs.existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    return nextResolve(specifier, context);
  } });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-launcher-search-"));
  process.env.BREADBOARD_DATA_DIR = root;
  process.env.QUARTZ_CONTENT_PATH = path.join(root, "content");
  const { default: db } = await import("../src/lib/db.ts");
  const { searchBreadboard } = await import("../src/lib/breadboard-search-server.ts");
  const { createRoom, postMessage } = await import("../src/lib/buzz/store.ts");
  t.after(() => { hooks.deregister(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const user = Number(db.prepare("INSERT INTO users (username,email,password_hash) VALUES ('searcher','s@example.test','unused')").run().lastInsertRowid);
  const other = Number(db.prepare("INSERT INTO users (username,email,password_hash) VALUES ('other','o@example.test','unused')").run().lastInsertRowid);
  const gardenIds = {};
  const write = (relative, text) => { const file = path.join(root, "content", relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  for (const [slug, owner, visibility] of [["math", user, "private"], ["physics", user, "private"], ["secret", other, "private"], ["shared", other, "public"]]) {
    gardenIds[slug] = Number(db.prepare("INSERT INTO clusters (user_id,name,slug,visibility) VALUES (?,?,?,?)").run(owner, slug, slug, visibility).lastInsertRowid);
    write(`${slug}/notes/lecture.md`, `---\ntitle: ${slug} lecture\n---\n# Lecture\n${"context ".repeat(500)}Fourier transform applies here.`);
  }
  write("math/sources/chapter.md", "---\ntitle: Fourier textbook\nknowledge_type: source-document\n---\nA Fourier transform textbook.");
  write("math/.private/ignored.md", "Fourier hidden");
  write("math/Internal/Concept Graph/ignored.md", "Fourier internal");
  write("math/index.md", "Fourier index");
  write("math/cafe.md", "---\ntitle: Café\n---\nCoffee notes.");

  const addChat = (owner, title, temporary = 0, surface = "dashboard_terminal", garden = null, legacy = null) => {
    const publicId = `chat-${owner}-${title}`;
    const id = Number(db.prepare("INSERT INTO conversations (public_id,user_id,title,temporary,surface,default_garden_id,legacy_chat_session_id) VALUES (?,?,?,?,?,?,?)")
      .run(publicId, owner, title, temporary, surface, garden, legacy).lastInsertRowid);
    db.prepare("INSERT INTO conversation_messages (conversation_id,client_message_id,role,surface,content,status,order_index) VALUES (?,'m','user',?,?,'complete',0)")
      .run(id, surface, `${"old context ".repeat(800)}The Fourier transform discussion.`);
    return { id, publicId };
  };
  const artifactChat = addChat(user, "Signal discussion");
  addChat(other, "Private discussion");
  addChat(user, "Temporary discussion", 1);
  const legacy = Number(db.prepare("INSERT INTO chat_sessions (cluster_id,user_id,title) VALUES (?,?,'Fourier garden chat')").run(gardenIds.math, user).lastInsertRowid);
  addChat(user, "Garden discussion", 0, "garden_chat", gardenIds.math, legacy);
  const project = Number(db.prepare("INSERT INTO plan_projects (user_id,name,slug) VALUES (?,'Study','study')").run(user).lastInsertRowid);
  const column = Number(db.prepare("INSERT INTO plan_columns (project_id,name,slug) VALUES (?,'Todo','todo')").run(project).lastInsertRowid);
  const task = Number(db.prepare("INSERT INTO plan_tasks (user_id,project_id,column_id,number,title,description) VALUES (?,?,?,1,'Prepare lecture','Study the Fourier transform')")
    .run(user, project, column).lastInsertRowid);
  const calendar = Number(db.prepare("INSERT INTO calendar_collections (user_id,name) VALUES (?,'Classes')").run(user).lastInsertRowid);
  const event = Number(db.prepare("INSERT INTO calendar_events (user_id,calendar_id,title,starts_at,ends_at) VALUES (?,?,'Fourier seminar','2026-09-25T10:00:00','2026-09-25T11:00:00')").run(user, calendar).lastInsertRowid);

  const organization = Number(db.prepare("INSERT INTO organizations (name,created_by_user_id) VALUES ('Study group',?)").run(user).lastInsertRowid);
  db.prepare("INSERT INTO organization_members (organization_id,user_id) VALUES (?,?)").run(organization, user);
  const room = createRoom(db, organization, user, { name: "Signals" });
  const privateRoom = createRoom(db, organization, other, { name: "Private room", visibility: "private" });
  for (const target of [room, privateRoom]) postMessage(db, target.id, { clientMessageId: "fourier-message", memberId: null,
    authorKind: "human", authorName: "Student", body: "Fourier notes are ready." });
  const runtime = Number(db.prepare("INSERT INTO hermes_runtime_sessions (surface,user_id,agent_name,workspace_key) VALUES ('dashboard_terminal',?,'hermes','test')").run(user).lastInsertRowid);
  db.prepare("INSERT INTO hermes_runs (id,runtime_session_id,instruction,status,started_at) VALUES ('run',?,'test','completed',datetime('now'))").run(runtime);
  db.prepare(`INSERT INTO hermes_artifacts (id,user_id,runtime_session_id,hermes_session_id,conversation_id,originating_run_id,
    source_surface,kind,renderer_id,title,filename,mime_type,status,created_at,updated_at)
    VALUES ('pdf',?,?,'session',?,'run','dashboard_terminal','pdf','pdf-file','Fourier handout','fourier.pdf','application/pdf','ready',datetime('now'),datetime('now'))`)
    .run(user, runtime, artifactChat.id);

  await t.test("finds every owned garden's body, source files, old chat text, tasks, and events", async () => {
    const response = await searchBreadboard(db, user, "Fourier");
    assert.deepEqual(response.unavailable, []);
    const hits = response.results;
    for (const type of ["note", "file", "chat", "task", "event", "room"]) assert.ok(hits.some(hit => hit.type === type), type);
    assert.equal(hits.filter(hit => hit.type === "note").length, 3);
    assert.equal(hits.filter(hit => hit.type === "chat").length, 2);
    assert.ok(hits.every(hit => !/secret|ignored|Temporary|Private discussion/.test(JSON.stringify(hit))));
    assert.ok(hits.some(hit => hit.href === `/plan?project=${project}&task=${task}`));
    assert.ok(hits.some(hit => hit.href.endsWith(`&event=${event}`)));
    assert.ok(hits.some(hit => hit.href === `/gardens/math?chat=${legacy}`));
    assert.ok(hits.some(hit => hit.href === "/garden/physics?note=notes%2Flecture"));
    assert.match(hits.find(hit => hit.type === "chat").snippet, /Fourier/);
    assert.equal(hits.filter(hit => hit.type === "room").length, 1, "private rooms require explicit membership");
    assert.ok(hits.some(hit => hit.href.startsWith(`/artifacts/pdf/pdf?conversationId=${encodeURIComponent(artifactChat.publicId)}`)));
  });

  await t.test("a previously indexed private garden is never exposed to a different user", async () => {
    await searchBreadboard(db, other, "Fourier");
    const response = await searchBreadboard(db, user, "Fourier");
    assert.ok(response.results.every(hit => !JSON.stringify(hit).includes("secret")));
  });

  await t.test("edits and deletions refresh the index without requiring a chat or embedding service", async () => {
    fs.unlinkSync(path.join(root, "content/physics/notes/lecture.md"));
    write("math/notes/lecture.md", "---\ntitle: Revised lecture\n---\nLaplace analysis only.");
    const response = await searchBreadboard(db, user, "Fourier", { now: Date.now() + 60_000 });
    assert.ok(!response.results.some(hit => hit.id === "note:math/notes/lecture.md" || hit.id === "note:physics/notes/lecture.md"));
    assert.ok((await searchBreadboard(db, user, "Laplace")).results.some(hit => hit.title === "Revised lecture"));
  });

  await t.test("prefix and accent matching work; query syntax remains literal", async () => {
    assert.ok((await searchBreadboard(db, user, "cafe")).results.some(hit => hit.title === "Café"));
    assert.ok((await searchBreadboard(db, user, "four trans")).results.some(hit => hit.type === "file"));
    assert.equal((await searchBreadboard(db, user, "%")).results.length, 0);
    assert.equal((await searchBreadboard(db, user, "' OR 1=1 --")).results.length, 0);
    assert.equal((await searchBreadboard(db, user, "  ")).results.length, 0);
  });

  await t.test("organization membership is rechecked even when garden content is already indexed", async () => {
    db.prepare("UPDATE clusters SET visibility = 'organization', organization_id = ? WHERE slug = 'shared'").run(organization);
    assert.ok((await searchBreadboard(db, user, "Fourier")).results.some(hit => hit.id.startsWith("note:shared/")));
    db.prepare("DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?").run(organization, user);
    const response = await searchBreadboard(db, user, "Fourier");
    assert.ok(!response.results.some(hit => hit.id.startsWith("note:shared/") || hit.type === "room"));
  });

  await t.test("a reused slug does not inherit the previous owner's fresh index", async () => {
    await searchBreadboard(db, other, "Fourier");
    db.prepare("DELETE FROM clusters WHERE slug = 'secret'").run();
    fs.unlinkSync(path.join(root, "content/secret/notes/lecture.md"));
    db.prepare("INSERT INTO clusters (user_id,name,slug) VALUES (?,'New garden','secret')").run(user);
    const response = await searchBreadboard(db, user, "Fourier");
    assert.ok(!response.results.some(hit => hit.id.startsWith("note:secret/")));
  });
});
