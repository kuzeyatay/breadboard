import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");

async function fixtureModule(entry, stubs) {
  const output = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false,
    platform: "node", format: "esm", alias: { "@": path.join(root, "src") },
    plugins: [{ name: "dependencies", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        const name = Object.keys(stubs).find(key => args.path === key || args.path.endsWith(`/${key}`));
        if (name) return { path: name, namespace: "stub" };
      });
      builder.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ contents: stubs[args.path], loader: "js" }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
}

const filesystem = {
  "external-runtime-filesystem.ts": 'export {default as externalRuntimeFilesystem} from "node:fs";',
  "external-runtime-path.ts": 'export {default as externalRuntimePath} from "node:path";',
};

test("Learn artifact route authorizes ownership, pins selection, and refuses locked/malformed writes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "learn-artifacts-route-"));
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = dir;
  globalThis.learnArtifactFixture = { owner: true, locked: false, reads: 0, writes: 0, artifactGarden: "demo" };
  try {
    const route = await fixtureModule("src/app/api/gardens/[gardenId]/learn/artifacts/route.ts", {
      ...filesystem,
      "next/server": 'export const NextResponse={json:Response.json.bind(Response)};',
      "@/lib/server-auth": `export async function requireOwnedClusterFromSlug(){if(!globalThis.learnArtifactFixture.owner)throw Object.assign(new Error('Forbidden'),{status:403});return {userId:1,cluster:{slug:'demo'}};}export const routeErrorResponse=e=>Response.json({error:e.message},{status:e.status||500});`,
      "artifact-store.ts": `export class ArtifactStoreError extends Error{}; export function getArtifactForUser(input){globalThis.learnArtifactFixture.reads++;if(input.userId!==1||input.conversationPublicId!=='chat')throw new Error('scope mismatch');return {id:input.artifactId,garden_slug:globalThis.learnArtifactFixture.artifactGarden};}`,
      "learn-artifact-snapshot.ts": `export async function snapshotArtifactForLearn(artifact,version){return {id:artifact.id,conversationId:'chat',version,title:'Circuit',kind:'html',renderer:'interactive-visualizer',filename:'circuit.html',content:'Actual model source',contentHash:'hash',previewUrl:'/preview',downloadUrl:'/download'};}`,
      "garden-mutation-lease.ts": `export function acquireGardenMutationLease(){if(globalThis.learnArtifactFixture.locked)throw Object.assign(new Error('Learn is running'),{busy:true});globalThis.learnArtifactFixture.writes++;return {release(){}};}export const isGardenMutationBusyError=e=>e.busy===true;`,
    });
    const context = { params: Promise.resolve({ gardenId: "demo" }) };
    const payload = { artifactId: "art_a", conversationId: "chat", version: 2, included: true };
    const post = body => route.POST(new Request("http://localhost/artifacts", { method: "POST", body: JSON.stringify(body) }), context);
    assert.equal((await post(payload)).status, 200);
    const selected = await (await route.GET(new Request("http://localhost/artifacts"), context)).json();
    assert.equal(selected.artifacts[0].version, 2);
    assert.equal(selected.artifacts[0].content, undefined, "list UI does not download complete source payloads");
    assert.match(fs.readFileSync(path.join(dir, "demo/.breadboard/learn-artifacts.json"), "utf8"), /Actual model source/);
    const f = globalThis.learnArtifactFixture;
    f.owner = false;
    const reads = f.reads;
    assert.equal((await post(payload)).status, 403);
    assert.equal(f.reads, reads, "unauthorized requests never inspect an artifact");
    f.owner = true; f.artifactGarden = "private";
    assert.equal((await post(payload)).status, 404);
    f.artifactGarden = "demo"; f.locked = true;
    assert.equal((await post({ ...payload, included: false })).status, 409);
    f.locked = false;
    assert.equal((await post({ ...payload, version: -1 })).status, 400);
    assert.equal((await post(null)).status, 400);
    assert.equal((await post({ ...payload, included: false })).status, 200);
    assert.deepEqual((await (await route.GET(new Request("http://localhost/artifacts"), context)).json()).artifacts, []);
  } finally {
    if (previous === undefined) delete process.env.QUARTZ_CONTENT_PATH; else process.env.QUARTZ_CONTENT_PATH = previous;
    delete globalThis.learnArtifactFixture;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Learn snapshots include the actual rendered HTML and extracted document text without executing code", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "learn-artifact-source-"));
  globalThis.learnArtifactSnapshotFixture = { filename: path.join(dir, "model.html"), status: "ready", mimeType: "text/html" };
  try {
    fs.writeFileSync(globalThis.learnArtifactSnapshotFixture.filename, '<button>Change charge</button><script>globalThis.shouldNeverExecute=true</script>');
    const module = await fixtureModule("src/lib/hermes/learn-artifact-snapshot.ts", {
      ...filesystem,
      "artifact-store.ts": `
        export class ArtifactStoreError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
        export const getArtifactVersion=()=>({status:globalThis.learnArtifactSnapshotFixture.status,metadata_json:'{}',preview_location:'preview',output_location:'output'});
        export const artifactDeliveryFile=()=>({absolutePath:globalThis.learnArtifactSnapshotFixture.filename,filename:'model.html',mimeType:globalThis.learnArtifactSnapshotFixture.mimeType,byteSize:100});
        export const readArtifactSource=()=>'{"model":"Electric charge"}';
        export const presentArtifact=a=>({...a,renderer:a.renderer_id,mimeType:a.mime_type,metadata:{}});
      `,
      "artifact-editor-types.ts": 'export const artifactEditorMode=()=>"pdf";',
      "artifact-document-editor.ts": 'export const loadArtifactEditor=async()=>({content:"Extracted textbook paragraph"});',
    });
    const artifact = { id: "art_a", conversation_public_id: "chat", kind: "html", renderer_id: "interactive-visualizer", title: "Electric charge", filename: "model.html" };
    const snapshot = await module.snapshotArtifactForLearn(artifact, 3);
    assert.match(snapshot.content, /Electric charge/);
    assert.match(snapshot.content, /Change charge/);
    assert.match(snapshot.previewUrl, /version=3/);
    assert.equal(globalThis.shouldNeverExecute, undefined);
    globalThis.learnArtifactSnapshotFixture.mimeType = "application/pdf";
    const pdf = await module.snapshotArtifactForLearn({ ...artifact, kind: "pdf", renderer_id: "pdf-file" }, 1);
    assert.match(pdf.content, /Extracted textbook paragraph/);
    globalThis.learnArtifactSnapshotFixture.status = "failed";
    await assert.rejects(module.snapshotArtifactForLearn(artifact, 4), error => error.status === 409);
  } finally {
    delete globalThis.learnArtifactSnapshotFixture;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
