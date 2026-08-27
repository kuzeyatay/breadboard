import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  prepareApprovedLocalMcpLaunch,
  sealApprovedLocalMcpProfile,
} from "../src/lib/hermes/local-mcp-approved-profile.ts";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brokerEntry = path.join(dashboardRoot, "scripts", "runtime-v2-local-mcp-broker-service.mjs");
const fakeEntry = path.join(dashboardRoot, "tests", "fixtures", "local-mcp-echo-server.mjs");
const token = "runtime-v2-local-mcp-test-token-0123456789";

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : [target];
  });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(origin, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`broker exited ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {
      // Cold start.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("broker did not become healthy");
}

async function post(origin, route, body) {
  const response = await fetch(`${origin}${route}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test("Runtime local MCP broker single-flights and contains an approved stdio server", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-local-mcp-broker-"));
  const counter = path.join(directory, "starts.txt");
  const cancellations = path.join(directory, "cancellations.txt");
  const registryRoot = path.join(directory, "registry");
  const profileEnvironment = {
    ...process.env,
    FAKE_MCP_COUNTER: counter,
    FAKE_MCP_CANCEL_COUNTER: cancellations,
    TEST_MCP_SECRET: "must-not-return",
  };
  const sealed = sealApprovedLocalMcpProfile(7, "echo", {
    transport: "local",
    executable: process.execPath,
    args: [fakeEntry],
    cwd: dashboardRoot,
    environmentNames: [
      "FAKE_MCP_COUNTER",
      "FAKE_MCP_CANCEL_COUNTER",
      "TEST_MCP_SECRET",
    ],
    timeout: 5_000,
  }, { registryRoot, environment: profileEnvironment });
  const prepare = () => prepareApprovedLocalMcpLaunch(
    7,
    "echo",
    sealed.reference,
    { registryRoot, environment: profileEnvironment, token },
  );
  const request = {
    userId: 7,
    slug: "echo",
    revision: sealed.reference.profileRevision,
    digest: sealed.reference.profileDigest,
  };
  const profilePath = path.join(
    registryRoot,
    "definitions",
    "user-7",
    "echo",
    `${sealed.reference.profileDigest}.json`,
  );
  const profileBytes = fs.readFileSync(profilePath);
  assert.doesNotMatch(profileBytes.toString("utf8"), /must-not-return|starts\.txt|cancellations\.txt/u);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [brokerEntry, "--port", String(port)], {
    cwd: dashboardRoot,
    env: {
      ...process.env,
      BREADBOARD_LOCAL_MCP_BROKER_TOKEN: token,
      BREADBOARD_LOCAL_MCP_REGISTRY_ROOT: registryRoot,
    },
    stdio: ["pipe", "ignore", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    await waitForHealth(origin, child);
    const encryptedLaunch = prepare();
    assert.doesNotMatch(fs.readFileSync(encryptedLaunch.envelopePath, "utf8"), /must-not-return/u);
    prepare();
    const [first, second] = await Promise.all([
      post(origin, "/v1/add", request),
      post(origin, "/v1/add", request),
    ]);
    assert.equal(first.response.status, 200);
    assert.equal(second.response.status, 200);
    assert.equal(first.body.result.status.status, "connected");
    assert.equal(first.body.result.tools[0].name, "echo");
    assert.equal(fs.readFileSync(counter, "utf8").trim().split(/\r?\n/u).length, 1);
    assert.doesNotMatch(JSON.stringify(first.body), /must-not-return/u);
    assert.deepEqual(
      fs.readdirSync(path.join(registryRoot, "launch", "user-7", "echo")),
      [],
      "both one-shot envelopes must be consumed and deleted",
    );

    profileEnvironment.TEST_MCP_SECRET = "rotated-without-another-approval";
    prepare();
    const refreshed = await post(origin, "/v1/add", request);
    assert.equal(refreshed.body.result.status.status, "connected");
    assert.equal(
      fs.readFileSync(counter, "utf8").trim().split(/\r?\n/u).length,
      2,
      "an environment-value change must restart from the same sealed definition",
    );
    assert.doesNotMatch(JSON.stringify(refreshed.body), /rotated-without/u);

    prepare();
    const called = await post(origin, "/v1/call", {
      ...request,
      tool: "echo",
      args: { text: "hello from Runtime" },
    });
    assert.equal(called.response.status, 200);
    assert.equal(called.body.result.result.content[0].text, "hello from Runtime");

    const abort = new AbortController();
    prepare();
    const cancelled = fetch(`${origin}/v1/call`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...request,
        tool: "echo",
        args: { text: "too late", delayMs: 2_000 },
      }),
      signal: abort.signal,
    });
    setTimeout(() => abort.abort(), 50);
    await assert.rejects(cancelled, (error) => error?.name === "AbortError");
    const cancelDeadline = Date.now() + 1_000;
    while (!fs.existsSync(cancellations) && Date.now() < cancelDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(fs.readFileSync(cancellations, "utf8").trim(), "cancelled");

    prepare();
    const afterCancel = await post(origin, "/v1/call", {
      ...request,
      tool: "echo",
      args: { text: "still healthy" },
    });
    assert.equal(afterCancel.response.status, 200);
    assert.equal(afterCancel.body.result.result.content[0].text, "still healthy");

    const smuggled = await post(origin, "/v1/add", {
      ...request,
      config: {
        command: [process.execPath, "attacker.mjs"],
        cwd: directory,
        environment: { STOLEN: "secret" },
      },
    });
    assert.equal(smuggled.response.status, 400);
    assert.equal(smuggled.body.error.code, "invalid_local_mcp_request");

    prepare();
    const crossUser = await post(origin, "/v1/add", { ...request, userId: 8 });
    assert.equal(crossUser.response.status, 200);
    assert.equal(crossUser.body.result.status.status, "failed");

    prepare();
    fs.writeFileSync(profilePath, Buffer.concat([profileBytes.subarray(0, -1), Buffer.from(" \n")]));
    const tampered = await post(origin, "/v1/add", request);
    assert.equal(tampered.response.status, 200);
    assert.equal(tampered.body.result.status.status, "failed");
    fs.writeFileSync(profilePath, profileBytes);

    let symlinkCreated = false;
    const heldProfile = `${profilePath}.held`;
    prepare();
    fs.renameSync(profilePath, heldProfile);
    try {
      fs.symlinkSync(heldProfile, profilePath, "file");
      symlinkCreated = true;
      const indirect = await post(origin, "/v1/add", request);
      assert.equal(indirect.response.status, 200);
      assert.equal(indirect.body.result.status.status, "failed");
    } catch (error) {
      if (!new Set(["EPERM", "EACCES", "UNKNOWN"]).has(error?.code)) throw error;
    } finally {
      if (symlinkCreated) fs.rmSync(profilePath, { force: true });
      fs.renameSync(heldProfile, profilePath);
    }

    const stopped = await post(origin, "/v1/disconnect", { userId: 7, slug: "echo" });
    assert.equal(stopped.response.status, 200);
    assert.equal(stopped.body.result.disconnected, true);
  } finally {
    if (child.exitCode === null) child.stdin.write('{"type":"stop","force":false}\n');
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (child.exitCode === null) child.kill();
    fs.rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(stderr, "");
});

