import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test, { after } from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const dashboard = path.join(root, "dashboard");
const require = createRequire(path.join(dashboard, "package.json"));
const esbuild = require("esbuild");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-feature-prompts-"));
process.env.BREADBOARD_DATA_DIR = temporary;
process.env.BREADBOARD_REPO_ROOT = root;
const { default: db } = await import("../src/lib/db.ts");
const { listSystemPrompts, updateSystemPrompt, systemPromptText } = await import("../src/lib/system-prompts/service.ts");
for (const id of [801, 802]) db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, 'test')").run(id, `feature-${id}`, `feature-${id}@test.local`);
after(() => { db.close(); fs.rmSync(temporary, { recursive: true, force: true }); delete globalThis.__featurePromptFixture; });
function edit(id, content, userId = 801) {
  const prompt = listSystemPrompts(userId).find(item => item.id === id);
  assert.ok(prompt, id);
  return updateSystemPrompt(userId, { id, content, revision: prompt.revision });
}

test("learning, screen context and external specialist builders read live account instructions", async () => {
  const { withSystemPromptContext } = await import("../src/lib/system-prompts/service.ts");
  const { modelVisualNecessitySystemPrompt } = await import("../src/lib/model-visual-necessity.ts");
  const { visualizationContractRepairSystemPrompt } = await import("../src/lib/visualization-contract-repair.ts");
  const { browserTerminalPrompt } = await import("../src/lib/hermes/browser-terminal-context.ts");
  const { workspaceAgentPrompt } = await import("../src/lib/openwork/prompt.ts");
  const { runInstruction } = await import("../src/lib/openscience/prompt.ts");
  const cases = [
    ["learning-visual-necessity", userId => withSystemPromptContext(userId, modelVisualNecessitySystemPrompt)],
    ["learning-visual-contract-repair", userId => withSystemPromptContext(userId, visualizationContractRepairSystemPrompt)],
    ["browser-context-1", userId => browserTerminalPrompt({port:1,token:"test"}, true, {onDemand:true,userId})],
    ["openwork-operating-rules", userId => workspaceAgentPrompt({deliverFiles:true,allowCommands:true}, userId)],
    ["openscience-instructions-1", userId => runInstruction("Original task", {harness:"research",deliverFiles:false}, undefined, userId)],
  ];
  for (const [id, render] of cases) {
    const original = await render(802);
    try {
      for (const marker of ["LIVE_FIRST_" + id, "LIVE_SECOND_" + id]) {
        edit(id, marker);
        assert.ok((await render(801)).includes(marker), id);
        assert.equal(await render(802), original, id);
      }
    } finally { edit(id, null); }
    assert.equal(await render(801), original, id);
  }
});

test("website API instructions use the signed-in account and preserve browser runtime placeholders", async () => {
  const { apiAnythingRegistry } = await import("../src/lib/api-anything/service.ts");
  const { renderSystemPrompt } = await import("../src/lib/system-prompts/service.ts");
  const original = apiAnythingRegistry(802).systemContext;
  try {
    for (const content of ["WEBSITE_POLICY_ONE", "WEBSITE_POLICY_TWO"]) {
      edit("api-anything-policy", content);
      assert.ok(apiAnythingRegistry(801).systemContext.includes(content));
      assert.equal(apiAnythingRegistry(802).systemContext, original);
      const browser = renderSystemPrompt("agent-browser-operating-rules", 801, {website_api_policy:systemPromptText("api-anything-policy",801)});
      assert.ok(browser.includes(content));
      assert.ok(!browser.includes("{{website_api_policy}}"));
    }
  } finally { edit("api-anything-policy", null); }
});
const response = content => new Response(JSON.stringify({ choices: [{ message: { content } }] }));

test("Council identity reaches authenticated route requests after each edit", async () => {
  const fixture = globalThis.__featurePromptFixture = { db, userId: 801, calls: [], content: "## Overview\nWrites concise sentences.", profile: "" };
  fixture.client = { chat: { completions: { async create(body) { fixture.calls.push(body); return { choices: [{ message: { role: "assistant", content: fixture.content } }] }; } } } };
  const tone = await bundleRoute("src/app/api/unslop/voice-profile/route.ts", {
    "@/lib/unslop": "export function countWords(){return 20;} export async function readVoiceTemplate(){return '## Overview';} export async function readVoiceProfile(){return {content:globalThis.__featurePromptFixture.profile};} export async function writeVoiceProfile(v){globalThis.__featurePromptFixture.profile=v;} export async function deleteVoiceProfile(){}",
  });
  try {
    for (const content of ["COUNCIL_ROUTE_ONE", "COUNCIL_ROUTE_TWO", ""]) {
      edit("council-identity", content);
      for (const userId of [801, 802]) {
        fixture.userId = userId;
        const result = await tone.POST(new Request("http://fixture.local/api/unslop/voice-profile", { method: "POST", body: JSON.stringify({ samples: ["This is my writing sample."] }) }));
        assert.equal(result.status, 200, await result.text());
        const sent = fixture.calls.at(-1).messages[0].content;
        if (userId === 801 && content) assert.ok(sent.startsWith(content + "\n\n"));
        else assert.doesNotMatch(sent, /COUNCIL_ROUTE_/);
        if (userId === 801) assert.ok(!sent.includes("Your name is Bread; Breadboard is the application"));
      }
    }
  } finally { edit("council-identity", null); }
});

test("every catalog entry has a unique ID and an editable default within the API limit", () => {
  const prompts = listSystemPrompts(801);
  assert.equal(new Set(prompts.map(item => item.id)).size, prompts.length);
  for (const prompt of prompts) {
    assert.ok(prompt.title && prompt.group && prompt.description && prompt.source, prompt.id);
    assert.equal(typeof prompt.defaultContent, "string", prompt.id);
    assert.ok(prompt.defaultContent.length <= 64000, prompt.id);
    assert.equal(prompt.content, prompt.defaultContent, prompt.id);
  }
});

