import test from "node:test";
import assert from "node:assert/strict";
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
