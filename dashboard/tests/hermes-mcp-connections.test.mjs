import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  mcpSlug,
  parseMcpConfig,
  publicMcpConnection,
  runtimeMcpConfig,
} from "../src/lib/hermes/mcp-connections.ts";

test("MCP names cannot collide with built-in tool namespaces", () => {
  for (const slug of [
    "apply",
    "capability",
    "external",
    "garden",
    "list",
    "nango",
    "read",
  ]) {
    assert.throws(() => mcpSlug(slug), /reserved by a built-in tool namespace/);
  }
  assert.equal(mcpSlug("Project Memory"), "project-memory");
});

test("local MCP commands require explicit approval", () => {
  assert.throws(
    () =>
      parseMcpConfig({
        transport: "local",
        displayName: "Local tool",
        executable: "node",
        args: ["server.js"],
      }),
    /Explicit approval/,
  );
});

test("credential-looking local arguments are rejected in favor of environment names", () => {
  assert.throws(
    () =>
      parseMcpConfig({
        transport: "local",
        displayName: "Unsafe",
        executable: "node",
        args: ["server.js", "--token=secret"],
        environmentNames: ["MCP_TOKEN"],
        approved: true,
      }),
    /Do not place credentials in arguments/,
  );
});

test("remote MCP rejects cleartext non-loopback URLs", () => {
  assert.throws(
    () =>
      parseMcpConfig({
        transport: "remote",
        displayName: "Unsafe remote",
        url: "http://example.com/mcp",
      }),
    /must use HTTPS/,
  );
});

test("stored/public MCP metadata contains only environment names while runtime materializes values", () => {
  const old = process.env.TEST_MCP_SECRET;
  process.env.TEST_MCP_SECRET = "do-not-persist";
  try {
    const parsed = parseMcpConfig({
      transport: "remote",
      displayName: "Safe remote",
      url: "https://example.com/mcp",
      oauth: false,
      headerEnvironment: [
        { header: "Authorization", environmentName: "TEST_MCP_SECRET" },
      ],
    });
    const record = {
      id: 1,
      slug: parsed.slug,
      displayName: parsed.displayName,
      transport: "remote",
      config: parsed.config,
      enabled: true,
      approvedAt: "now",
      createdAt: "now",
      updatedAt: "now",
    };
    assert.doesNotMatch(
      JSON.stringify(publicMcpConnection(record)),
      /do-not-persist/,
    );
    assert.equal(
      runtimeMcpConfig(record).headers.Authorization,
      "do-not-persist",
    );
  } finally {
    if (old === undefined) delete process.env.TEST_MCP_SECRET;
    else process.env.TEST_MCP_SECRET = old;
  }
});

test("an existing approved local row lazily seals without another click or changing its public fields", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-local-mcp-profile-test-"));
  const previous = {
    registry: process.env.BREADBOARD_LOCAL_MCP_REGISTRY_ROOT,
    token: process.env.BREADBOARD_LOCAL_MCP_BROKER_TOKEN,
    secret: process.env.TEST_MCP_SECRET,
  };
  process.env.BREADBOARD_LOCAL_MCP_REGISTRY_ROOT = directory;
  process.env.BREADBOARD_LOCAL_MCP_BROKER_TOKEN = "local-mcp-profile-test-token-0123456789";
  process.env.TEST_MCP_SECRET = "must-live-only-in-the-encrypted-envelope";
  try {
    const legacyConfig = {
      transport: "local",
      executable: process.execPath,
      args: ["server.mjs", "--safe-mode"],
      cwd: process.cwd(),
      environmentNames: ["TEST_MCP_SECRET"],
      timeout: 7_000,
    };
    const record = {
      id: 987_654_321,
      userId: 23,
      slug: "legacy-approved",
      displayName: "Legacy approved",
      transport: "local",
      config: structuredClone(legacyConfig),
      enabled: true,
      approvedAt: "2026-08-20T00:00:00.000Z",
      createdAt: "now",
      updatedAt: "now",
    };
    const runtime = runtimeMcpConfig(record);
    assert.deepEqual(Object.keys(runtime).sort(), [
      "enabled",
      "profileDigest",
      "profileRevision",
      "timeout",
      "type",
    ]);
    assert.equal(runtime.type, "local");
    assert.equal(runtime.profileRevision, 1);
    assert.match(runtime.profileDigest, /^[a-f0-9]{64}$/u);
    assert.equal(runtime.timeout, 7_000);
    assert.deepEqual(record.config, {
      transport: "local",
      profileRevision: 1,
      profileDigest: runtime.profileDigest,
    });

    const publicRecord = publicMcpConnection(record);
    assert.equal(publicRecord.config.executable, fs.realpathSync.native(process.execPath));
    assert.deepEqual(publicRecord.config.args, legacyConfig.args);
    assert.equal(publicRecord.config.cwd, fs.realpathSync.native(process.cwd()));
    assert.deepEqual(publicRecord.config.environmentNames, ["TEST_MCP_SECRET"]);
    assert.equal(publicRecord.config.timeout, 7_000);

    const files = fs.readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name));
    assert.equal(files.length, 2, "one durable profile and one one-shot envelope are expected");
    const durable = files.find((file) => file.includes(`${path.sep}definitions${path.sep}`));
    const launch = files.find((file) => file.includes(`${path.sep}launch${path.sep}`));
    assert.ok(durable);
    assert.ok(launch);
    assert.doesNotMatch(fs.readFileSync(durable, "utf8"), /must-live-only/u);
    assert.doesNotMatch(fs.readFileSync(launch, "utf8"), /must-live-only/u);
    assert.match(fs.readFileSync(launch, "utf8"), /"ciphertext"/u);
  } finally {
    if (previous.registry === undefined) delete process.env.BREADBOARD_LOCAL_MCP_REGISTRY_ROOT;
    else process.env.BREADBOARD_LOCAL_MCP_REGISTRY_ROOT = previous.registry;
    if (previous.token === undefined) delete process.env.BREADBOARD_LOCAL_MCP_BROKER_TOKEN;
    else process.env.BREADBOARD_LOCAL_MCP_BROKER_TOKEN = previous.token;
    if (previous.secret === undefined) delete process.env.TEST_MCP_SECRET;
    else process.env.TEST_MCP_SECRET = previous.secret;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