test("suggestions and titles read the latest override on each invocation and isolate accounts", async () => {
  const { generatePromptSuggestion } = await import("../src/lib/chat-prompt-suggestion-service.ts");
  const { generateConversationTitle } = await import("../src/lib/conversations/title-service.ts");
  for (const [id, run] of [
    ["prompt-suggestions", options => generatePromptSuggestion({ ...options, model: "gpt-5.6-sol", messages: [{ role: "user", content: "Explain circuits" }, { role: "assistant", content: "Here is the explanation." }] })],
    ["conversation-titles", options => generateConversationTitle({ ...options, model: "gpt-5.6-sol", firstPrompt: "Explain circuits" })],
  ]) {
    const captured = [];
    const fetcher = async (_url, init) => { captured.push(JSON.parse(init.body)); return response("Circuit discussion"); };
    const original = systemPromptText(id, 801);
    for (const text of ["FIRST_OVERRIDE", "SECOND_OVERRIDE", ""]) {
      edit(id, text);
      await run({ userId: 801, fetcher });
      assert.equal(captured.at(-1).messages[0].content, text);
      await run({ userId: 802, fetcher });
      assert.equal(captured.at(-1).messages[0].content, original);
    }
    edit(id, null);
    await run({ userId: 801, fetcher });
    assert.equal(captured.at(-1).messages[0].content, original);
  }
});

test("memory planning and synthesis use their owner's live instruction", async () => {
  const { applyMemoryInstruction } = await import("../src/lib/conversations/memory-instruction.ts");
  const { synthesizeMemoryProfile } = await import("../src/lib/conversations/memory-profile.ts");
  const { saveDurableMemory } = await import("../src/lib/conversations/memory.ts");
  for (const userId of [801, 802]) saveDurableMemory({ userId, content: "The user studies electronics.", kind: "project_fact", scope: "global", state: "confirmed", confidence: 0.95, salience: 0.9 });
  for (const id of ["memory-instructions", "memory-profile"]) edit(id, `${id}_CUSTOM`);
  for (const userId of [801, 802]) {
    const captured = [];
    await applyMemoryInstruction({ userId, instruction: "Keep the current electronics memory.", database: db,
      fetcher: async (_url, init) => { captured.push(JSON.parse(init.body)); return response(JSON.stringify({ operations: [], reply: "No changes needed." })); } });
    assert.equal(captured[0].messages[0].content, systemPromptText("memory-instructions", userId));
    captured.length = 0;
    const result = await synthesizeMemoryProfile({ userId, force: true, database: db,
      fetcher: async (_url, init) => { captured.push(JSON.parse(init.body)); return response("## Overview\n\nThe user studies electronics."); } });
    assert.equal(result.result, "generated");
    assert.equal(captured[0].messages[0].content, systemPromptText("memory-profile", userId));
  }
  for (const id of ["memory-instructions", "memory-profile"]) edit(id, null);
});

async function bundleRoute(relative, extraStubs = {}, testExports = [], testCode = "") {
  const stubs = {
    "next/server": "export const NextResponse = Response;",
    "@/lib/server-auth": "export class RouteError extends Error{constructor(status,message){super(message);this.status=status;}} export async function requireUserId(){return globalThis.__featurePromptFixture.userId;} export function routeErrorResponse(e){return Response.json({error:e.message},{status:e.status||500});}",
    "@/lib/server-auth.ts": "export async function requireUserId(){return globalThis.__featurePromptFixture.userId;}",
    "@/lib/knowledge": "export function createChatmockClient(){return globalThis.__featurePromptFixture.client;}",
    "@/lib/chatmock-server": "export function resolveChatmockBaseUrl(){return {baseURL:'http://fixture.local/v1'};}",
    "@/lib/chatmock-server.ts": "export function resolveChatmockBaseUrl(){return {baseURL:'http://fixture.local/v1'};}",
    "@/lib/hermes/route-helpers.ts": "export class ApiError extends Error{constructor(status,code,message){super(message);this.status=status;}} export function apiErrorResponse(e){return Response.json({error:e.message},{status:e.status||500});} export function requireEnabled(){} export async function readJsonBody(r){return r.json();} export function requireString(v){return String(v||'');}",
    ...extraStubs,
  };
  const bundle = await esbuild.build({ entryPoints: [path.join(dashboard, relative)], absWorkingDir: dashboard, tsconfig: path.join(dashboard, "tsconfig.json"),
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", logLevel: "silent",
    plugins: [{ name: "real-routes-with-fixtures", setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        const isPromptService = path.normalize(args.importer).endsWith(path.join("system-prompts", "service.ts"));
        const isPersonaDefinition = [path.join("hermes", "agency-agents.ts"), path.join("aris", "agent.ts"), path.join("spotify-agent", "agent.ts")].some(suffix => path.normalize(args.importer).endsWith(suffix));
        if (args.path in stubs && !isPersonaDefinition && !(args.path === "./catalog.ts" && isPromptService)) return { path: args.path, namespace: "fixture" };
        if (args.path === "../db.ts" && isPromptService) return { path: "database", namespace: "fixture" };
        if (args.path.endsWith("/feature-defaults.ts") || args.path === "./feature-defaults.ts") return { path: path.join(dashboard, "src/lib/system-prompts/feature-defaults.ts") };
        if (args.path.startsWith("@/")) {
          const logical = path.join(dashboard, "src", args.path.slice(2));
          for (const suffix of ["", ".ts", ".tsx", "/index.ts"]) {
            const target = logical + suffix;
            if (fs.existsSync(target)) return { path: target };
          }
        }
      });
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "database" ? "export default globalThis.__featurePromptFixture.db;" : stubs[args.path] }));
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, args => {
        const candidate = args.path;
        if ((testExports.length || testCode) && args.path === path.join(dashboard, relative)) return { contents: fs.readFileSync(candidate, "utf8") + (args.path === path.join(dashboard, relative) ? testCode + (testExports.length ? `\nexport { ${testExports.join(", ")} };` : "") : ""), loader: args.path.endsWith("tsx") ? "tsx" : "ts", resolveDir: path.dirname(args.path) };
      });
    } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

