/** Sites' own agent interfaces: served once installs on enough networks reported one, found by domain even with no operations. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { evidence, install, op, registry, send, site } from "./helpers.js";

const MCP = { kind: "mcp", url: "https://mcp.example.com/sse" };
const report = (env: ReturnType<typeof registry>["env"], ip: string, body: unknown = MCP) =>
  send(env, "POST", "/v1/interfaces", { as: install(), ip, body });

test("an interface is served once two installs on two networks report it, beside the site's operations", async () => {
  const { env } = registry();
  await send(env, "POST", "/v1/versions", { as: install(), body: { site, operation: op(), evidence } });
  const first = await report(env, "198.51.100.7");
  assert.equal(first.status, 200, first.text);
  assert.deepEqual(first.body, { domain: "example.com", served: false });
  assert.equal((await report(env, "198.51.100.8")).body.served, false, "the same network is one voice");
  const second = await report(env, "192.0.2.44");
  assert.equal(second.body.served, true);
  const served = await send(env, "GET", "/v1/sites/example-com");
  assert.deepEqual(served.body.interfaces, [{ kind: "mcp", url: MCP.url, confirmations: 2 }]);
  const found = await send(env, "GET", "/v1/search?q=example.com");
  assert.equal(found.body.matches[0].interfaces[0].url, MCP.url);
});

test("a domain search finds a site that has only its own interface, and records no demand for it", async () => {
  const { env } = registry();
  const url = "https://api.weather-example.org/openapi.json";
  await report(env, "198.51.100.7", { kind: "openapi", url });
  await report(env, "192.0.2.44", { kind: "openapi", url });
  const r = await send(env, "GET", "/v1/search?q=weather-example.org");
  assert.deepEqual(r.body.matches, [
    {
      name: "weather-example-org",
      domain: "weather-example.org",
      displayName: "weather-example.org",
      operations: [],
      interfaces: [{ kind: "openapi", url, confirmations: 2 }],
    },
  ]);
  assert.deepEqual((await send(env, "GET", "/v1/demand")).body.demand, []);
});

test("an interface that is not https on a public host is refused", async () => {
  const { env } = registry();
  for (const url of ["http://mcp.example.com/sse", "https://10.0.0.2/mcp", "https://localhost/mcp"]) {
    const r = await report(env, "198.51.100.7", { kind: "mcp", url });
    assert.equal(r.status, 422, url);
  }
  assert.equal((await report(env, "198.51.100.7", { kind: "graphql", url: MCP.url })).status, 400);
});
