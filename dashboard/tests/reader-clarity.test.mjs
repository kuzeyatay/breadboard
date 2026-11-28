import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-reader-clarity-"));
process.env.BREADBOARD_DATA_DIR = temporary;
process.env.BREADBOARD_REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const { default: db } = await import("../src/lib/db.ts");
const {
  readerClarityFindings,
  reviseForReader,
  unsafeRevisionReason,
  readerClarityTurn,
  READER_CLARITY_PROMPT_ID,
} = await import("../src/lib/conversations/reader-clarity.ts");
const { systemPromptText } = await import("../src/lib/system-prompts/service.ts");
after(() => { db.close(); fs.rmSync(temporary, { recursive: true, force: true }); });

const sentence = (i) => `The capacitor voltage changes because charge accumulates on plate ${i} while current flows through the resistor.`;
const choppy = Array.from({ length: 12 }, (_, i) => `**Point ${i}.** ${sentence(i)}`).join("\n\n");
const prose = Array.from({ length: 3 }, (_, p) => Array.from({ length: 5 }, (_, i) => sentence(p * 5 + i)).join(" ")).join("\n\n");

function completion(content, status = 200) {
  return async () => new Response(JSON.stringify({ model: "test-model", choices: [{ message: { content } }] }), { status });
}

test("the check flags bold-heavy fragmented answers and leaves connected prose alone", () => {
  assert.deepEqual(readerClarityFindings(choppy, "why does the voltage change"), ["bold", "fragmented_paragraphs"]);
  assert.deepEqual(readerClarityFindings(prose, "why does the voltage change"), []);
});

test("short answers and answers with fenced blocks are never rewritten", () => {
  assert.deepEqual(readerClarityFindings("**Yes.** The official formula sheet is provided.", "can I bring a sheet"), []);
  assert.deepEqual(readerClarityFindings(`${choppy}\n\n\`\`\`python\nprint(1)\n\`\`\``, "explain"), []);
});

test("list and heading rules do not fire when the user asked for that structure", () => {
  const list = Array.from({ length: 14 }, (_, i) => `- ${sentence(i)}`).join("\n");
  assert.ok(readerClarityFindings(list, "explain the voltage").includes("list_heavy"));
  assert.ok(!readerClarityFindings(list, "give me a list of the steps").includes("list_heavy"));
});

test("a revision that drops a link or an equation, or collapses the answer, is refused", () => {
  const original = `${prose}\n\n$$V = IR$$\n\nSee [lecture 3](/garden/ec-2?note=sources%2Flec-3).`;
  assert.equal(unsafeRevisionReason(original, `${prose}\n\n$$V = IR$$`), "lost_links");
  assert.equal(unsafeRevisionReason(original, `${prose}\n\nSee [lecture 3](/garden/ec-2?note=sources%2Flec-3).`), "lost_equations");
  assert.equal(unsafeRevisionReason(original, "Short."), "too_short");
  assert.equal(unsafeRevisionReason(original, original), null);
});

test("a passing answer costs no model call", async () => {
  let called = false;
  const result = await reviseForReader({ answer: prose, question: "why", fetcher: async () => { called = true; throw new Error("unexpected"); } });
  assert.equal(called, false);
  assert.equal(result.revised, false);
  assert.equal(result.text, prose);
});

test("a failing answer is revised by the model that wrote it", async () => {
  let body;
  const fetcher = async (_url, init) => { body = JSON.parse(init.body); return completion(`<gaps>Defined plate charge.</gaps>\n<answer>${prose}</answer>`)(); };
  const result = await reviseForReader({ answer: choppy, question: "why does the voltage change", model: "gpt-6.2-sol", fetcher });
  assert.equal(result.revised, true);
  assert.equal(result.text, prose);
  assert.deepEqual(result.gaps, ["Defined plate charge."]);
  assert.equal(body.model, "gpt-6.2-sol");
  assert.equal(body.messages[0].content, systemPromptText(READER_CLARITY_PROMPT_ID));
  assert.match(body.messages[1].content, /LINT FINDINGS: bold, fragmented_paragraphs/);
});

test("model errors, bad output and timeouts keep the original answer", async () => {
  const failed = await reviseForReader({ answer: choppy, question: "why", fetcher: completion("nope", 500) });
  assert.deepEqual([failed.revised, failed.text, failed.reason], [false, choppy, "http_500"]);
  const empty = await reviseForReader({ answer: choppy, question: "why", fetcher: completion("<answer></answer>") });
  assert.deepEqual([empty.revised, empty.text, empty.reason], [false, choppy, "empty"]);
  const hung = await reviseForReader({
    answer: choppy, question: "why", timeoutMs: 20,
    fetcher: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))),
  });
  assert.deepEqual([hung.revised, hung.text, hung.reason], [false, choppy, "timeout"]);
});

test("the revision can be switched off without a code change", async () => {
  process.env.BREADBOARD_READER_CLARITY = "0";
  try {
    const result = await reviseForReader({ answer: choppy, question: "why", fetcher: async () => { throw new Error("unexpected"); } });
    assert.deepEqual([result.revised, result.reason], [false, "disabled"]);
  } finally { delete process.env.BREADBOARD_READER_CLARITY; }
});

test("the turn context is the user's question plus the turns before it", () => {
  const rows = [
    { role: "assistant", content: "Earlier answer" },
    { role: "user", content: "Earlier question" },
    { role: "user", content: "Current question" },
  ];
  const fake = { prepare: () => ({ all: () => [...rows].reverse() }) };
  const turn = readerClarityTurn(1, fake);
  assert.equal(turn.question, "Current question");
  assert.deepEqual(turn.context.map((row) => row.content), ["Earlier answer", "Earlier question"]);
});

test("both garden answer paths revise before the stable answer is revealed and saved", () => {
  const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const stream = read("src/lib/hermes/event-stream.ts");
  const idle = stream.slice(stream.indexOf("appendWeatherToolDisplays(assistantText, evidence);"));
  assert.ok(idle.indexOf("reviseForReader(") > 0 && idle.indexOf("reviseForReader(") < idle.indexOf("emitStableAnswer();"));
  assert.match(stream, /session\.row\.surface === "garden_chat"/);
  assert.match(stream, /readerClarity \? \{ readerClarity \}/);
  const adapter = read("src/lib/hermes/garden-chat-adapter.ts");
  assert.ok(adapter.indexOf("reviseForReader(") < adapter.indexOf('emit({ type: "replace", text: assistantText });'));
  assert.ok(adapter.indexOf('emit({ type: "replace", text: assistantText });') < adapter.indexOf("...(readerClarity ? { readerClarity } : {})"));
});