test("tone, skill creation and Word routes use authenticated live overrides", async () => {
  const fixture = globalThis.__featurePromptFixture = { db, userId: 801, calls: [], content: "", profile: "" };
  fixture.client = { chat: { completions: { async create(body) { fixture.calls.push(body); return { choices: [{ message: { role: "assistant", content: fixture.content } }] }; } } } };
  const tone = await bundleRoute("src/app/api/unslop/voice-profile/route.ts", {
    "@/lib/unslop": "export function countWords(){return 20;} export async function readVoiceTemplate(){return '## Overview';} export async function readVoiceProfile(){return {content:globalThis.__featurePromptFixture.profile};} export async function writeVoiceProfile(v){globalThis.__featurePromptFixture.profile=v;} export async function deleteVoiceProfile(){}",
  });
  const skill = await bundleRoute("src/app/api/hermes/skills/create/route.ts", {
    "@/lib/hermes/skills.ts": "export function classifySkill(){} export function quarantineSkill(){}",
    "@/lib/hermes/runtime-store.ts": "export function recordAuditEvent(){} export function recordSkillDecision(){}",
  });
  const word = await bundleRoute("src/app/api/hermes/artifacts/[artifactId]/genoffice/ai/route.ts", {
    "openai": "export default class OpenAI {constructor(){return globalThis.__featurePromptFixture.client;}}",
    "@/lib/hermes/artifact-store.ts": "export class ArtifactStoreError extends Error {} export function getArtifactForUser({userId}){if(userId!==globalThis.__featurePromptFixture.userId)throw Error('wrong owner'); return {id:'doc',filename:'document.docx',renderer_id:'document-file'};}",
    "@/lib/hermes/session-service.ts": "export function authorizeGardenAccess(){}",
    "@/lib/hermes/genoffice-writing-skills.ts": "export function listGenOfficeWritingSkills(){return [];} export function renderGenOfficeWritingSkillsDirective(){return '';} export function genOfficeWritingTools(){return [];} export async function runGenOfficeWritingTool(){throw Error('unexpected tool');}",
  });
  const request = body => new Request("http://fixture.local/api/test?conversationId=conversation", { method: "POST", body: JSON.stringify(body) });
  const routes = [
    ["tone-calibration", async () => { fixture.content = "## Overview\nWrites concise sentences."; return tone.POST(request({ samples: ["This is my writing sample."] })); }],
    ["skill-authoring", async () => { fixture.content = JSON.stringify({ name: "test-skill", description: "A concise example skill for checking a live customized system prompt.", instructions: "Follow the user's instruction and provide a clear useful answer.", references: [] }); return skill.POST(request({ action: "draft", intent: "Draft a skill for useful answers." })); }],
    ["word-assistant", async () => { fixture.content = JSON.stringify({ message: "The document is clear.", operations: [] }); return word.POST(request({ prompt: "Review this document", documentContext: "A small document." }), { params: Promise.resolve({ artifactId: "doc" }) }); }],
  ];
  for (const [id, invoke] of routes) {
    for (const content of ["FEATURE_FIRST_LIVE", "FEATURE_SECOND_LIVE"]) {
      edit(id, content);
      for (const userId of [801, 802]) {
        fixture.userId = userId;
        fixture.calls.length = 0;
        const result = await invoke();
        assert.equal(result.status, 200, `${id}: ${await result.text()}`);
        assert.equal(fixture.calls.length, 1, id);
        const sent = fixture.calls[0].messages[0].content;
        if (userId === 801) assert.match(sent, new RegExp(content));
        else assert.doesNotMatch(sent, /FEATURE_.*_LIVE/);
      }
    }
    edit(id, null);
  }
});

test("the skill editor's shared helpers remain safe to bundle for a browser", async () => {
  const result = await esbuild.build({ entryPoints: [path.join(dashboard, "src/lib/hermes/skill-authoring.ts")],
    absWorkingDir: dashboard, bundle: true, write: false, platform: "browser", format: "esm", metafile: true, logLevel: "silent",
    plugins: [{ name: "original-pure-dependencies", setup(build) {
      build.onResolve({ filter: /assistant-identity\.ts$/ }, () => ({ path: path.join(dashboard, "src/lib/assistant-identity.ts") }));
      build.onResolve({ filter: /gods-eye\/view\.ts$/ }, () => ({ path: path.join(dashboard, "src/lib/gods-eye/view.ts") }));
    } }],
  });
  assert.doesNotMatch(Object.keys(result.metafile.inputs).join("\n"), /sqlite|system-prompts\/service|\/db\.ts/);
  assert.ok(result.outputFiles[0].text.length < 50_000, "client helpers must not bundle the full server prompt catalog");
});

test("note extraction, placement, tagging and merging use their account's current prompt", async () => {
  const fixture = globalThis.__featurePromptFixture = { db, userId: 801, calls: [], content: "[]" };
  fixture.client = { chat: { completions: { async create(body) { fixture.calls.push(body); return { choices: [{ message: { content: fixture.content } }] }; } } } };
  const route = await bundleRoute("src/app/api/generate-notes/route.ts", {
    "openai": "export default class OpenAI{constructor(){return globalThis.__featurePromptFixture.client;}}",
    "@/lib/external-runtime-path": "export {default as externalRuntimePath} from 'node:path';",
    "@/lib/external-runtime-filesystem": "export {default as externalRuntimeFilesystem} from 'node:fs';",
    "@/lib/server-auth": "export async function requireOwnedClusterFromSlug(){return {cluster:{slug:'fixture'},userId:globalThis.__featurePromptFixture.userId};} export function routeErrorResponse(e){return Response.json({error:e.message},{status:500});}",
    "@/lib/knowledge": "export function normalizeTopicTags(){return [];} export function refreshClusterIndex(){} export function resolveClusterNoteFile(){return null;} export function scanClusterKnowledge(){return {nodes:[]};} export function semanticTagsFromText(){return [];} export function slugify(s){return s;}",
    "@/lib/quartz-publish": "export async function publishQuartzAfterMutation(){}",
    "@/lib/garden-mutation-lease": "export async function acquireGardenMutationLease(){return {release(){}};}",
  }, ["decideChatNotePlacement", "generateChatNoteTags", "harmonizeChatNote"]);
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = temporary;
  try {
    const actions = [
      ["note-extraction", async () => { fixture.content = "[]"; const result = await route.POST(new Request("http://fixture.local/api/generate-notes", { method: "POST", body: JSON.stringify({ clusterSlug: "fixture", messages: [{ role: "user", content: "Explain simple harmonic motion" }] }) })); assert.equal(result.status, 200, await result.text()); }],
      ["note-placement", async () => { fixture.content = '{"action":"create"}'; await route.decideChatNotePlacement({ userId: fixture.userId, client: fixture.client, model: "test", clusterInventory: [], candidates: [{ slug: "existing", title: "Existing", tags: [], excerpt: "text", content: "text" }], title: "New", content: "New contents", tags: [] }); }],
      ["note-tags", async () => { fixture.content = '["resonance"]'; await route.generateChatNoteTags(fixture.client, "test", "New", "New contents", fixture.userId); }],
      ["note-merging", async () => { fixture.content = "Combined note"; await route.harmonizeChatNote({ userId: fixture.userId, client: fixture.client, model: "test", existingFileContent: "Resonance of electrical circuits.", newTitle: "Mechanical vibration", newContent: "Springs oscillate with masses.", newTags: [] }); }],
    ];
    for (const [id, invoke] of actions) {
      for (const text of ["DOCUMENT_FIRST_LIVE", "DOCUMENT_SECOND_LIVE"]) {
        edit(id, text);
        for (const userId of [801, 802]) {
          fixture.userId = userId; fixture.calls.length = 0;
          await invoke(); assert.equal(fixture.calls.length, 1, id);
          const sent = fixture.calls[0].messages[0].content;
          if (userId === 801) assert.ok(sent.includes(text), id);
          else assert.doesNotMatch(sent, /DOCUMENT_.*_LIVE/);
        }
      }
      edit(id, null);
    }
  } finally { if (previous === undefined) delete process.env.QUARTZ_CONTENT_PATH; else process.env.QUARTZ_CONTENT_PATH = previous; }
});

