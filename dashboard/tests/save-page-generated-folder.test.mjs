import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import os from "node:os";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { parse } from "yaml";

const dashboardRoot = path.resolve(import.meta.dirname, "..");

test("Save page creates new chat pages inside the Generated folder", () => {
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src/app/api/generate-notes/route.ts"),
    "utf8",
  );
  const chatNoteBranch = source.match(
    /if \(mode === "chat-note"\) \{([\s\S]*?)\n    const client = new OpenAI/,
  )?.[1];

  assert.ok(chatNoteBranch, "expected to find the chat-note save branch");
  assert.match(source, /const SAVE_PAGE_FOLDER = "Generated";/);
  assert.match(
    chatNoteBranch,
    /const generatedDir = path\.join\(clusterDir, SAVE_PAGE_FOLDER\);/,
  );
  assert.match(
    chatNoteBranch,
    /const newNotePath = path\.join\(generatedDir, `\$\{finalSlug\}\.md`\);/,
  );
  assert.match(
    chatNoteBranch,
    /fs\.mkdirSync\(generatedDir, \{ recursive: true \}\);/,
  );
});

test("Save page never merges into hidden concepts and its created Markdown publishes in Quartz", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "save-page-visible-"));
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = temp;
  const state = { nodes: [], placements: [], publications: [], merge: false };
  globalThis.__savePageFixture = state;
  const stubs = {
    "next/server": "export const NextResponse = Response;",
    "@/lib/server-auth": `export const requireOwnedClusterFromSlug=async slug=>({cluster:{slug},userId:1});
      export const routeErrorResponse=e=>Response.json({error:e.message},{status:500});`,
    "@/lib/chatmock-server":
      "export const resolveChatmockBaseUrl=()=>({baseURL:'http://fixture.invalid'});",
    "@/lib/ai-models": "export const DEFAULT_MODEL='fixture';",
    "@/lib/council": "export const withCouncil=request=>request;",
    "@/lib/garden-mutation-lease":
      "export const acquireGardenMutationLease=()=>({release(){}});",
    "@/lib/quartz-publish":
      "export const publishQuartzAfterMutation=async reason=>{globalThis.__savePageFixture.publications.push(reason)};",
    "@/lib/knowledge": `import path from 'node:path';
      export const scanClusterKnowledge=()=>({nodes:globalThis.__savePageFixture.nodes});
      export const slugify=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      export const semanticTagsFromText=()=>['charge-density'];
      export const normalizeTopicTags=tags=>tags;
      export const refreshClusterIndex=()=>{};
      export const resolveClusterNoteFile=(root,garden,slug)=>({filePath:path.join(root,garden,globalThis.__savePageFixture.nodes.find(n=>n.slug===slug).relPath)});`,
    openai: String.raw`export default class OpenAI {
      chat={completions:{create:async request=>{
        const state=globalThis.__savePageFixture;
        const system=request.messages[0].content;
        let content='["charge-density"]';
        if(system.startsWith('You decide')){
          const prompt=JSON.parse(request.messages[1].content); state.placements.push(prompt);
          content=JSON.stringify({action:state.merge?'merge':'create',targetSlug:prompt.fullCandidateNotes[0].slug});
        } else if(system.startsWith('Merge two')) content='## Charge density\n\nMerged visible lesson.';
        return {choices:[{message:{content}}]};
      }}};
    }`,
  };
  const compile = async (entryPoints, plugins = []) => {
    const result = await build({
      entryPoints,
      bundle: true,
      platform: "node",
      format: "cjs",
      packages: "external",
      write: false,
      plugins,
    });
    const module = { exports: {} };
    new Function("require", "module", "exports", result.outputFiles[0].text)(
      createRequire(import.meta.url),
      module,
      module.exports,
    );
    return module.exports;
  };
  try {
    const { POST } = await compile(
      [path.join(dashboardRoot, "src/app/api/generate-notes/route.ts")],
      [
        {
          name: "save-fixture",
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, (args) =>
              stubs[args.path] === undefined
                ? undefined
                : { path: args.path, namespace: "fixture" },
            );
            builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
              contents: stubs[args.path],
              loader: "ts",
            }));
          },
        },
      ],
    );
    const { RemoveDrafts } = await compile([
      path.join(dashboardRoot, "../quartz/quartz/plugins/filters/draft.ts"),
    ]);
    const node = (slug, overrides = {}) => ({
      slug,
      title: "Charge density",
      relPath: `${slug}.md`,
      tags: ["charge-density"],
      excerpt: "Charge density and electric force",
      content: "Existing original content.",
      type: "user-note",
      ...overrides,
    });
    state.nodes = [
      node("hidden-concept", {
        type: "internal-concept",
        breadboardType: "internal_concept",
        draft: "true",
        relPath: "Internal/Concept Graph/charge.md",
      }),
      node("hidden-by-path", { relPath: "Internal/mislabeled.md" }),
      node("draft", { draft: "true" }),
      node("internal", { internal: "true" }),
      node("source", { type: "source-document", relPath: "sources/charge.md" }),
      node("old-topic", {
        type: "knowledge-topic",
        relPath: "generated/old-topic.md",
      }),
      node("planning", { type: "scope-contract" }),
      node("scaffolding", {
        type: "learning-page",
        relPath: "1. Old source/charge.md",
      }),
    ];
    for (const item of state.nodes) {
      const target = path.join(temp, "physics", item.relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, item.content);
    }
    const save = () =>
      POST(
        new Request("http://localhost/api/generate-notes", {
          method: "POST",
          body: JSON.stringify({
            clusterSlug: "physics",
            mode: "chat-note",
            messages: [
              {
                role: "assistant",
                content:
                  "## Charge density\n\nThe saved answer about charge density and electric force.",
              },
            ],
          }),
        }),
      );
    const response = await save();
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.notes[0].action, "created");
    assert.equal(
      state.placements.length,
      0,
      "hidden nodes must never be offered to the placement model",
    );
    const relPath = `Generated/${result.notes[0].slug}.md`;
    const saved = fs.readFileSync(path.join(temp, "physics", relPath), "utf8");
    assert.match(saved, /The saved answer/);
    assert.doesNotMatch(
      saved,
      /## Related notes/,
      "hidden nodes must not leak into related links",
    );
    for (const item of state.nodes)
      assert.equal(
        fs.readFileSync(path.join(temp, "physics", item.relPath), "utf8"),
        item.content,
      );
    const frontmatter = parse(saved.match(/^---\n([\s\S]*?)\n---/)[1]);
    assert.equal(
      RemoveDrafts().shouldPublish({}, [
        null,
        { data: { frontmatter, relativePath: `physics/${relPath}` } },
      ]),
      true,
    );

    const visible = node("visible", {
      type: "learning-page",
      generated_by: "document_ingestion",
      relPath: "Concepts/charge.md",
    });
    fs.mkdirSync(path.join(temp, "physics/Concepts"));
    fs.writeFileSync(
      path.join(temp, "physics", visible.relPath),
      visible.content,
    );
    state.nodes.push(visible);
    state.merge = true;
    const merged = await (await save()).json();
    assert.equal(merged.notes[0].action, "merged");
    assert.equal(merged.notes[0].slug, "visible");
    assert.deepEqual(
      state.placements[0].fullCandidateNotes.map((n) => n.slug),
      ["visible"],
    );
    assert.match(
      fs.readFileSync(path.join(temp, "physics", visible.relPath), "utf8"),
      /Merged visible lesson/,
    );
    assert.equal(state.publications.length, 2);
  } finally {
    if (previous === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previous;
    delete globalThis.__savePageFixture;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
