import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

test("recovery status distinguishes queued work, unavailable status, failure, and completion", async t => {
  const record = { recoveryId: "rec_test", gardenId: "telecom-1", userId: 1, resumedJobId: "job_test" };
  let state = "queued", discarded = 0, cleared = 0;
  globalThis.__ingestRecoveryRoute = {
    list: () => [record, { ...record, recoveryId: "rec_other", userId: 2 }],
    inspect: async () => {
      if (state === "unavailable") throw Object.assign(new Error("offline"), { status: 503 });
      if (state === "missing") throw Object.assign(new Error("gone"), { status: 404 });
      return { state };
    },
    discard: () => { discarded++; },
    clear: () => { cleared++; return { ...record, resumedJobId: null }; },
  };
  t.after(() => { delete globalThis.__ingestRecoveryRoute; });
  const stubs = {
    "next/server": "export const NextResponse = Response;",
    "@/lib/server-auth": `export const requireOwnedClusterFromSlug = async () => ({userId:1,cluster:{slug:'telecom-1'}}); export const routeErrorResponse = e => Response.json({error:e.message},{status:500});`,
    "@/lib/supervisor-control": "export const inspectRuntimeJobForStatus = () => globalThis.__ingestRecoveryRoute.inspect();",
    "@/lib/runtime-v2/ingest-recovery-store": `
      export const listIngestRecoveries = () => globalThis.__ingestRecoveryRoute.list();
      export const discardIngestRecovery = () => globalThis.__ingestRecoveryRoute.discard();
      export const markIngestRecoveryResumed = () => globalThis.__ingestRecoveryRoute.clear();
      export const publicIngestRecovery = (record, resumedState = null) => ({recoveryId:record.recoveryId,resumedJobId:record.resumedJobId,resumedState});
    `,
  };
  const bundle = await build({
    entryPoints: [path.resolve(import.meta.dirname, "../src/app/api/gardens/[gardenId]/ingest-recovery/route.ts")],
    bundle: true, platform: "node", format: "cjs", write: false,
    plugins: [{ name: "recovery-route-fixture", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => stubs[args.path] ? { path: args.path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "ts" }));
    } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const get = () => module.exports.GET(new Request("http://localhost/recoveries"), { params: Promise.resolve({ gardenId: "telecom-1" }) }).then(response => response.json());
  assert.deepEqual((await get()).recoveries, [{ recoveryId: "rec_test", resumedJobId: "job_test", resumedState: "queued" }]);
  state = "running";
  assert.equal((await get()).recoveries[0].resumedState, "running");
  state = "unavailable";
  assert.equal((await get()).recoveries[0].resumedState, null);
  assert.equal(cleared, 0, "an outage must not allow a duplicate resume");
  for (state of ["failed", "cancelled", "missing"]) {
    assert.equal((await get()).recoveries[0].resumedJobId, null);
  }
  assert.equal(cleared, 3);
  state = "succeeded";
  assert.deepEqual((await get()).recoveries, []);
  assert.equal(discarded, 1);
});
