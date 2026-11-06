import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

test("lesson saves read real evidence, heal, re-review and only then write; failures leave no note", async t => {
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    if (specifier.endsWith("/quartz-publish.ts") || specifier === "./quartz-publish.ts") return { url: "data:text/javascript,export async function publishQuartzAfterMutation(){return null}", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const candidate = new URL(`../src/${specifier.slice(2)}${path.extname(specifier) ? "" : ".ts"}`, import.meta.url);
      if (fs.existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    }
    if (/^\.{1,2}\//.test(specifier) && !path.extname(specifier) && context.parentURL?.startsWith("file:")) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (fs.existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  } });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-teaching-save-"));
  process.env.BREADBOARD_DATA_DIR = root;
  process.env.QUARTZ_CONTENT_PATH = path.join(root, "content");
  process.env.BREADBOARD_EMBEDDINGS = "off";
  process.env.OPENAI_API_KEY = "test-only";
  let mode = "heal", requests = [];
  const clean = { terms: [], concepts: [], results: [], restatements: [], callouts: [], reteaching: [], flow: [] };
  const server = http.createServer(async (req, res) => {
    let data = ""; for await (const chunk of req) data += chunk;
    const call = JSON.parse(data), payload = JSON.parse(call.messages.at(-1).content);
    requests.push(payload);
    const isReview = payload.task === "review_lesson_terms";
    const answer = mode === "malformed" ? '{"terms":[]}' : !isReview
      ? "A function assigns one output to each allowed input. For f(x) = 2x + 1, input 3 gives 7.\n\n![The rule maps 3 to 7](/course/assets/function.png)"
      : JSON.stringify(payload.pageMarkdown.includes("rho") ? { ...clean, terms: [{ term: "cylindrical coordinates", status: "unexplained", laterUnit: true, sentence: "Use rho cos phi.", missing: "Use a numerical function input instead." }] } : clean);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "test", object: "chat.completion", created: 0, model: "fixture", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: answer } }] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  const { default: db } = await import("../src/lib/db.ts");
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); hooks.deregister(); fs.rmSync(root, { recursive: true, force: true }); });
  const { executeGardenTool } = await import("../src/lib/hermes/garden-tools.ts");
  const { issueCapabilityToken } = await import("../src/lib/hermes/capability-token.ts");
  const userId = Number(db.prepare("INSERT INTO users (username,email,password_hash) VALUES (?,?,?)").run("learner", "learner@example.test", "unused").lastInsertRowid);
  db.prepare("INSERT INTO clusters (user_id,name,slug) VALUES (?,?,?)").run(userId, "Course", "course");
  const garden = path.join(root, "content/course");
  fs.mkdirSync(path.join(garden, "sources"), { recursive: true });
  fs.mkdirSync(path.join(garden, "notes"));
  fs.writeFileSync(path.join(garden, "sources/book.md"), "---\ntitle: Book\nknowledge_type: source-document\n---\nA function assigns one output to each allowed input.");
  fs.writeFileSync(path.join(garden, "notes/previous.md"), "---\ntitle: Arithmetic\n---\nAdding two numbers combines their amounts into one total.");
  const rawToken = issueCapabilityToken({ userId, gardenId: "course", surface: "garden_chat", hermesSessionId: "teaching-test", allowedTools: ["garden_save_note"] });
  const lesson = { learningQuestion: "How can a function give an output?", newConcepts: ["function"], assumedBackground: ["arithmetic"], taughtLater: ["cylindrical coordinates"], previousLessonSlugs: ["notes/previous"], sourcePassages: [{ pageSlug: "sources/book", offset: 0, limit: 1000 }] };
  const save = extra => executeGardenTool({ rawToken, tool: "garden_save_note", args: { title: "Algebra", folder: "notes", content: "Use rho cos phi.\n\n![Original caption](/course/assets/function.png)", minimumProseWords: 15, lesson, ...extra } });
  const result = await save({});
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.teachingReview.accepted, true);
  assert.equal(result.data.teachingReview.repairCount, 1);
  assert.deepEqual(requests.map(r => r.task), ["review_lesson_terms", "heal_lesson_foundations", "review_lesson_terms"]);
  assert.match(requests[0].earlierLessons[0].markdown, /combines their amounts/);
  assert.equal(requests[0].sources[0].text, "A function assigns one output to each allowed input.");
  const saved = fs.readFileSync(path.join(garden, result.data.relPath), "utf8");
  assert.match(saved, /input 3 gives 7/);
  assert.doesNotMatch(saved, /rho/);
  assert.match(saved, /!\[The rule maps 3 to 7\]\(\/course\/assets\/function.png\)/);
  const before = fs.readdirSync(path.join(garden, "notes"));
  mode = "malformed"; requests = [];
  const badReview = await save({ title: "Rejected" });
  assert.equal(badReview.ok, false);
  assert.match(badReview.error, /omitted/);
  assert.deepEqual(fs.readdirSync(path.join(garden, "notes")), before);
  const absentEvidence = await save({ lesson: { ...lesson, sourcePassages: [{ pageSlug: "sources/missing" }] } });
  assert.equal(absentEvidence.ok, false);
  assert.match(absentEvidence.error, /unavailable/);
  const absentContext = await save({ lesson: undefined, content: "Explanatory prose. ".repeat(1500), minimumProseWords: 1400 });
  assert.equal(absentContext.ok, false);
  assert.match(absentContext.error, /requires lesson context/);
  assert.deepEqual(fs.readdirSync(path.join(garden, "notes")), before);
});
