import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { cliproxyHome, renderCliproxyConfig } from "../src/main/cliproxy";
import type { ResolvedPaths } from "../src/main/path-resolver";

test("subscription quota refusals return promptly to ChatMock failover", () => {
  const config = renderCliproxyConfig({
    home: "C:/Breadboard/cliproxy",
    port: 8317,
    apiKey: "loopback-api-key",
    managementKey: "loopback-management-key",
  });

  assert.match(config, /^request-retry: 0$/m);
  assert.doesNotMatch(config, /^request-retry: [1-9]\d*$/m);
  assert.match(config, /^  switch-project: true$/m);
});

test("QA mode never reuses the developer subscription account cache", () => {
  const previous = process.env["CLIPROXY_HOME"];
  delete process.env["CLIPROXY_HOME"];
  try {
    const paths = {
      mode: "dev",
      qaMode: true,
      dataRoot: path.resolve("C:/qa-user-data/Data"),
    } as ResolvedPaths;
    assert.equal(cliproxyHome(paths), path.join(paths.dataRoot, "cliproxy"));
  } finally {
    if (previous === undefined) delete process.env["CLIPROXY_HOME"];
    else process.env["CLIPROXY_HOME"] = previous;
  }
});
