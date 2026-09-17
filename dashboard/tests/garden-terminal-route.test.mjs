import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { brokerCapabilities } from "../src/lib/hermes/capability-broker.ts";
import { planTask } from "../src/lib/hermes/task-plan.ts";
import { authorizeTerminalCommand } from "../src/lib/hermes/terminal-execution.ts";
import { executeTerminalCommand } from "../scripts/runtime-v2-terminal-command-worker.mjs";

// The exact failed command from the vitamin-stack chat. These are regression
// inputs, not a medical recommendation or a verification of safety limits.
const arithmetic = "$b6TotalMg = 10 + 5; $b6UlMg = 12.5; $dTotalMcg = 10 + 25; $dUlMcg = 100; $folateVisibleMcg = 400 + 300; [pscustomobject]@{B6TotalMg=$b6TotalMg; B6AdultULMg=$b6UlMg; B6PercentOfUL=[math]::Round(100*$b6TotalMg/$b6UlMg); VitaminDTotalMcg=$dTotalMcg; VitaminDTotalIU=$dTotalMcg*40; VitaminDAdultULMcg=$dUlMcg; FolateBeforeSeparateTabletMcg=$folateVisibleMcg} | ConvertTo-Json -Compress";

test("Garden arithmetic reaches exact-command approval and executes through the real worker", async (t) => {
  const state = globalThis.__gardenTerminalRouteTest = {
    session: { id: 33, user_id: 7, surface: "garden_chat", conversation_id: 44,
      hermes_session_id: "runtime", garden_id: "health", cluster_id: 9,
      allowed_garden_ids: "[9]", active_directory: process.cwd() },
    conversation: { id: 44, public_id: "conv_garden_terminal", user_id: 7 },
    run: { id: "run" }, executions: [], audits: [],
    authorizeTerminalCommand,
    async runAuthorizedTerminalCommand(command, options) {
      // Keep production token issuance, route authorization, command policy,
      // and PowerShell worker. Only durable stores and job transport are faked.
      assert.equal(authorizeTerminalCommand(command, options).allowed, true);
      state.executions.push({ command, options });
      const result = await executeTerminalCommand({
        identity: { jobId: "garden_arithmetic", attempt: 1, workerInstanceId: "test" },
        request: { command, workspaceRoot: options.workspaceRoot, maxRuntimeMs: options.maxRuntimeMs },
      }, options.signal, { checkpoint() {} });
      return { ...result, running: false };
    },
  };
  const stubs = {
    "runtime-store.ts": `const s = () => globalThis.__gardenTerminalRouteTest;
      export const getRuntimeSessionByExternalId = (_runtime, id) => id === "runtime" ? s().session : null;
      export const getRuntimeSessionByHermesId = id => id === "runtime" ? s().session : null;
      export const getRuntimeSessionById = id => id === 33 ? s().session : null;
      export const runtimeExternalSessionId = row => row.hermes_session_id;
      export const getActiveCapabilityDecision = () => null;
      export const recordAuditEvent = event => s().audits.push(event);`,
    "run-store.ts": "export const getActiveRuntimeRun = () => globalThis.__gardenTerminalRouteTest.run;",
    "browser-terminal-context.ts": "export const getBrowserTerminalContext = () => null;",
    "@/lib/conversations/store.ts": "export const getConversationById = () => globalThis.__gardenTerminalRouteTest.conversation;",
    "@/lib/hermes/route-helpers.ts": `export { ApiError } from "@/lib/hermes/route-core.ts";
      export const requireEnabled = () => {};
      export const readJsonBody = req => req.json();
      export const apiErrorResponse = error => Response.json({ error: error.message, code: error.code }, { status: error.status || 500 });`,
    "@/lib/hermes/terminal-execution.ts": `export const authorizeTerminalCommand = (...args) => globalThis.__gardenTerminalRouteTest.authorizeTerminalCommand(...args);
      export const runAuthorizedTerminalCommand = (...args) => globalThis.__gardenTerminalRouteTest.runAuthorizedTerminalCommand(...args);
      export const continueAuthorizedTerminalCommand = () => { throw new Error("unexpected continuation"); };`,
  };
  const bundle = await build({
    entryPoints: ["src/app/api/hermes/tools/terminal/route.ts"],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "session-fixture", setup(builder) {
      builder.onResolve({ filter: /./ }, args => {
        const key = stubs[args.path] ? args.path : args.path.split("/").at(-1);
        return stubs[key] ? { path: key, namespace: "fixture" } : undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js", resolveDir: process.cwd() }));
    } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const previousSecret = process.env.BREADBOARD_HERMES_TOOL_SECRET;
  process.env.BREADBOARD_HERMES_TOOL_SECRET = "garden-terminal-test";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.BREADBOARD_HERMES_TOOL_SECRET;
    else process.env.BREADBOARD_HERMES_TOOL_SECRET = previousSecret;
    delete globalThis.__gardenTerminalRouteTest;
  });
  const call = (body = {}, secret = "garden-terminal-test") => module.exports.POST(new Request("http://localhost/api/hermes/tools/terminal", {
    method: "POST", headers: { authorization: `Bearer ${secret}`, "x-hermes-session-id": "runtime" },
    body: JSON.stringify({ command: arithmetic, timeoutSeconds: 30, ...body }),
  }));

  const grant = brokerCapabilities({
    plan: planTask({ request: "Compare my vitamin stack with AG1", authenticated: true }),
    surface: "garden_chat", userId: 7, grants: [], workspaceRoot: process.cwd(), superAgent: true,
  });
  const pending = await call();
  assert.equal(pending.status, 428, JSON.stringify(await pending.json()));
  assert.equal(grant.allowedTools.terminal_execute_command, true);
  assert.equal(state.executions.length, 0, "ordinary mode must wait for exact approval");

  if (process.platform === "win32") {
    // The runtime wrapper supplies this flag only after its native permission
    // request is approved (automatically when the turn's YOLO switch is on).
    const response = await call({ permissionGranted: true });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.data.exitCode, 0, body.data.stderr);
    assert.equal(body.data.timedOut, false);
    assert.deepEqual(JSON.parse(body.data.stdout), {
      B6TotalMg: 15, B6AdultULMg: 12.5, B6PercentOfUL: 120,
      VitaminDTotalMcg: 35, VitaminDTotalIU: 1400, VitaminDAdultULMcg: 100,
      FolateBeforeSeparateTabletMcg: 700,
    });
    assert.deepEqual(state.executions[0].options.runtimeAuthority, {
      userId: 7, gardenId: "health", conversationId: "conv_garden_terminal",
    });

    const hermesRoot = fileURLToPath(new URL("../../hermes-agent/", import.meta.url));
    const python = path.join(hermesRoot, ".venv", "Scripts", "python.exe");
    await t.test("real Hermes plugin and session YOLO approve the 428 and return the calculation", {
      skip: !fs.existsSync(python) && "Hermes Python environment is unavailable",
    }, async (t) => {
      const statuses = [];
      const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const response = await module.exports.POST(new Request(`http://127.0.0.1${req.url}`, {
          method: req.method, headers: req.headers, body: Buffer.concat(chunks),
        }));
        statuses.push(response.status);
        res.writeHead(response.status, { "content-type": "application/json" });
        res.end(await response.text());
      });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      t.after(() => new Promise(resolve => server.close(resolve)));
      const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-garden-yolo-"));
      t.after(() => fs.rmSync(hermesHome, { recursive: true, force: true }));
      const script = `import json, sys
from tools import approval
from plugins import breadboard
approval.set_current_session_key("runtime")
approval.enable_session_yolo("runtime")
result = breadboard._call_breadboard(json.load(sys.stdin), tool_name="terminal_execute_command", route="/api/hermes/tools/terminal", route_kind="terminal", task_id="runtime", tool_call_id="arithmetic-yolo")
print(result)
`;
      const child = spawn(python, ["-c", script], {
        cwd: hermesRoot, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, HERMES_HOME: hermesHome, PYTHONIOENCODING: "utf-8",
          BREADBOARD_INTERNAL_URL: `http://127.0.0.1:${server.address().port}` },
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.stdin.end(JSON.stringify({ command: arithmetic, timeoutSeconds: 30 }));
      const timeout = setTimeout(() => child.kill(), 30_000);
      const code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      }).finally(() => clearTimeout(timeout));
      assert.equal(code, 0, stderr);
      assert.deepEqual(statuses, [428, 200], `${stdout}\n${stderr}`);
      const result = JSON.parse(stdout.trim());
      assert.equal(result.exitCode, 0, stdout);
      assert.equal(JSON.parse(result.stdout).VitaminDTotalIU, 1400);
      assert.equal(state.executions.at(-1).command, arithmetic);
    });
  }

  const count = state.executions.length;
  assert.equal((await call({ permissionGranted: true }, "wrong-secret")).status, 401);
  state.session.user_id = null;
  assert.equal((await call({ permissionGranted: true })).status, 403);
  state.session.user_id = 7;
  state.conversation.user_id = 8;
  assert.equal((await call({ permissionGranted: true })).status, 403);
  state.conversation.user_id = 7;
  state.run = null;
  assert.equal((await call({ permissionGranted: true })).status, 409);
  state.run = { id: "run" };
  state.session.surface = "quartz_ai";
  assert.equal((await call({ permissionGranted: true })).status, 403);
  state.session.surface = "dashboard_terminal";
  assert.equal((await call()).status, 428, "Terminal keeps its existing approval flow");
  assert.equal(state.executions.length, count, "rejected requests must not launch a worker");
});