test("meeting notes pick up edits between transcript chunks without leaking to another owner", async () => {
  const { summarizeMeeting, MEETING_SECTIONS } = await import("../src/lib/meeting-notes/notes.ts");
  const captured = [];
  const originalFetch = globalThis.fetch;
  const valid = { MeetingName: "Planning", MeetingNotes: { meetingName: "Planning", sections: [] }, ...Object.fromEntries(MEETING_SECTIONS.map(({ key, title }) => [key, { title, blocks: [] }])) };
  globalThis.fetch = async (_url, init) => {
    captured.push(JSON.parse(init.body));
    if (captured.length === 1) edit("meeting-notes", "MEETING_SECOND_CHUNK");
    return response(JSON.stringify(valid));
  };
  try {
    edit("meeting-notes", "MEETING_FIRST_CHUNK");
    const input = { transcript: "A meeting sentence. ".repeat(120), chunkSize: 500, overlap: 30, baseUrl: "http://fixture.local/v1", model: "test", reasoningEffort: "low", customPrompt: "" };
    const result = await summarizeMeeting({ ...input, userId: 801 });
    assert.ok(result.chunks > 1); assert.equal(result.failedChunks, 0);
    assert.equal(captured[0].messages[0].content, "MEETING_FIRST_CHUNK");
    assert.equal(captured[1].messages[0].content, "MEETING_SECOND_CHUNK");
    captured.length = 0;
    await summarizeMeeting({ ...input, userId: 802, transcript: "A short meeting." });
    assert.doesNotMatch(captured[0].messages[0].content, /MEETING_.*_CHUNK/);
  } finally { globalThis.fetch = originalFetch; edit("meeting-notes", null); }
});

test("template values are filled once and edits preserve empty prompts, defaults and owner isolation", async () => {
  const { renderSystemPrompt, systemPromptRevision } = await import("../src/lib/system-prompts/service.ts");
  const initial = systemPromptRevision("browser-translation", 801);
  edit("browser-translation", "Translate to {{language}}. Literal {{unknown}}.");
  assert.equal(renderSystemPrompt("browser-translation", 801, { language: "{{unknown}} $&" }), "Translate to {{unknown}} $&. Literal {{unknown}}.");
  assert.equal(systemPromptRevision("browser-translation", 801), initial + 1);
  assert.match(renderSystemPrompt("browser-translation", 802, { language: "nl" }), /language nl/);
  edit("browser-translation", "");
  assert.equal(renderSystemPrompt("browser-translation", 801, { language: "nl" }), "");
  edit("browser-translation", null);
  assert.match(renderSystemPrompt("browser-translation", 801, { language: "de" }), /language de/);
  assert.equal(systemPromptRevision("browser-translation", 801), initial + 3);
});

test("translation and research calls use their live prompts with real request data", async () => {
  const { translateWithModel } = await import("../src/lib/browser-translation.ts");
  const { writeRetrievedFindings } = await import("../src/lib/agent-reach/writeup.ts");
  edit("browser-translation", "Translate to {{language}}. TRANSLATION_LIVE");
  edit("research-evidence", "EVIDENCE_LIVE");
  edit("research-report", "REPORT_LIVE");
  try {
    for (const userId of [801, 802]) {
      let body;
      await translateWithModel({ language: "nl", segments: [{ id: 1, text: "Hello", context: "Greeting" }] }, undefined,
        async (_url, init) => { body = JSON.parse(init.body); return response('{"segments":[{"id":1,"text":"Hallo"}]}'); }, "http://fixture.local/v1", userId);
      assert.match(body.messages[0].content, /(?:to|language) nl/);
      assert.equal(body.messages[0].content.includes("TRANSLATION_LIVE"), userId === 801);
      assert.match(body.messages[1].content, /Hello/);
      const calls = [];
      await writeRetrievedFindings({ userId, signal: new AbortController().signal,
        messages: [{ role: "user", content: "Study the collected evidence." }, { role: "tool", content: "Retrieved evidence ".repeat(7000) }],
        complete: async messages => { calls.push(messages); return "Cited findings from the supplied evidence."; } });
      assert.ok(calls.length > 2);
      assert.equal(calls[0][0].content.includes("EVIDENCE_LIVE"), userId === 801);
      assert.equal(calls.at(-1)[0].content.includes("REPORT_LIVE"), userId === 801);
    }
  } finally { for (const id of ["browser-translation", "research-evidence", "research-report"]) edit(id, null); }
});

