// Integration of real specialist routes, settings, Runtime facade, payload
// validation and SQLite. Only the out-of-process Runtime/provider is simulated.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { validateRuntimeV2GetDocRequest, validateRuntimeV2DeepResearchRequest } from "../scripts/runtime-v2-outer-agent-adapters.mjs";
import { SwarmStore } from "../src/lib/swarm/store.ts";
import { SwarmScheduler } from "../src/lib/swarm/scheduler.ts";
import { DEFAULT_SWARM_LIMITS } from "../src/lib/swarm/policy.ts";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-route-integration-"));
process.env.BREADBOARD_DATA_DIR = directory;
const { default: db } = await import("../src/lib/db.ts");
const conversations = await import("../src/lib/conversations/store.ts");
db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES(1,'swarm-test','swarm@example.test','x')").run();
const conversation = conversations.createConversation({ userId: 1, title: "Integration", surface: "dashboard_terminal" });
const jobs = new Map(); const submitted = [];
const fixture = globalThis.__swarmRuntimeIntegration = { db, conversations, jobs, submitted,
  async submit(authority, submission) {
    const old = [...jobs.values()].find(job => job.idempotencyKey === submission.idempotencyKey);
    if (old) return old.snapshot;
    const kind = submission.jobType.replace(/-run$/u, "");
    if (kind === "get-doc") validateRuntimeV2GetDocRequest(submission.requestPayload);
    if (kind === "deep-research") validateRuntimeV2DeepResearchRequest(submission.requestPayload);
    const jobId = `job_swarm_${jobs.size + 1}`;
    const snapshot = { jobId, jobType: submission.jobType, workerKind: `outer-${kind}-node`,
      resourceClass: kind === "get-doc" ? "document-processing" : "core", state: "running", ...authority, attempt: 1, workerInstanceId: "worker_swarm",
      createdAt: Date.now(), updatedAt: Date.now() };
    jobs.set(jobId, { snapshot, idempotencyKey: submission.idempotencyKey, authority, kind, events: [] });
    submitted.push(submission); return snapshot;
  },
  async inspect(_authority, id) { return jobs.get(id).snapshot; },
  async output(_authority, id, kind) {
    const job = jobs.get(id);
    return { content: { protocolVersion: 1, identity: { jobId: id, attempt: 1, workerInstanceId: "worker_swarm" },
      scope: { userId: job.authority.userId, gardenId: job.authority.gardenId, conversationId: job.authority.conversationId },
      adapterId: job.kind, status: job.snapshot.state === "succeeded" ? "completed" : job.snapshot.state === "cancelled" ? "aborted" : "running",
      events: job.events }, kind };
  },
};
const exportsOf = (name, value) => `export const {${Object.keys(value).join(",")}} = globalThis.__swarmRuntimeIntegration.${name};`;
const routes = `export const SWARM_RUNTIME_ROUTES = {
  "get-doc": {field:"task",load:()=>import(${JSON.stringify(path.resolve("src/app/api/get-doc/runs/route.ts"))})},
  "deep-research": {field:"query",load:()=>import(${JSON.stringify(path.resolve("src/app/api/deep-research/runs/route.ts"))})}
};`;
const supervisor = `const f=globalThis.__swarmRuntimeIntegration;
  export class RuntimeJobControlError extends Error {constructor(value){super(value.message);Object.assign(this,value);}}
  export class SupervisorResourceExhaustedError extends Error {}
  export const isRuntimeV2ServiceControlConfigured=()=>true;
  export const readSupervisedServiceSnapshot=async()=>{throw Error('Unexpected direct service access');};
  export const submitRuntimeJob=(...args)=>f.submit(...args);
  export const inspectRuntimeJob=(...args)=>f.inspect(...args);
  export const inspectRuntimeJobForStatus=inspectRuntimeJob;
  export const readRuntimeJobOutput=(...args)=>f.output(...args);
  export const lookupRuntimeJobByIdempotencyKey=async(_authority,key)=>{
    const job=[...f.jobs.values()].find(job=>job.idempotencyKey===key);
    if(!job)throw new RuntimeJobControlError({code:'JOB_NOT_FOUND',message:'No matching job'});return job.snapshot;};
  export const cancelRuntimeJob=async(_authority,id)=>{const job=f.jobs.get(id);job.snapshot.state='cancelled';job.events.push({sequenceNumber:99,type:'run.aborted',payload:{},at:new Date().toISOString()});return job.snapshot;};
  export const cancelRuntimeJobByIdempotencyKey=async(_authority,key)=>{const job=[...f.jobs.values()].find(job=>job.idempotencyKey===key);if(job)await cancelRuntimeJob(_authority,job.snapshot.jobId);return {accepted:true,jobId:job?.snapshot.jobId??null,state:job?'cancelled':'pending'};};
  export const abandonRuntimeJobInput=async()=>{};
  export const reserveRuntimeJobInput=async()=>{throw Error('Unexpected binary upload');};
  export const uploadRuntimeJobInput=reserveRuntimeJobInput;`;
