import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { keptPromptSuggestion, setPromptSuggestionCacheDirectory } from "../src/lib/prompt-suggestion-cache.ts";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("an unchanged chat asks the model once, also across a restart; empty and failed answers are not kept", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-suggestions-"));
  setPromptSuggestionCacheDirectory(data);
  let calls = 0;
  const generate = async () => { calls += 1; return "Ask about the dominant pole"; };

  // Two opens at once share one model call; a later open reuses the answer.
  const [a, b] = await Promise.all([keptPromptSuggestion("chat-1", generate), keptPromptSuggestion("chat-1", generate)]);
  assert.equal(a, "Ask about the dominant pole");
  assert.equal(b, a);
  assert.equal(await keptPromptSuggestion("chat-1", generate), a);
  assert.equal(calls, 1);

  // A changed transcript is a different key.
  await keptPromptSuggestion("chat-1-with-a-new-message", generate);
  assert.equal(calls, 2);

  // Nothing useful came back: ask again next time.
  let empties = 0;
  const empty = async () => { empties += 1; return null; };
  await keptPromptSuggestion("chat-2", empty);
  await keptPromptSuggestion("chat-2", empty);
  assert.equal(empties, 2);
  let failures = 0;
  const failing = async () => { failures += 1; throw new Error("model unavailable"); };
  await assert.rejects(keptPromptSuggestion("chat-3", failing));
  await assert.rejects(keptPromptSuggestion("chat-3", failing));
  assert.equal(failures, 2);

  // The file is written shortly after, and a fresh process reads it back.
  const file = path.join(data, "cache", "prompt-suggestions.json");
  for (let i = 0; i < 200 && !fs.existsSync(file); i += 1) await wait(25);
  assert.ok(fs.existsSync(file));
  setPromptSuggestionCacheDirectory(data); // forgets memory, as a restart does
  assert.equal(await keptPromptSuggestion("chat-1", generate), a);
  assert.equal(calls, 2, "served from the file without asking the model");
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /chat-2|chat-3/);

  // An expired or torn file is ignored.
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [["chat-1", Date.now() - 1, "stale"]] }));
  setPromptSuggestionCacheDirectory(data);
  await keptPromptSuggestion("chat-1", generate);
  assert.equal(calls, 3);
  fs.writeFileSync(file, "{ torn");
  setPromptSuggestionCacheDirectory(data);
  await keptPromptSuggestion("chat-1", generate);
  assert.equal(calls, 4);
});