test("slide, persona and social templates preserve their changing context", async () => {
  globalThis.__featurePromptFixture = { db };
  const builderStubs = {
    "../agent-browser/provider.ts": "export function chatmockApiKeyValue(){return 'fixture';}",
    "../conversations/agent-context.ts": "export function promptWithContext(prompt){return prompt;}",
    "../provider-error.ts": "export function humanizeProviderError(error){return String(error);}",
  };
  const slides = await bundleRoute("src/lib/bolt-slides/author.ts", {
    ...builderStubs,
    "../external-runtime-filesystem.ts": "export function externalRuntimeReadUtf8(){return 'Authoring instructions';}",
    "./runtime.ts": "export function resolveBoltSlidesRoot(){return '/fixture';}",
    "./kit-digest.ts": "export function kitDigest(){return null;} export function renderKitDigest(){return 'Available components';}",
  }, ["planSystemPrompt", "sourceSystemPrompt"]);
  const persona = await bundleRoute("src/lib/matraix/design.ts", {
    ...builderStubs,
    "./catalog.ts": "export function renderDimensionMenu(){return 'age: adult';}",
  }, ["systemPrompt"]);
  const social = await bundleRoute("src/lib/socials-manager/client.ts", builderStubs, ["systemPrompt"]);
  const cases = [
    ["slides-planning", "Plan {{slide_count}} slides. {{theme}}", () => slides.planSystemPrompt({ components: [{ name: "Cover" }] }, { slides: 8, theme: "auto" }, 801), /Plan 8 slides.*Choose the theme/s],
    ["slides-authoring", "Write slides. {{brand}}", () => slides.sourceSystemPrompt({ components: [], classes: [], tokensRoot: "--color: red;" }, { brandUrl: "https://example.test" }, 801), /https:\/\/example.test/],
    ["persona-study", "Survey {{respondents}} of {{population}}. {{dimensions}}", () => persona.systemPrompt({ count: 500 }, { respondents: 80 }, 801), /Survey 80 of 500\. age: adult/],
    ["social-posts", "{{networks}}\n{{current_time}}\n{{schedule}}", () => social.systemPrompt([{ id: "x", name: "X", maxCharacters: 280, editor: "plain" }], "2026-11-09T09:00", "2026-11-08T20:00", 801), /X.*280[\s\S]*2026-11-08T20:00[\s\S]*2026-11-09T09:00/],
  ];
  for (const [id, content, invoke, expected] of cases) {
    edit(id, content);
    try { assert.match(invoke(), expected); } finally { edit(id, null); }
  }
});

test("recommendation edits invalidate cached results and reject an old generation finishing late", async () => {
  const fixture = globalThis.__featurePromptFixture = { db, generated: [], evidence: [{ id: "gmail:1", source: "gmail", title: "Lab report", summary: "Please review the report." }], wait: null };
  fixture.generate = async input => { fixture.generated.push(input); if (fixture.wait) await fixture.wait; return [{ prompt: "Review the lab report", sourceIds: ["gmail:1"], sourceLabel: "Gmail" }]; };
  const originalCache = globalThis.breadboardRecommendationsV1;
  delete globalThis.breadboardRecommendationsV1;
  const recommendations = await bundleRoute("src/lib/recommendations/service.ts", {
    "server-only": "",
    "../db.ts": "export default globalThis.__featurePromptFixture.db;",
    "../hermes/runtime-store.ts": "export function getHermesUserSettings(){return {composerSwitches:{personalize:true},defaultModel:'test'};}",
    "../recall/settings.ts": "export function getRecallSettings(){return {};}",
    "./sources.ts": "export async function readRecommendationEvidence(){return globalThis.__featurePromptFixture.evidence;}",
    "./generate.ts": "export async function generateRecommendations(input){return globalThis.__featurePromptFixture.generate(input);}",
  });
  try {
    await recommendations.recommendationsForUser(801, {});
    await recommendations.recommendationsForUser(801, {});
    assert.equal(fixture.generated.length, 1);
    edit("personal-recommendations", "RECOMMENDATIONS_LIVE");
    await recommendations.recommendationsForUser(801, {});
    assert.equal(fixture.generated.length, 2);
    assert.equal(fixture.generated.at(-1).userId, 801);
    await recommendations.recommendationsForUser(802, {});
    assert.equal(fixture.generated.at(-1).userId, 802);
    recommendations.invalidateRecommendations(801);
    let release;
    fixture.wait = new Promise(resolve => { release = resolve; });
    const pending = recommendations.recommendationsForUser(801, {});
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(fixture.generated.length, 4);
    edit("personal-recommendations", "UPDATED_DURING_GENERATION");
    fixture.wait = null; release();
    assert.deepEqual(await pending, []);
    await recommendations.recommendationsForUser(801, {});
    assert.equal(fixture.generated.length, 5);
  } finally { edit("personal-recommendations", null); if (originalCache) globalThis.breadboardRecommendationsV1 = originalCache; else delete globalThis.breadboardRecommendationsV1; }
});

test("composed agent prompts replace sections once and retain runtime context", async () => {
  const { applySystemPromptSections } = await import("../src/lib/system-prompts/service.ts");
  const story = systemPromptText("film-story", 802);
  const scenes = systemPromptText("film-scenes", 802);
  const original = `Runtime context before\n${story}\nBetween sections\n${scenes}\nRuntime context after`;
  edit("film-story", scenes);
  edit("film-scenes", "SECOND_SECTION $&");
  try {
    assert.equal(applySystemPromptSections(original, 801, ["film-story", "film-scenes"]), `Runtime context before\n${scenes}\nBetween sections\nSECOND_SECTION $&\nRuntime context after`);
    assert.equal(applySystemPromptSections(original, 802, ["film-story", "film-scenes"]), original);
  } finally { edit("film-story", null); edit("film-scenes", null); }
});

test("video planning applies account overrides inside the actual structured request", async () => {
  globalThis.__featurePromptFixture = { db };
  const vox = await bundleRoute("src/lib/vox-director/model-client.ts", {
    "../agent-browser/provider.ts": "export function chatmockApiKeyValue(){return 'fixture';}",
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { arguments: '{"theme":"newsprint-editorial"}' } }] } }] });
  };
  const input = { request: { brief: "Microeconomics", style: null }, title: "Small choices", arc: "how_it_works", beatSummary: "Prices and tradeoffs", cloneRoot: temporary, themes: {} };
  try {
    for (const text of ["VIDEO_STYLE_ONE", "VIDEO_STYLE_TWO"]) {
      edit("video-style", text);
      for (const userId of [801, 802]) {
        await vox.chooseStyle({ userId, baseUrl: "http://fixture.local/v1", model: "test", reasoningEffort: "low" }, input);
        const sent = calls.at(-1);
        assert.equal(sent.messages[0].content.includes(text), userId === 801);
        assert.match(sent.messages[1].content, /Microeconomics/);
        assert.ok(sent.tools.length > 0);
      }
    }
  } finally { globalThis.fetch = originalFetch; edit("video-style", null); }
});

