import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import Database from "better-sqlite3";

const root = new URL("../src/", import.meta.url);

// Load the reader without the app's database singleton or "server-only".
async function loadReader() {
  const source = fs.readFileSync(new URL("lib/hermes/intermediate-responses.ts", root), "utf8")
    .replace('import "server-only";', "")
    .replace('import db from "../db.ts";', "const db = null;")
    .replace('from "./composer-switches.ts"',
      `from ${JSON.stringify(new URL("lib/hermes/composer-switches.ts", root).href)}`);
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  return import(`data:text/javascript,${encodeURIComponent(js)}`);
}

function database(switches) {
  const d = new Database(":memory:");
  d.exec("CREATE TABLE hermes_user_settings (user_id INTEGER PRIMARY KEY, composer_switches TEXT)");
  if (switches !== undefined) {
    d.prepare("INSERT INTO hermes_user_settings VALUES (1, ?)").run(switches);
  }
  return d;
}

test("intermediate responses are on unless the user turned them off", async () => {
  const { intermediateResponsesEnabled } = await loadReader();
  assert.equal(intermediateResponsesEnabled(1, database()), true, "no settings row");
  assert.equal(intermediateResponsesEnabled(1, database(null)), true, "empty column");
  assert.equal(intermediateResponsesEnabled(1, database('{"webPdfCleanup":false}')), true, "other switch only");
  assert.equal(intermediateResponsesEnabled(1, database("not json")), true, "corrupt record");
  assert.equal(intermediateResponsesEnabled(1, database('{"intermediateResponses":true}')), true);
  assert.equal(intermediateResponsesEnabled(1, database('{"intermediateResponses":false}')), false);
});

test("the settings switch is an accepted account switch", async () => {
  const { pickComposerSwitches } = await import(new URL("lib/hermes/composer-switches.ts", root).href);
  assert.deepEqual(pickComposerSwitches({ intermediateResponses: false }), { intermediateResponses: false });
});

test("repeated identical tokens survive the client's replay de-duplication", () => {
  // Run the real server delta block for two identical tokens, then feed the
  // frames through the client's byte-identical de-duplication rule.
  const text = fs.readFileSync(new URL("lib/hermes/event-stream.ts", root), "utf8");
  const start = text.indexOf('          if (event.type === "assistant.delta")');
  const end = text.indexOf('          } else if (event.type === "assistant.segment")', start);
  const code = ts.transpileModule(text.slice(start, end) + "          }",
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const step = new Function("state", "event", "parseRuntimeRunDispatch", "getRuntimeRun", "emit", `
    let {assistantMessageId,assistantText,sawTurnOutput,deltaSequence,streamIntermediateResponses} = state;
    let forwardEvent = true; const streamRun = {id:'run'}; const narrationSegments = [];
    for (const once of [0]) {${code}}
    Object.assign(state, {assistantMessageId,assistantText,sawTurnOutput,deltaSequence});
    return forwardEvent;
  `);
  function frames(stream) {
    const state = { assistantText: "", sawTurnOutput: false, deltaSequence: 0, streamIntermediateResponses: stream };
    const out = [];
    for (let i = 0; i < 2; i++) {
      const event = { type: "assistant.delta", sessionId: "s", messageId: "m",
        timestamp: "2026-11-25T10:00:00.000Z", payload: { text: " the" } };
      if (step(state, event, () => ({}), () => ({ status: "active" }), () => {})) out.push(JSON.stringify(event));
    }
    return { out, state };
  }
  const on = frames(true);
  assert.equal(new Set(on.out).size, 2, "identical tokens must not collapse into one frame");
  assert.equal(on.state.assistantText, " the the");
  const off = frames(false);
  assert.equal(off.out.length, 0, "with the setting off nothing streams before the final answer");
  assert.equal(off.state.assistantText, " the the", "the server still accumulates the final answer");
});
