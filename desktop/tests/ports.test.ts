import { test } from "node:test";
import assert from "node:assert/strict";
import * as net from "node:net";
import { allocatePort, allocatePortOrAdopt, findFreePort, isPortFree } from "../src/main/ports";

test("allocatePort prefers the requested port when free", async () => {
  const free = await findFreePort();
  const taken = new Set<number>();
  const allocated = await allocatePort(free, taken);
  assert.equal(allocated, free);
  assert.ok(taken.has(free));
});

test("allocatePort falls back when the preferred port is occupied", async () => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const busyPort = address.port;
  try {
    const taken = new Set<number>();
    const allocated = await allocatePort(busyPort, taken);
    assert.notEqual(allocated, busyPort);
    assert.ok(allocated > 0);
  } finally {
    server.close();
  }
});

test("allocatePort never returns a port already reserved this launch", async () => {
  const free = await findFreePort();
  const taken = new Set<number>([free]);
  const allocated = await allocatePort(free, taken);
  assert.notEqual(allocated, free);
});

test("a port with a wildcard listener is never reported free", async () => {
  // Reproduces the Windows case that made the desktop app hand the dashboard
  // a port already served by a developer's dev server: binding 127.0.0.1:P
  // can succeed while another process listens on 0.0.0.0:P.
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const port = address.port;
  try {
    assert.equal(await isPortFree(port), false);
    const taken = new Set<number>();
    assert.notEqual(await allocatePort(port, taken), port);
  } finally {
    server.close();
  }
});

test("isPortFree reports an occupied port", async () => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  try {
    assert.equal(await isPortFree(address.port), false);
  } finally {
    server.close();
  }
});

test("an occupied preferred port is kept when the service on it is ours", async () => {
  // The duplication case: the port is busy because this very service is already
  // running. Relocating would start a second copy of it.
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const busyPort = address.port;
  try {
    const taken = new Set<number>();
    const result = await allocatePortOrAdopt(busyPort, taken, async () => true);
    assert.deepEqual(result, { port: busyPort, adopt: true });
    assert.ok(taken.has(busyPort));
  } finally {
    server.close();
  }
});

test("an occupied preferred port still relocates when the occupant is not ours", async () => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const busyPort = address.port;
  try {
    const taken = new Set<number>();
    const result = await allocatePortOrAdopt(busyPort, taken, async () => false);
    assert.equal(result.adopt, false);
    assert.notEqual(result.port, busyPort);
  } finally {
    server.close();
  }
});

test("a free preferred port never runs the identity probe", async () => {
  const free = await findFreePort();
  let probed = false;
  const result = await allocatePortOrAdopt(free, new Set<number>(), async () => {
    probed = true;
    return true;
  });
  assert.deepEqual(result, { port: free, adopt: false });
  assert.equal(probed, false);
});
