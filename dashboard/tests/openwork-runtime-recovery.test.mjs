import assert from "node:assert/strict";
import test from "node:test";
import { stopOpenworkRuntime } from "../src/lib/openwork/runtime-service.ts";

test("OpenWork setup stops an unavailable service without trying to launch it", async () => {
  const previousFetch = globalThis.fetch;
  const saved = { ...process.env };
  process.env.BREADBOARD_SUPERVISOR_CONTROL_URL = "http://127.0.0.1:4100";
  process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = "t".repeat(48);
  const requests = [];
  let state = "failed";
  globalThis.fetch = async (url) => {
    requests.push(new URL(url).pathname);
    assert.equal(new URL(url).pathname, "/v1/status", "stopping an unavailable service must not acquire a lease");
    return Response.json({ services: [{ id: "openwork", state }] });
  };
  try {
    for (state of ["failed", "stopped", "available-but-stopped", "resource-blocked", "installation-unavailable"]) {
      await stopOpenworkRuntime({ userId: 42 });
    }
    assert.equal(requests.length, 5);
    await assert.rejects(stopOpenworkRuntime({ userId: 0 }), /valid agent service user/);
    assert.equal(requests.length, 5, "invalid scope must fail before contacting Runtime");
    globalThis.fetch = async () => Response.json({ error: "unavailable" }, { status: 503 });
    await assert.rejects(stopOpenworkRuntime({ userId: 42 }), /status request failed/);
  } finally {
    globalThis.fetch = previousFetch;
    for (const name of ["BREADBOARD_SUPERVISOR_CONTROL_URL", "BREADBOARD_SUPERVISOR_CONTROL_TOKEN"]) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});
