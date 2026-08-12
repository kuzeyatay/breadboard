import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCliproxyConfig } from "../src/main/cliproxy";

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
