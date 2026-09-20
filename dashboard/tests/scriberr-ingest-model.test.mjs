import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import esbuild from "esbuild";

test("media concept extraction and source writing follow the user's selected model", async () => {
  const calls = [];
  globalThis.__scriberrModelCalls = calls;
  try {
    const built = await esbuild.build({
      entryPoints: [path.resolve(import.meta.dirname, "../src/lib/scriberr/ingest.ts")],
      bundle: true, platform: "node", format: "esm", write: false,
      plugins: [{ name: "ingest-model-dependencies", setup(build) {
        build.onResolve({ filter: /(?:knowledge|garden-mutation-lease|quartz-publish|video-source-store)\.ts$/ }, args => ({ path: args.path, namespace: "model-stub" }));
        build.onLoad({ filter: /.*/, namespace: "model-stub" }, () => ({ contents: `
          export const createChatmockClient = () => ({});
          export async function extractDocumentKnowledge(input) { globalThis.__scriberrModelCalls.push({stage: "extract", model: input.model}); return {summary: "Real extraction", topics: []}; }
          export async function writeDocumentKnowledge(input) { globalThis.__scriberrModelCalls.push({stage: "write", model: input.model, extraction: input.extraction}); return {sourceSlug: "lecture", sourceRelPath: "sources/lecture.md", sourceTitle: input.sourceTitle, wordCount: 3}; }
          export const slugify = value => value.toLowerCase();
          export const refreshClusterIndex = () => {};
          export const acquireGardenMutationLease = () => ({release() {}});
          export const publishQuartzAfterMutation = async () => {};
          export const sourceSlugExists = () => false;
        ` }));
      } }],
    });
    const { ingestTranscriptSource } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
    await ingestTranscriptSource({userId: 1, contentPath: "/content", clusterSlug: "physics", sourceTitle: "Lecture", sourceFileName: "lecture.mp3", sourceLabel: "Lecture", markdownBody: "Transcript", plainText: "Transcript", metadata: {}, mediaKind: "audio", jobId: "vtj-test"});
    assert.deepEqual(calls.map(c => [c.stage, c.model]), [["extract", "default"], ["write", "default"]]);
    assert.equal(calls[1].extraction.summary, "Real extraction");
  } finally { delete globalThis.__scriberrModelCalls; }
});