test("gesture and PDF helpers accept current prompts without bundling server modules", async () => {
  const fixture = globalThis.__featurePromptFixture = { db, userId: 801, calls: [] };
  fixture.client = { chat: { completions: { async create(body) {
    fixture.calls.push(body);
    return { choices: [{ message: { content: '{"action":{"kind":"assistant","prompt":"Show my calendar"}}' } }] };
  } } } };
  const gesture = await bundleRoute("src/app/api/profile/clap-action/interpret/route.ts", {
    "@/lib/chatmock-client.ts": "export const createChatmockClient=()=>globalThis.__featurePromptFixture.client;",
  });
  const { pdfViewDecisionMessages } = await import("../src/lib/pdf-assistant-view-decision.ts");
  try {
    for (const marker of ["FIRST", "SECOND"]) {
      edit("gesture-instructions", marker + " {{gesture}}");
      edit("pdf-view-decision", marker + " PDF");
      for (const userId of [801, 802]) {
        fixture.userId = userId;
        for (const control of ["clap", "snap"]) {
          const response = await gesture.POST(new Request("http://localhost/api/profile/clap-action/interpret?control=" + control, {
            method: "POST", headers: { origin: "http://localhost", host: "localhost" }, body: JSON.stringify({ prompt: "Show my calendar" }),
          }));
          assert.equal(response.status, 200, await response.text());
          const prompt = fixture.calls.at(-1).messages[0].content;
          if (userId === 801) assert.equal(prompt, marker + " " + (control === "snap" ? "finger-snap" : "clap"));
          else assert.match(prompt, /Prepare an AI instruction/);
        }
        const messages = pdfViewDecisionMessages({ question: "What does this mean?", title: "Paper", pageNumber: 2, pageText: "The diagram" }, systemPromptText("pdf-view-decision", userId));
        assert.equal(messages[0].content, systemPromptText("pdf-view-decision", userId));
      }
    }
    for (const relative of ["src/lib/profile/clap-action.ts", "src/lib/pdf-assistant-view-decision.ts"]) {
      const result = await esbuild.build({ entryPoints: [path.join(dashboard, relative)], bundle: true, write: false, platform: "browser", format: "esm", logLevel: "silent" });
      assert.ok(result.outputFiles[0].text.length < 50000, relative);
      assert.doesNotMatch(result.outputFiles[0].text, /better-sqlite3|promptStore\(|CREATE TABLE/);
    }
  } finally { edit("gesture-instructions", null); edit("pdf-view-decision", null); }
});

test("CAD prompt builders retain engine context and use each account's latest instruction", async () => {
  const { cadPlanningPrompt, cadSystemPrompt } = await import("../src/lib/cad/prompts.ts");
  const input = { userId: 801, safety: { level: "supported" }, attemptBudget: 3, existingProject: "Existing clamp" };
  for (const engine of ["cadquery", "solidworks"]) {
    const original = cadSystemPrompt({ ...input, userId: 802, engine });
    assert.match(original, /Existing clamp/);
    assert.match(original, engine === "solidworks" ? /operation program/ : /build_model\(params\)/);
    assert.doesNotMatch(original, /\{\{[a-z_]+\}\}/);
  }
  try {
    for (const marker of ["CAD_FIRST", "CAD_SECOND"]) {
      edit("cad-planning", marker + " {{engine}} wall {{wall}}");
      edit("cad-design", marker + " {{attempt_budget}}\n{{existing_project}}");
      assert.match(cadPlanningPrompt({ ...input, engine: "solidworks" }), new RegExp(marker + " solidworks wall "));
      assert.equal(cadSystemPrompt(input), marker + " 3\n\n## The design already in this conversation\nExisting clamp");
      assert.doesNotMatch(cadSystemPrompt({ ...input, userId: 802 }), new RegExp(marker));
    }
  } finally { edit("cad-planning", null); edit("cad-design", null); }
});

test("hardware design, validation repair and firmware use live prompts in model requests", async () => {
  const { interpretTurn, generateFirmwareLogic } = await import("../src/lib/hardware/model-client.ts");
  const originalFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { arguments: '{}' } }] } }] });
  };
  try {
    for (const marker of ["HARDWARE_ONE", "HARDWARE_TWO"]) {
      edit("hardware-design", marker + " {{component_library}}");
      edit("hardware-repair", marker + " REPAIR\n{{validation_issues}}");
      edit("hardware-firmware", marker + " FIRMWARE\n{{hardware_brief}}");
      for (const userId of [801, 802]) {
        const target = { userId, baseUrl: "http://fixture.local/v1", model: "test", brief: "Blink a lamp" };
        calls.length = 0;
        await interpretTurn(target).catch(() => {});
        assert.equal(calls.length, 2);
        assert.equal(calls[0].messages[0].content.startsWith(marker), userId === 801);
        if (userId === 801) {
          assert.ok(calls[0].messages[0].content.length > marker.length + 100);
          const repair = calls[1].messages.at(-1).content;
          assert.match(repair, new RegExp(marker + " REPAIR"));
          assert.doesNotMatch(repair, /\{\{validation_issues\}\}/);
        }
        await generateFirmwareLogic({ ...target, brief: "Pin LED is set up", behaviour: "Blink" });
        const firmware = calls.at(-1).messages[0].content;
        if (userId === 801) assert.equal(firmware, marker + " FIRMWARE\nPin LED is set up");
        else assert.match(firmware, /You write the application logic/);
      }
    }
  } finally { globalThis.fetch = originalFetch; for (const id of ["hardware-design", "hardware-repair", "hardware-firmware"]) edit(id, null); }
});