const bundle = await build({ stdin: { contents: `export {runtimeSwarmAdapter} from './src/lib/swarm/runtime-adapter.ts';`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "runtime-boundaries", setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      let source;
      const resolved = (args.path.startsWith(".") && args.importer && !args.importer.startsWith("swarm-test:")
        ? path.resolve(path.dirname(args.importer), args.path) : args.path).replaceAll("\\", "/");
      if (/(?:^|\/)db(?:\.ts)?$/u.test(args.path)) source = "export default globalThis.__swarmRuntimeIntegration.db;";
      else if (/conversations\/store\.ts$/u.test(resolved)) source = exportsOf("conversations", conversations);
      else if (/swarm\/runtime-routes\.ts$|^\.\/runtime-routes\.ts$/u.test(args.path)) source = routes;
      else if (/music-producer\/run-manager\.ts$/u.test(args.path)) source = "export const readRun=async()=>{throw Error('Unexpected Music lifecycle in the search/research fixture');};export const abortRun=readRun;";
      else if (/supervisor-control(?:\.ts)?$/u.test(args.path)) source = supervisor;
      else if (/agent-artifact-runtime\.ts$/u.test(args.path)) source = "export const ensureAgentArtifactConversation=async input=>{globalThis.__swarmRuntimeIntegration.conversations.getConversationForUser(input.conversationPublicId,input.userId);};";
      else if (/agent-memory-context\.ts$/u.test(args.path)) source = "export const composeAgentMemoryContext=async()=>null;";
      else if (/chatmock-server\.ts$/u.test(args.path)) source = "export const resolveChatmockBaseUrl=()=>({baseURL:'http://127.0.0.1:8765/v1'});";
      else if (/auth-options(?:\.ts)?$/u.test(args.path)) source = "export const authOptions={};";
      else if (args.path === "next-auth/next") source = "export const getServerSession=async()=>null;";
      else if (/organizations\/store$/u.test(args.path)) source = "export const organizationClusterClause=()=>'';";
      else if (args.path === "server-only") source = "";
      if (source !== undefined) return { path: args.path, namespace: "swarm-test", pluginData: source };
    });
    b.onLoad({ filter: /.*/, namespace: "swarm-test" }, args => ({ contents: args.pluginData, loader: "js", resolveDir: process.cwd() }));
  } }] });
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const adapterFor = module.exports.runtimeSwarmAdapter;
test.after(() => { delete globalThis.__swarmRuntimeIntegration; db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test("actual search and research routes preserve owned scope, exact payloads and dependency evidence", async () => {
  const store = new SwarmStore(db);
  const tasks = [
    { key: "sources", title: "Find sources", brief: "Find papers about photovoltaic efficiency", executor: {kind:"runtime",id:"get-doc"}, dependsOn: [] },
    { key: "research", title: "Compare evidence", brief: "Compare the photovoltaic evidence", executor: {kind:"runtime",id:"deep-research"}, dependsOn: ["sources"] },
  ].map(task => ({ ...task, acceptance: ["Cites inspected evidence"], inputs: [], tokenBudget: 1_000 }));
  const authority = { userId: 1, conversationId: conversation.id, conversationPublicId: conversation.public_id, runtimeSessionId: 1,
    sourceRunId: "parent", originClientMessageId: "source", surface: "dashboard_terminal", gardenId: null, gardenSlug: null,
    model: "test-model", reasoningEffort: "high", standingApproval: true, allowedTools: ["agent_launch"], allowedAgentIds: ["get-doc","deep-research"], inputReferences: [] };
  const run = store.create({ authority, requestId: "integration", plan: { objective: "Compare source evidence", reason: "Source discovery precedes synthesis", benefit: "coverage", mode: "durable", tasks },
    limits: { ...DEFAULT_SWARM_LIMITS, maxTokens: 3_000 }, admission: () => ({available:true,requiresApproval:false}) });
  const tick = () => new SwarmScheduler(store, executor => adapterFor(executor.id)).tick(1, run.id);
  const first = await tick();
  assert.equal(first.started, 1, JSON.stringify(store.snapshot(1,run.id).events));
  assert.equal(submitted.length, 1); assert.equal(submitted[0].requestPayload.model, "test-model");
  assert.equal(Object.hasOwn(submitted[0].requestPayload,"conversationPublicId"), false, "exact Get Doc worker schema must not gain an extra field");
  const job = [...jobs.values()][0];
  job.snapshot.state = "succeeded";
  job.events = [{ sequenceNumber:1,type:"run.result",payload:{result:"Paper A reports measured photovoltaic efficiency; https://example.test/paper-a"},at:new Date().toISOString() },
    {sequenceNumber:2,type:"run.usage",payload:{totalTokens:70},at:new Date().toISOString()},
    {sequenceNumber:3,type:"run.completed",payload:{},at:new Date().toISOString()}];
  await tick(); assert.equal(submitted.length, 1, "dependent work waits for verification");
  const snapshot = store.snapshot(1,run.id);
  assert.equal(snapshot.tasks[0].status, "verifying", JSON.stringify(snapshot.events));
  store.verify(1,run.id,"sources",[{criterion:tasks[0].acceptance[0],passed:true,evidenceIds:snapshot.evidence.map(item=>item.id)}]);
  await tick(); assert.equal(submitted.length, 2);
  assert.match(submitted[1].requestPayload.query,/Paper A/);
  assert.equal(store.snapshot(1,run.id).tasks[1].status,"running");
  // Drop the dashboard correlation, as if acceptance was followed by a crash.
  const attempt = store.snapshot(1,run.id).attempts[1];
  db.prepare("DELETE FROM runtime_v2_outer_agent_runs WHERE request_id=?").run(attempt.requestId);
  db.prepare("UPDATE swarm_attempts SET handle_json=NULL,status='starting' WHERE id=?").run(attempt.id);
  await tick(); assert.equal(submitted.length,2,"recovery uses Runtime idempotency instead of launching another job");
  store.control(1,run.id,"cancel"); await tick();
  assert.equal(store.get(1,run.id).status,"cancelled");
});
