import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const agents = ["openwork", "openscience", "money-printer", "wardrobe"];
const leasedRunManagers = ["wardrobe"];

test("legacy shared managers lease services while finite workers use held endpoints", () => {
  for (const agent of leasedRunManagers) {
    const source = read(`src/lib/${agent}/run-manager.ts`);
    assert.match(source, new RegExp(`from "\\./runtime-service\\.ts"`), agent);
    assert.match(source, /with[A-Za-z]+ServiceLease/, agent);
    assert.doesNotMatch(source, /from "\.\/service\.ts"/, agent);
    assert.doesNotMatch(source, /node:child_process|\bspawn(?:Sync)?\s*\(/, agent);
  }
  const moneyPrinter = read("src/lib/money-printer/run-manager.ts");
  assert.match(moneyPrinter, /from "\.\/runtime-service\.ts"/);
  assert.match(moneyPrinter, /ensureMoneyPrinterService\(/);
  assert.doesNotMatch(
    moneyPrinter,
    /withMoneyPrinterServiceLease|supervisor-control|node:child_process|\bspawn(?:Sync)?\s*\(/,
  );
  const openscience = read("src/lib/openscience/run-manager.ts");
  const workerService = read("src/lib/openscience/runtime-worker-service.ts");
  assert.match(openscience, /from "\.\/runtime-worker-service\.ts"/);
  assert.match(openscience, /preparedService\(/);
  assert.doesNotMatch(
    openscience,
    /from "\.\/runtime-service\.ts"|withOpenscienceServiceLease|supervisor-control|node:child_process|\bspawn(?:Sync)?\s*\(/,
  );
  assert.match(workerService, /BREADBOARD_OPENSCIENCE_SERVICE_URL/);
  assert.match(workerService, /BREADBOARD_OPENSCIENCE_SERVICE_TOKEN/);
  assert.match(workerService, /JSON\.stringify\(\{ scope \}\)/);
  assert.doesNotMatch(workerService, /CHATMOCK|apiKey|model:/);
  const openwork = read("src/lib/openwork/run-manager.ts");
  const openworkWorkerService = read("src/lib/openwork/runtime-worker-service.ts");
  assert.match(openwork, /from "\.\/runtime-worker-service\.ts"/);
  assert.match(openwork, /preparedOpenworkService\(/);
  assert.doesNotMatch(
    openwork,
    /from "\.\/runtime-service\.ts"|withOpenworkServiceLease|supervisor-control|node:child_process|\bspawn(?:Sync)?\s*\(/,
  );
  assert.match(openworkWorkerService, /BREADBOARD_OPENWORK_SERVICE_URL/);
  assert.match(openworkWorkerService, /BREADBOARD_OPENWORK_SERVICE_TOKEN/);
  assert.match(openworkWorkerService, /JSON\.stringify\(\{ scope \}\)/);
  assert.doesNotMatch(openworkWorkerService, /CHATMOCK|apiKey|options|supervisor-control/);
  const wardrobeRoute = read("src/app/api/wardrobe/runs/route.ts");
  assert.match(wardrobeRoute, /readWardrobeRuntimeStatus/);
  assert.doesNotMatch(wardrobeRoute, /@\/lib\/wardrobe\/runtime\.ts/);
});

test("health and setup routes are Runtime adapters, not direct launchers", () => {
  for (const agent of agents) {
    for (const endpoint of ["health", "setup"]) {
      const source = read(`src/app/api/${agent}/${endpoint}/route.ts`);
      assert.match(source, /runtime-service\.ts/, `${agent}/${endpoint}`);
      assert.doesNotMatch(
        source,
        new RegExp(`@/lib/${agent}/(?:service|setup|bridge)\\.ts`),
        `${agent}/${endpoint}`,
      );
      assert.doesNotMatch(source, /node:child_process|\bspawn(?:Sync)?\s*\(/);
    }
  }
});

test("the wrapper exposes every exact service id with bounded authenticated control", () => {
  const wrapper = read("scripts/runtime-v2-agent-service.mjs");
  const gateway = read("scripts/runtime-v2-gateway-http.mjs");
  const openworkEnsureStart = wrapper.indexOf('if (agent === "openwork")');
  const openworkEnsureEnd = wrapper.indexOf(
    'if (!exactRecord(body, ["scope", "options"]))',
    openworkEnsureStart,
  );
  const openworkEnsure = wrapper.slice(openworkEnsureStart, openworkEnsureEnd);
  for (const agent of agents) assert.match(wrapper, new RegExp(`"${agent}"`));
  assert.match(wrapper, /exactRecord\(body, \["scope", "options"\]\)/);
  assert.match(wrapper, /agent === "openscience"[\s\S]*?exactRecord\(body, \["scope"\]\)[\s\S]*?modules\.service\.ensureService\(\)/);
  assert.match(openworkEnsure, /exactRecord\(body, \["scope"\]\)/);
  assert.match(openworkEnsure, /readOpenworkProfile\(modules\.stateRoot, body\.scope\)/);
  assert.match(wrapper, /createHash\("sha256"\)[\s\S]*?validatedScope\.userId\}\\0\$\{validatedScope\.runId/);
  assert.match(wrapper, /fs\.lstatSync\(target\)/);
  assert.match(wrapper, /fs\.constants\.O_NOFOLLOW/);
  assert.match(wrapper, /profile\.serviceId !== "openwork"/);
  assert.doesNotMatch(openworkEnsure, /body\.options|apiKey|baseUrl/);
  assert.match(wrapper, /persistOptions\(stateRoot, agent, body\.scope\.userId, body\.options\)/);
  assert.match(wrapper, /readOptions\(stateRoot, agent, body\.scope\.userId\)/);
  assert.match(wrapper, /agent !== "wardrobe"\) fail\("This agent does not expose a reusable service link\.", 404\)/);
  assert.match(wrapper, /fs\.renameSync\(temporary, target\)/);
  assert.match(wrapper, /routePath === "\/v1\/reopen"/);
  assert.match(wrapper, /agent === "money-printer"\) modules\.runtime\.invalidateHealth\(\)/);
  assert.match(gateway, /timingSafeEqual/);
  assert.match(gateway, /MAX_REQUEST_BYTES = 64 \* 1024/);
  assert.match(gateway, /onStop\?\.\(\)/);
});

test("completed OpenWork artifacts stay durable while Wardrobe galleries can wake retired services", () => {
  const openwork = read("src/lib/openwork/runtime-run-manager.ts");
  const wardrobe = read("src/lib/wardrobe/run-manager.ts");
  const gallery = read("src/app/api/wardrobe/gallery/route.ts");
  assert.match(openwork, /readRunArtifact[\s\S]*readOuterAgentRunView\("openwork"/);
  assert.match(openwork, /inspectOuterAgentRun\("openwork"/);
  assert.match(openwork, /fs\.realpathSync\.native/);
  assert.match(openwork, /Readable\.toWeb\(stream\)/);
  assert.doesNotMatch(openwork, /withOpenworkServiceLease|ensureOpenworkService/);
  assert.match(wardrobe, /run\.galleryUrl = "\/api\/wardrobe\/gallery"/);
  assert.match(gallery, /requireUserId\(\)/);
  assert.match(gallery, /reopenWardrobeService/);
});

test("the Runtime wrapper starts independently and refuses unauthenticated control", async (t) => {
  const tokenNames = {
    openwork: "BREADBOARD_OPENWORK_SERVICE_TOKEN",
    openscience: "BREADBOARD_OPENSCIENCE_SERVICE_TOKEN",
    "money-printer": "BREADBOARD_MONEY_PRINTER_SERVICE_TOKEN",
    wardrobe: "BREADBOARD_WARDROBE_SERVICE_TOKEN",
  };
  for (const agent of agents) {
    const token = agent[0].repeat(64);
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        server.close(() => resolve(address.port));
      });
    });
    const child = spawn(
      process.execPath,
      ["scripts/runtime-v2-agent-service.mjs", "--agent", agent, "--port", String(port)],
      {
        cwd: root,
        env: { ...process.env, [tokenNames[agent]]: token },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });

    const origin = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        const response = await fetch(`${origin}/health`);
        if (response.ok) break;
      } catch {
        // Still importing the isolated source closure.
      }
      if (child.exitCode !== null || Date.now() > deadline) {
        assert.fail(`${agent} wrapper failed to become ready: ${stderr.slice(-2_000)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const denied = await fetch(`${origin}/v1/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: { userId: 1 } }),
    });
    assert.equal(denied.status, 401, agent);

    const accepted = await fetch(`${origin}/v1/status`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ scope: { userId: 1 } }),
    });
    assert.equal(accepted.status, 200, agent);
    const acceptedBody = await accepted.json();
    assert.equal(acceptedBody.ok, true, agent);

    const unsealed = await fetch(`${origin}/v1/status`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ scope: { userId: 1, callerPath: "C:\\outside" } }),
    });
    assert.equal(unsealed.status, 400, agent);
    child.stdin.write(`${JSON.stringify({ type: "stop", force: false })}\n`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${agent} wrapper did not stop`)), 5_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
});