test("learning snapshots isolate concurrent accounts and keep in-flight prompt hashes stable", async () => {
  const { withSystemPromptContext, withGardenSystemPromptContext, scopedSystemPromptText } = await import("../src/lib/system-prompts/service.ts");
  const { createChatMockCritic } = await import("../src/lib/critic-loop.ts");
  db.prepare("INSERT INTO clusters (user_id, name, slug) VALUES (?, ?, ?)").run(801, "Prompt learning test", "prompt-learning-801");
  const calls = [];
  const critic = createChatMockCritic({ model: "fixture", client: { chat: { completions: { async create(body) { calls.push(body); return { choices: [{ message: { content: '{"issues":[]}' } }] }; } } } } });
  const packet = { gardenTitle: "Circuits", sections: [], sourceVisuals: [], pages: [], deterministicValidationSummary: "" };
  let unblock, entered;
  const gate = new Promise(resolve => { unblock = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const defaultPrompt = systemPromptText("learning-critic", 802);
  edit("learning-critic", "CRITIC_BEFORE");
  try {
    const running = withGardenSystemPromptContext("prompt-learning-801", async () => {
      assert.equal(scopedSystemPromptText("learning-critic"), "CRITIC_BEFORE");
      entered(); await gate;
      assert.equal(scopedSystemPromptText("learning-critic"), "CRITIC_BEFORE");
      await critic(packet);
      assert.equal(calls.at(-1).messages[0].content, "CRITIC_BEFORE");
    });
    await ready;
    edit("learning-critic", "CRITIC_AFTER");
    await withSystemPromptContext(802, async () => {
      await Promise.resolve();
      assert.equal(scopedSystemPromptText("learning-critic"), defaultPrompt);
      await critic(packet);
      assert.equal(calls.at(-1).messages[0].content, defaultPrompt);
    });
    unblock(); await running;
    await withGardenSystemPromptContext("prompt-learning-801", async () => {
      assert.equal(scopedSystemPromptText("learning-critic"), "CRITIC_AFTER");
      await critic(packet);
      assert.equal(calls.at(-1).messages[0].content, "CRITIC_AFTER");
    });
    assert.equal(scopedSystemPromptText("learning-critic"), defaultPrompt);
    assert.throws(() => withSystemPromptContext(801, () => { throw Error("test scope failure"); }), /test scope failure/);
    assert.equal(scopedSystemPromptText("learning-critic"), defaultPrompt);
  } finally { unblock(); edit("learning-critic", null); }
});

test("formula-review cache identities change with the saved prompt on the next run", async () => {
  globalThis.__featurePromptFixture = { db };
  const visual = await bundleRoute("src/lib/source-visuals.ts", {}, ["sourceFormulaReviewProtocolMetadata"], '\nexport function scopedMetadataForTest(gardenId) { return withGardenSystemPromptContext(gardenId, () => sourceFormulaReviewProtocolMetadata("v2")); }');
  const direct = await import("../src/lib/system-prompts/service.ts");
  const original = direct.systemPromptText("source-formula-review", 802);
  const expectedHash = text => require("node:crypto").createHash("sha256").update(text).digest("hex");
  assert.equal(visual.sourceFormulaReviewProtocolMetadata("v2").systemPromptSha256, expectedHash(original));
  for (const text of ["FORMULA_FIRST", "FORMULA_SECOND", ""]) {
    edit("source-formula-review", text);
    assert.equal(visual.scopedMetadataForTest("prompt-learning-801").systemPromptSha256, expectedHash(text));
    assert.equal(visual.scopedMetadataForTest("unknown-prompt-garden").systemPromptSha256, expectedHash(original));
  }
  edit("source-formula-review", null);
});

test("document-skill analysis reads the owning run's prompt on each new run", async () => {
  globalThis.__featurePromptFixture = { db };
  const builder = await bundleRoute("src/lib/document-skills/builder.ts", {}, [], '\nexport function analysisForTest(userId, client) { return withSystemPromptContext(userId, () => analyzeDocument(client, "fixture", "A chapter about circuits.", [], "Circuits")); }');
  const calls = [];
  const client = { chat: { completions: { async create(request) { calls.push(request); return { choices: [{ message: { content: JSON.stringify({ title: "Circuits", author: null, domain: "engineering", thesis: "Basic circuits", keyConcepts: [] }) } }] }; } } } };
  try {
    for (const marker of ["SKILL_ONE", "SKILL_TWO"]) {
      edit("document-skill-analysis", marker);
      for (const userId of [801, 802]) {
        await builder.analysisForTest(userId, client);
        assert.equal(calls.at(-1).messages[0].content.includes(marker), userId === 801);
        assert.match(calls.at(-1).messages[1].content, /circuits/i);
      }
    }
  } finally { edit("document-skill-analysis", null); }
});

test("interactive visual requests use saved prompts while retaining their runtime SDK values", async () => {
  const { generateVisualizationCandidate } = await import("../src/lib/generated-visuals.ts");
  const calls = [];
  const client = { chat: { completions: { async create(request) { calls.push(request); return { choices: [{ message: { content: JSON.stringify({ title: "Circuit value", explanation: "Displays a value.", sourceCode: "export default {};", testCases: [], accessibilityDescription: "One labelled result.", pedagogicalClaims: ["The result is finite."] }) } }] }; } } } };
  const opportunity = { id: "prompt-visual", gardenId: "prompt-learning-801", learningUnitId: "U1", targetPage: "learning/one.md", targetHeading: "Circuits", insertionAnchor: "learning-unit:U1:after-introduction", conceptIds: [], sourceAnchorIds: [], sourceVisualIds: [], sourceVisualRelationships: [], learningObjective: "Inspect a circuit.", learnerQuestion: "What is the value?", pedagogicalReason: "Show the result.", interactionGoal: "inspect_relationship", requiredInputs: [], requiredOutputs: [{ id: "result", label: "Result", representation: "value" }], controlContractProblems: [], requiresGeneratedModule: true, priority: "high", confidence: 1, similarityFingerprint: "prompt-visual", requirement: "recommended" };
  try {
    for (const marker of ["VISUAL_ONE", "VISUAL_TWO"]) {
      edit("learning-visual-author", marker + " {{sdk_import}} {{sdk_version}}");
      for (const gardenId of ["prompt-learning-801", "unowned-prompt-garden"]) {
        await generateVisualizationCandidate({ client, model: "fixture", opportunity: { ...opportunity, gardenId }, pageMarkdown: "Circuit learning context" });
        const system = calls.at(-1).messages[0].content;
        assert.equal(system.includes(marker), gardenId === "prompt-learning-801");
        assert.match(system, /@breadboard\/visual-sdk/);
        assert.doesNotMatch(system, /\{\{sdk_(?:import|version)\}\}/);
        assert.match(JSON.stringify(calls.at(-1).messages[1]), /Circuit learning context/);
      }
    }
  } finally { edit("learning-visual-author", null); }
});

test("every installed specialist is editable and selected personas use live account overrides", async () => {
  const { findAgencyAgent, loadAgencyAgentsCatalog, renderAgencyAgentPersona, renderChiefOfStaffOrchestration } = await import("../src/lib/hermes/agency-agents.ts");
  const catalog = loadAgencyAgentsCatalog();
  const prompts = new Map(listSystemPrompts(801).map(prompt => [prompt.id, prompt]));
  for (const agent of catalog.agents) assert.equal(prompts.get("agency-" + agent.slug)?.defaultContent, agent.instructions, agent.slug);
  const spotify = findAgencyAgent("agent-spotify");
  assert.ok(spotify);
  const original = renderAgencyAgentPersona(spotify, 802);
  try {
    for (const marker of ["PERSONA_ONE", "PERSONA_TWO", ""]) {
      edit("agency-agent-spotify", marker);
      const content = renderAgencyAgentPersona(spotify, 801);
      if (marker) assert.match(content, new RegExp(marker));
      assert.ok(!content.includes(spotify.instructions));
      assert.equal(renderAgencyAgentPersona(spotify, 802), original);
    }
    edit("agency-orchestration", "CUSTOM_ORCHESTRATION");
    assert.ok(renderChiefOfStaffOrchestration(catalog, 801).startsWith("CUSTOM_ORCHESTRATION"));
    assert.ok(!renderChiefOfStaffOrchestration(catalog, 802).includes("CUSTOM_ORCHESTRATION"));
    edit("agency-persona-wrapper", "{{name}} :: {{instructions}}");
    edit("agency-agent-spotify", "LITERAL {{name}} $&");
    assert.equal(renderAgencyAgentPersona(spotify, 801), spotify.name + " :: LITERAL {{name}} $&");
  } finally { for (const id of ["agency-agent-spotify", "agency-orchestration", "agency-persona-wrapper"]) edit(id, null); }
});

test("the chat composer preserves edits in the middle of long specialist prompts", async () => {
  const { composeHermesSystemPrompt } = await import("../src/lib/hermes/system-prompts.ts");
  const { findAgencyAgent, renderAgencyAgentPersona } = await import("../src/lib/hermes/agency-agents.ts");
  const decision = { mode:"knowledge", implementationRequired:false, allowedTools:[], authorizedRoots:[], authorizedPathPatterns:[], allowedOperations:["knowledge_work"], allowedCommandPatterns:[] };
  const agent = findAgencyAgent("agent-spotify");
  const first = "Intro. ".repeat(1800) + "MIDDLE_INSTRUCTION_ONE" + " End.".repeat(2200);
  try {
    for (const text of [first, first.replace("MIDDLE_INSTRUCTION_ONE", "MIDDLE_INSTRUCTION_TWO")]) {
      edit("agency-agent-spotify", text);
      for (const surface of ["dashboard_terminal", "garden_chat", "quartz_ai"]) {
        const composed = composeHermesSystemPrompt({userId:801,surface,decision,persona:renderAgencyAgentPersona(agent,801),additional:"Context ".repeat(100000)});
        assert.ok(composed.includes(text), surface);
        assert.ok(composed.length <= 240000);
        assert.ok(!composeHermesSystemPrompt({userId:802,surface,decision,persona:renderAgencyAgentPersona(agent,802)}).includes("MIDDLE_INSTRUCTION_"));
      }
    }
  } finally { edit("agency-agent-spotify", null); }
});

test("delegated persona requests use authenticated session ownership and reject forged scope", async () => {
  const fixture = globalThis.__featurePromptFixture = { db, verified: true,
    token: { userId: 801, conversationId: 701, breadboardSessionId: "901", hermesSessionId: "runtime-a" },
    session: { id: 901, user_id: 801, conversation_id: 701 }, conversation: { id: 701, user_id: 801 } };
  const route = await bundleRoute("src/app/api/hermes/tools/system-prompts/route.ts", {
    "@/lib/hermes/tool-service-auth.ts": "export const capabilityForInternalToolRequest=()=> 'fixture-token';",
    "@/lib/hermes/capability-token.ts": "export const verifyCapabilityToken=()=>({ok:globalThis.__featurePromptFixture.verified,token:globalThis.__featurePromptFixture.token});",
    "@/lib/hermes/runtime-store.ts": "export const getRuntimeSessionById=id=>id===901?globalThis.__featurePromptFixture.session:null; export const runtimeExternalSessionId=()=> 'runtime-a';",
    "@/lib/conversations/store.ts": "export const getConversationById=id=>id===701?globalThis.__featurePromptFixture.conversation:null;",
  });
  const request = (slug = "agent-spotify") => new Request("http://fixture.local/api/hermes/tools/system-prompts", { method: "POST", body: JSON.stringify({ action: "system_prompt_persona", args: { slug, userId: 802 } }) });
  try {
    for (const marker of ["DELEGATE_ONE", "DELEGATE_TWO"]) {
      edit("agency-agent-spotify", marker);
      const response = await route.POST(request());
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match((await response.json()).persona, new RegExp(marker));
    }
    fixture.verified = false;
    assert.equal((await route.POST(request())).status, 403);
    fixture.verified = true; fixture.token.userId = 802;
    assert.equal((await route.POST(request())).status, 403);
    fixture.token.userId = 801; fixture.token.hermesSessionId = "other-runtime";
    assert.equal((await route.POST(request())).status, 403);
    fixture.token.hermesSessionId = "runtime-a"; fixture.conversation.user_id = 802;
    assert.equal((await route.POST(request())).status, 403);
    fixture.conversation.user_id = 801;
    assert.equal((await route.POST(request("../secret"))).status, 400);
    assert.deepEqual(await (await route.POST(request("unknown-persona-fixture"))).json(), { persona: null });
    edit("agency-persona-wrapper", "");
    assert.deepEqual(await (await route.POST(request())).json(), { persona: "" });
  } finally { edit("agency-agent-spotify", null); edit("agency-persona-wrapper", null); }
});
