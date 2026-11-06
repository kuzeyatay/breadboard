import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import ts from "typescript";

const require = createRequire(import.meta.url);
const routeFile = fileURLToPath(new URL("../src/app/api/markdown-edit/route.ts", import.meta.url));
const fixtureKey = "__markdownEditRouteFixture";
const bundle = await build({
  entryPoints: [routeFile], bundle: true, platform: "node", format: "cjs", write: false,
  plugins: [{ name: "markdown-edit-dependencies", setup(builder) {
    builder.onResolve({ filter: /^(?:@\/lib\/|next\/server$)/ }, args => ['@/lib/garden-document-path', '@/lib/markdown-math-edit'].includes(args.path)
      ? { path: path.resolve(import.meta.dirname, '../src/lib', `${args.path.split('/').at(-1)}.ts`) }
      : { path: args.path, namespace: "fixture" });
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => {
      const name = args.path.split("/").at(-1);
      const modules = {
        server: "export const NextResponse={json:(data,init)=>Response.json(data,init)};",
        "external-runtime-path": "export {default as externalRuntimePath} from 'node:path';",
        "external-runtime-filesystem": "export {default as externalRuntimeFilesystem} from 'node:fs';",
        "ai-models": "export const DEFAULT_MODEL='selected-model';",
        "chat-token-usage": "export const chatTokenUsageFromResponse=r=>r.usage;",
        "knowledge": `export const resolveClusterNoteFile=()=>({filePath:f.file});
          export const refreshClusterIndex=(_root,_slug,options)=>{f.refresh=options;};`,
        "garden-semantics": "export const updateLearnerPageConcepts=()=>{throw Error('Unexpected tag edit')};",
        "quartz-publish": `export const publishQuartzAfterMutation=async(_reason,options)=>{
          f.publications.push({leased:f.leased,options});
          if(f.failPublication)throw Error('publication failed');
          return new Promise(()=>{});
        };`,
        "garden-mutation-lease": `export const acquireGardenMutationLease=()=>{
          f.leased=true;return{release:()=>{f.leased=false;f.releases++}};
        };`,
        "chatmock-server": "export const resolveChatmockBaseUrl=()=>({baseURL:'http://model.test/v1'});",
        "chatmock-client": `export const createChatmockClient=()=>({chat:{completions:{create:async(params,options)=>{
          f.calls.push({params,options});await f.beforeReply?.();return {
            choices:[{finish_reason:f.finishReason??'stop',message:{refusal:f.refusal,content:f.rawResponse??JSON.stringify({summary:'Fixed formatting.',content:f.replacement})}}],
            usage:{inputTokens:12,outputTokens:6,totalTokens:18},
          };
        }}}});`,
        council: "export const withCouncil=(params,fields)=>({...params,...fields});",
        "server-auth": `export const requireOwnedClusterFromSlug=async()=>({userId:1,cluster:{slug:'physics',name:'Physics'}});
          export const routeErrorResponse=error=>Response.json({error:error.message},{status:500});`,
      };
      assert.ok(modules[name], `missing fixture ${name}`);
      return { contents: `const f=globalThis.${fixtureKey};\n${modules[name]}`, loader: "js" };
    });
  } }],
});

