// Opt-in live acceptance: real configured model -> CAD kernel -> saved files.
// Usage: node --experimental-strip-types scripts/design-request-smoke.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const repo = path.resolve(import.meta.dirname, "../..");
const output = path.join(repo, ".runtime/verification", `design-request-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const desktopData = path.join(process.env.APPDATA, "breadboard-desktop/Data");
const endpoints = JSON.parse(fs.readFileSync(path.join(desktopData, "runtime/endpoints.json"), "utf8"));
const modelBase = endpoints.urls.chatmock;
const model = process.env.BREADBOARD_DESIGN_SMOKE_MODEL || "gpt-5.6-sol";
process.env.BREADBOARD_DATA_DIR = path.join(output, "data");
process.env.BREADBOARD_REPO_ROOT = repo;
const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const secret = randomUUID();
process.env.CAD_SERVICE_URL = `http://127.0.0.1:${port}`;
process.env.CAD_SERVICE_SECRET = secret;
const service = spawn(path.join(repo, ".runtime/cad-venv/Scripts/python.exe"), [
  "-m", "breadboard_cad", "serve", "--host", "127.0.0.1", "--port", String(port),
], {
  cwd: path.join(repo, "cad-service"), windowsHide: true,
  env: { ...process.env, BREADBOARD_CAD_SECRET: secret, BREADBOARD_CAD_WORKSPACE: path.join(output, "kernel"), PYTHONDONTWRITEBYTECODE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serviceLog = fs.createWriteStream(path.join(output, "cad-service.log"));
service.stdout.pipe(serviceLog, { end: false });
service.stderr.pipe(serviceLog, { end: false });
let db;
let abort;
let runId;
let terminal = false;
try {
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${process.env.CAD_SERVICE_URL}/health`, {
        headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(2000),
      });
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "CAD kernel did not start");
  ({ default: db } = await import("../src/lib/db.ts"));
  db.prepare("INSERT INTO users(id, username, email, password_hash) VALUES (1, 'design-smoke', 'design-smoke@example.test', 'x')").run();
  const { createConversation } = await import("../src/lib/conversations/store.ts");
  const { parseParametricCadRequest } = await import("../src/lib/cad/identity.ts");
  const manager = await import("../src/lib/cad/run-manager.ts");
  abort = manager.abortRuntimeWorkerRun;
  const chat = createConversation({ userId: 1, title: "Live design file acceptance", surface: "dashboard_terminal" });
  const { createRuntimeSession } = await import("../src/lib/hermes/runtime-store.ts");
  createRuntimeSession({
    conversationId: chat.id, surface: chat.surface, userId: 1,
    chatSessionId: null, agentName: "Hermes", clusterId: null, gardenId: null,
    pageSlug: null, workspaceKey: "design-smoke", activeDirectory: output,
    filesystemMode: "restricted", hermesSessionId: "design-smoke-session",
  });
  const brief = "Design a small two-part electronics enclosure and provide build files. Internal cavity 32 x 20 x 8 mm, 2 mm walls and floor, removable 2 mm thick lid, 0.3 mm lid clearance. Add a 10 x 4 mm USB opening centered in a short wall at the top edge. It is a bench prototype enclosure for a glasses HUD module. Use mm and FDM. Generate real validated STEP, STL and editable parametric source for the body and lid; use two separate named solids, with the lid displaced above the body for inspection. Do not design optics or electronics. Keep it simple, build it with the available CAD tools, check the cavity and exports, and finish with the artifact.";
  console.log(JSON.stringify({ output, model, brief }));
  const run = manager.startRuntimeWorkerRun({
    userId: 1, conversationPublicId: chat.public_id, brief,
    parsed: parseParametricCadRequest(brief), model, reasoningEffort: "medium", baseUrl: modelBase,
  });
  runId = run.runId;
  const { recordExternalAgentTurn } = await import("../src/lib/conversations/external-agent-turns.ts");
  recordExternalAgentTurn({
    conversation: chat, surface: chat.surface, clientMessageId: "design-smoke-cad",
    userContent: brief, delegatedAgentRun: true,
    run: { kind: "parametric_cad", runId, brief },
  });
  const runDeadline = Date.now() + 10 * 60_000;
  let sequence = 0;
  while (Date.now() < runDeadline && !manager.isRuntimeWorkerTerminal(1, runId)) {
    const events = manager.getRuntimeWorkerEventsSince(1, runId, sequence);
    for (const event of events) {
      sequence = event.sequenceNumber;
      if (!event.type.endsWith("delta")) console.log(event.type);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  terminal = manager.isRuntimeWorkerTerminal(1, runId);
  assert.ok(terminal, "Live design exceeded ten minutes");
  const events = manager.getRuntimeWorkerEventsSince(1, runId, 0);
  fs.writeFileSync(path.join(output, "events.json"), JSON.stringify(events, null, 2));
  const completed = events.find(event => event.type === "run.completed");
  assert.ok(completed, JSON.stringify(events.find(event => event.type === "run.failed")?.payload));
  assert.ok(events.some(event => event.type === "cad.artifact.created"), "No saved CAD artifact");
  const project = db.prepare("SELECT * FROM cad_projects WHERE conversation_id = ? ORDER BY updated_at DESC LIMIT 1").get(chat.id);
  assert.ok(project?.current_revision > 0);
  const { readCadFile } = await import("../src/lib/cad/project-store.ts");
  const files = [];
  for (const format of ["step", "stl", "glb", "source", "spec", "report"]) {
    const file = readCadFile({ projectId: project.id, revision: project.current_revision, format });
    assert.ok(file.content.byteLength > 0, `Empty ${format}`);
    if (format === "step") assert.match(file.content.toString("utf8"), /ISO-10303-21/);
    const target = path.join(output, `enclosure.${format === "source" ? "py" : format === "spec" || format === "report" ? format + ".json" : format}`);
    fs.writeFileSync(target, file.content);
    files.push({ format, path: target, bytes: file.content.byteLength });
  }
  fs.writeFileSync(path.join(output, "receipt.json"), JSON.stringify({ ok: true, model, runId, projectId: project.id, files, completed: completed.payload }, null, 2));
  console.log(JSON.stringify({ ok: true, output, files }));
} finally {
  if (runId && !terminal) abort?.(1, runId);
  if (service.exitCode === null) service.kill();
  serviceLog.end();
  db?.close();
}
