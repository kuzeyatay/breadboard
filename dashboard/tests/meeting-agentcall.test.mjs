import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  agentCallApiKey,
  createCall,
  createCallBody,
  meetingPlatform,
  verifySignInCode,
} from "../src/lib/meetings/agentcall.ts";
import { meetingContext, notesPrompt, requestPrompt, spokenAnswer } from "../src/lib/meetings/meeting-prompts.ts";
import { MEETING_TOOLS, allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import { BROKERED_TOOLS } from "../src/lib/hermes/capability-broker.ts";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");

function withHome(fn) {
  return async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agentcall-home-"));
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, key: process.env.AGENTCALL_API_KEY, url: process.env.AGENTCALL_API_URL, fetch: globalThis.fetch };
    process.env.HOME = home; process.env.USERPROFILE = home;
    delete process.env.AGENTCALL_API_KEY; process.env.AGENTCALL_API_URL = "https://agentcall.test";
    try { await fn(home); } finally {
      process.env.HOME = saved.HOME; process.env.USERPROFILE = saved.USERPROFILE;
      if (saved.key === undefined) delete process.env.AGENTCALL_API_KEY; else process.env.AGENTCALL_API_KEY = saved.key;
      if (saved.url === undefined) delete process.env.AGENTCALL_API_URL; else process.env.AGENTCALL_API_URL = saved.url;
      globalThis.fetch = saved.fetch;
      fs.rmSync(home, { recursive: true, force: true });
    }
  };
}

test("only Meet, Zoom and Teams https links are joinable", () => {
  assert.equal(meetingPlatform("https://meet.google.com/abc-defg-hij"), "meet");
  assert.equal(meetingPlatform("https://us02web.zoom.us/j/123"), "zoom");
  assert.equal(meetingPlatform("https://teams.microsoft.com/l/meetup-join/x"), "teams");
  assert.equal(meetingPlatform("http://meet.google.com/abc"), null);
  assert.equal(meetingPlatform("https://meet.google.com.evil.example/abc"), null);
  assert.equal(meetingPlatform("https://notzoom.us/j/1"), null);
  assert.equal(meetingPlatform("not a url"), null);
});

test("the call uses the realtime voice, answers to Bread, and leaves empty rooms", () => {
  const body = createCallBody({ meetUrl: "https://meet.google.com/a", botName: "Bread", context: "x".repeat(20_000), triggerWords: ["bread"], disclosure: "AI here" });
  assert.equal(body.voice_strategy, "realtime");
  assert.equal(body.bot_name, "Bread");
  assert.deepEqual(body.realtime.trigger_words, ["bread"]);
  assert.equal(body.realtime.context.length, 10_000);
  assert.equal(body.alone_timeout, 120_000);
  assert.deepEqual(body.disclosure, { enabled: true, message: "AI here", delay_seconds: 5 });
  assert.ok(!("languages" in body.realtime));
});

test("sign-in trades the emailed code for a key kept in AgentCall's own config", withHome(async (home) => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/v1/auth/email-otp/verify")) return new Response(JSON.stringify({ token: "sess", is_new_user: true }));
    if (String(url).endsWith("/v1/auth/api-keys")) return new Response(JSON.stringify({ key: "ak_ac_abcdefghijkl", key_prefix: "ak_ac_abcd" }));
    return new Response("{}", { status: 404 });
  };
  fs.mkdirSync(path.join(home, ".agentcall"));
  fs.writeFileSync(path.join(home, ".agentcall", "config.json"), JSON.stringify({ api_url: "https://agentcall.test", other: 1 }));
  const result = await verifySignInCode(" Me@Example.com ", "123456");
  assert.deepEqual(result, { newAccount: true, keyPrefix: "ak_ac_abcd" });
  assert.equal(JSON.parse(calls[0].init.body).email, "me@example.com");
  assert.equal(calls[1].init.headers.Authorization, "Bearer sess");
  const saved = JSON.parse(fs.readFileSync(path.join(home, ".agentcall", "config.json"), "utf8"));
  assert.deepEqual(saved, { api_url: "https://agentcall.test", other: 1, api_key: "ak_ac_abcdefghijkl" });
  assert.equal(agentCallApiKey(), "ak_ac_abcdefghijkl");
}));

test("no key means no request; a refused key or empty balance reads plainly", withHome(async () => {
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return new Response(JSON.stringify({ error: "nope" }), { status: 402 }); };
  await assert.rejects(createCall({ meetUrl: "https://meet.google.com/a", botName: "Bread", context: "", triggerWords: [] }), { code: "agentcall_key_missing" });
  assert.equal(fetched, 0);
  process.env.AGENTCALL_API_KEY = "ak_ac_abcdefghijkl";
  await assert.rejects(createCall({ meetUrl: "https://meet.google.com/a", botName: "Bread", context: "", triggerWords: [] }), { code: "agentcall_out_of_credits", message: /out of credits/ });
}));

test("what Bread says is plain speech, and its prompts carry the owner and the transcript", () => {
  assert.equal(spokenAnswer("**Done.** See [the doc](https://x.y/z) or https://a.b\n\n```js\nx\n```\n- next"), "Done. See the doc or the link next");
  assert.ok(spokenAnswer("word ".repeat(400)).length <= 701);
  assert.match(meetingContext({ ownerName: "Kai", brief: "Ask about the budget." }), /Kai's behalf[\s\S]*ask_agent[\s\S]*Ask about the budget\./);
  const prompt = requestPrompt({ question: "What is on my calendar?", lines: [{ speaker: "Ana", text: "Hi", at: "" }, { speaker: "Bread", text: "Hello", at: "", bot: true }], ownerName: null, meetUrl: "https://meet.google.com/a" });
  assert.match(prompt, /The request: What is on my calendar\?/);
  assert.match(prompt, /Ana: Hi\nBread \(you\): Hello/);
  assert.match(notesPrompt({ lines: [], meetUrl: "https://meet.google.com/a", reason: "left" }), /\(left\)[\s\S]*Nothing was transcribed/);
});

test("the meeting tools are registered everywhere a Breadboard tool has to appear", () => {
  const plugin = read("hermes-agent/plugins/breadboard/__init__.py");
  const manifest = read("hermes-agent/plugins/breadboard/plugin.yaml");
  for (const tool of MEETING_TOOLS) {
    assert.ok(manifest.includes(`  - ${tool}`), `${tool} missing from plugin.yaml`);
    assert.ok(plugin.includes(`"${tool}"`), `${tool} missing from __init__.py`);
    assert.ok(BROKERED_TOOLS.includes(tool), `${tool} is not brokered`);
    assert.ok(allowedToolsForSurface("dashboard_terminal").includes(tool));
    assert.ok(allowedToolsForSurface("garden_chat").includes(tool));
    assert.ok(!allowedToolsForSurface("quartz_ai").includes(tool));
  }
  assert.match(plugin, /route_kind in \{[^}]*"meeting"[^}]*\}/);
  assert.ok(fs.existsSync(path.join(repoRoot, "dashboard/src/app/api/hermes/tools/meeting/route.ts")));
});