async function fixture(run, { fileName = 'fields', slug = fileName, instruction = 'Fix the Markdown formatting', original = "---\ntitle: Fields\n---\n\n\\# Fields\n" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-edit-"));
  const garden = path.join(root, "physics");
  fs.mkdirSync(garden);
  const file = path.join(garden, `${fileName}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, original);
  const state = { file, original, replacement: original.replace("\\#", "#"), calls: [], publications: [], releases: 0, leased: false };
  const prior = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = root;
  globalThis[fixtureKey] = state;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, loaded, loaded.exports);
  const controller = new AbortController();
  const request = new Request("http://localhost/api/markdown-edit", {
    method: "POST", signal: controller.signal,
    body: JSON.stringify({ clusterSlug: "physics", slug, instruction, model: "my-model" }),
  });
  try { await run({ state, request, controller, post: loaded.exports.POST }); }
  finally {
    if (prior === undefined) delete process.env.QUARTZ_CONTENT_PATH; else process.env.QUARTZ_CONTENT_PATH = prior;
    delete globalThis[fixtureKey];
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('LaTeX delimiter repairs save without a model response or tag rewriting', async () => {
  const metadata = '---\ntitle: Fields\ntags: [RC, filters]\n---\n\n';
  const original = metadata + String.raw`For \(Z_1\) and \(Z_2\), use \(\widetilde V_{\mathrm{out}}=Z_2\widetilde I\).`;
  await fixture(async ({ state, request, post }) => {
    state.rawResponse = 'Invalid model response must be irrelevant to this repair';
    const response = await post(request);
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    assert.equal(body.content, metadata + String.raw`For $Z_1$ and $Z_2$, use $\widetilde V_{\mathrm{out}}=Z_2\widetilde I$.`);
    assert.equal(fs.readFileSync(state.file, 'utf8'), body.content);
    assert.equal(body.usage, undefined);
    assert.equal(state.calls.length, 0);
    assert.equal(state.publications.length, 1);
    assert.equal(state.releases, 1);
    const history = path.join(path.dirname(state.file), '.breadboard/markdown-edit-history');
    const backups = fs.readdirSync(history, { recursive: true }).filter(name => name.endsWith('.md'));
    assert.equal(fs.readFileSync(path.join(history, backups[0]), 'utf8'), original);
  }, { instruction: 'fix the latex of this markdown', original });
});

test('formatting requests with no delimiter repair and compound requests still use the model', async () => {
  for (const instruction of ['fix the latex of this markdown', 'Fix the LaTeX and explain Kirchhoff laws']) {
    await fixture(async ({ state, request, post }) => {
      assert.equal((await post(request)).status, 200);
      assert.equal(state.calls.length, 1);
    }, { instruction });
  }
});

test('single-note edits accept source names matching the garden', async () => {
  for (const [fileName, slug] of [['physics', 'physics'], ['sources/physics', 'sources/physics'], ['sources/physics', 'physics/sources/physics']]) {
    await fixture(async ({ state, request, post }) => {
      const response = await post(request);
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(fs.readFileSync(state.file, 'utf8'), state.replacement);
    }, { fileName, slug });
  }
});

test("one-note edits return the canonical save while publication is stalled, with the lease released", async () => {
  await fixture(async ({ state, request, post }) => {
    let timer;
    try {
      const response = await Promise.race([
        post(request),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Save waited for the site rebuild")), 1_000); }),
      ]);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.content, state.replacement);
      assert.equal(fs.readFileSync(state.file, "utf8"), state.replacement);
      const history = path.join(path.dirname(state.file), ".breadboard/markdown-edit-history");
      const backups = fs.readdirSync(history, { recursive: true }).filter(name => name.endsWith(".md"));
      assert.equal(backups.length, 1);
      assert.equal(fs.readFileSync(path.join(history, backups[0]), "utf8"), state.original);
      assert.equal(state.calls.length, 1);
      assert.equal(state.calls[0].params.councilModeOverride, "direct_council");
      assert.equal(state.calls[0].params.model, "my-model");
      assert.equal(state.calls[0].options.signal, request.signal);
      assert.deepEqual(state.refresh, { migrateSources: false });
      assert.deepEqual(state.publications, [{ leased: false, options: { userId: 1, gardenSlug: "physics" } }]);
      assert.equal(state.releases, 1);
      assert.equal(state.leased, false);
    } finally { clearTimeout(timer); }
  });
});

test("invalid, empty, refused and truncated model responses never overwrite or publish a note", async () => {
  const cases = [
    { rawResponse: JSON.stringify({ summary: "I can't safely return a complete updated Markdown file. Please attach the note.", content: "" }) },
    { rawResponse: JSON.stringify({ summary: "Unable to edit", content: "   \n" }) },
    { rawResponse: '{"summary":"Updated","content":"unfinished' },
    { rawResponse: "null" },
    { rawResponse: "[]" },
    { rawResponse: JSON.stringify({ summary: "No content" }) },
    { rawResponse: JSON.stringify({ summary: "Wrong type", content: 123 }) },
    { rawResponse: "I cannot access the current note. Please attach it." },
    { rawResponse: "# A raw Markdown response is not the required edit envelope" },
    { finishReason: "length" },
    { finishReason: "content_filter" },
    { refusal: "Unable to complete the edit" },
    { replacement: "# Fields\n\nMetadata was lost." },
    { replacement: "---\ndate: 2026-09-23\n---\n\n# Fields\n" },
  ];
  for (const invalid of cases) await fixture(async ({ state, request, post }) => {
    Object.assign(state, invalid);
    const response = await post(request);
    assert.equal(response.status, 502, JSON.stringify(invalid));
    assert.match((await response.json()).error, /note was not changed/i);
    assert.equal(fs.readFileSync(state.file, "utf8"), state.original);
    assert.equal(state.publications.length, 0);
    assert.equal(state.refresh, undefined);
    assert.equal(state.releases, 0);
  });
});

test("a fenced JSON edit preserves authored whitespace and saves a recovery copy", async () => {
  await fixture(async ({ state, request, post }) => {
    state.replacement = state.replacement + "\nA line with a hard break.  \n\n";
    state.rawResponse = "```json\n" + JSON.stringify({ summary: "Updated", content: state.replacement }) + "\n```";
    assert.equal((await post(request)).status, 200);
    assert.equal(fs.readFileSync(state.file, "utf8"), state.replacement);
  });
});

test("an unavailable recovery directory prevents the overwrite", async () => {
  await fixture(async ({ state, request, post }) => {
    fs.writeFileSync(path.join(path.dirname(state.file), ".breadboard"), "blocks directory creation");
    assert.equal((await post(request)).status, 500);
    assert.equal(fs.readFileSync(state.file, "utf8"), state.original);
    assert.equal(state.publications.length, 0);
    assert.equal(state.releases, 1);
  });
});

test("figure requests use the Garden agent instead of the single-note rewrite", () => {
  const source = fs.readFileSync(new URL("../src/app/garden/garden-assistant.tsx", import.meta.url), "utf8");
  const start = source.indexOf("function wantsOpenMarkdownEdit(");
  const end = source.indexOf("\nfunction formatChatTime(", start);
  const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const wantsEdit = new Function(`${js};return wantsOpenMarkdownEdit;`)();
  for (const request of [
    "can you add relevant figures to this markdown?",
    "Insert diagrams from the source notes into the open document",
    "Add useful images from other markdowns",
    "Use a relevant chart in this note",
    "Append figures",
  ]) assert.equal(wantsEdit(request), false, request);
  assert.equal(wantsEdit("Fix the LaTeX in this markdown"), true);
  assert.equal(wantsEdit("Update tags in the open note"), true);
});

test("a failed site build does not turn an already saved edit into an error", async () => {
  await fixture(async ({ state, request, post }) => {
    state.failPublication = true;
    const response = await post(request);
    assert.equal(response.status, 200);
    assert.equal(fs.readFileSync(state.file, "utf8"), state.replacement);
    assert.equal(state.leased, false);
  });
});

test("cancelling an edit prevents a late model response from writing", async () => {
  await fixture(async ({ state, request, controller, post }) => {
    state.beforeReply = () => controller.abort();
    assert.equal((await post(request)).status, 500);
    assert.equal(fs.readFileSync(state.file, "utf8"), state.original);
    assert.equal(state.publications.length, 0);
    assert.equal(state.releases, 0);
  });
});

test("an edit cannot overwrite another save made during model generation", async () => {
  await fixture(async ({ state, request, post }) => {
    state.beforeReply = () => fs.writeFileSync(state.file, "Concurrent edit\n");
    assert.equal((await post(request)).status, 409);
    assert.equal(fs.readFileSync(state.file, "utf8"), "Concurrent edit\n");
    assert.equal(state.publications.length, 0);
    assert.equal(state.releases, 1);
  });
});

test("the Garden edit branch keeps its reserved answer identity and cancels its HTTP request", async () => {
  const source = fs.readFileSync(new URL("../src/app/garden/garden-assistant.tsx", import.meta.url), "utf8");
  const start = source.indexOf("      if (activeMarkdown && !selectedText && wantsOpenMarkdownEdit(text)");
  const end = source.indexOf("\n      const signal = viewerSignal;", start);
  assert.ok(start > 0 && end > start);
  const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const signal = new AbortController().signal;
  let saved, updated;
  const dependencies = {
    activeMarkdown: { cluster: "physics", slug: "fields", content: "Old" }, selectedText: "", wantsOpenMarkdownEdit: () => true,
    text: "fix Markdown", pendingAttachments: [], nextMessages: [], model: "my-model", reasoningEffort: "ultra", turnSignal: signal,
    fetch: async (_url, init) => {
      assert.equal(init.signal, signal);
      return Response.json({ success: true, content: "New", title: "Fields", summary: "Fixed formatting." });
    },
    normalizeChatTokenUsage: () => null, responseStartedAt: performance.now(), turnCreatedAt: new Date().toISOString(),
    steerContext: { messages: [] }, setMessages: () => {}, session: { id: 1 }, sessionTitle: "Edit note",
    persistChatSession: async (_id, messages) => { saved = messages; },
    window: { dispatchEvent: event => { updated = event.detail; } }, CustomEvent,
  };
  await new Function(...Object.keys(dependencies), `return(async()=>{
    let assistantMessage={id:'msg_42',clientMessageId:'turn-12345',role:'assistant',content:''};
    ${js}
  })()`)(...Object.values(dependencies));
  assert.equal(saved[0].id, "msg_42");
  assert.equal(saved[0].clientMessageId, "turn-12345");
  assert.match(saved[0].content, /Saved changes/);
  assert.equal(updated.content, "New");
});