test("production MCP proxy has no stdio or child-process fallback", () => {
  const proxy = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "agent-runtime", "mcp-proxy.ts"),
    "utf8",
  );
  assert.doesNotMatch(proxy, /StdioClientTransport|child_process|\bspawn\s*\(/u);
  assert.match(proxy, /callLocalMcpBrokerTool/u);
  assert.match(proxy, /getMcpConnectionBySlug\(input\.userId, slug\)/u);
  assert.doesNotMatch(proxy, /config:\s*local\.config/u);
  const brokerClient = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "agent-runtime", "local-mcp-broker.ts"),
    "utf8",
  );
  assert.doesNotMatch(brokerClient, /\{\s*userId:\s*input\.userId,\s*slug:\s*input\.slug,\s*config:/u);
  assert.match(brokerClient, /profileRevision/u);
  assert.match(brokerClient, /profileDigest/u);
  const brokerService = fs.readFileSync(brokerEntry, "utf8");
  assert.doesNotMatch(brokerService, /body\.config|validatedConfig|config\.command/u);
  assert.match(brokerService, /BREADBOARD_LOCAL_MCP_REGISTRY_ROOT/u);
  const toolRoute = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "hermes", "tools", "mcp", "route.ts"),
    "utf8",
  );
  assert.match(toolRoute, /BREADBOARD_RESOURCE_EXHAUSTED/u);
  assert.match(toolRoute, /mcp_tool_cancelled/u);

  const directStdioOwners = sourceFiles(path.join(dashboardRoot, "src"))
    .filter((file) => /\.[cm]?[jt]sx?$/u.test(file))
    .filter((file) => fs.readFileSync(file, "utf8").includes("StdioClientTransport"))
    .map((file) => path.relative(dashboardRoot, file).replaceAll("\\", "/"));
  assert.deepEqual(directStdioOwners, [], "dashboard source must not own a local MCP transport");

  for (const relative of [
    "src/app/api/hermes/mcp/route.ts",
    "src/app/api/hermes/capabilities/route.ts",
    "src/app/api/hermes/commands/route.ts",
  ]) {
    const source = fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
    const getBody = source.slice(source.indexOf("export async function GET"));
    assert.doesNotMatch(getBody.split("export async function POST")[0], /addMcpConnection\s*\(/u);
  }
});
