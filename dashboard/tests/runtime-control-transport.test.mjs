import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { Agent } from "undici";

import {
  RUNTIME_CONTROL_KEEP_ALIVE_MS,
  RUNTIME_JOB_CONTROL_CONNECTIONS,
  RUNTIME_SERVICE_CONTROL_CONNECTIONS,
  createRuntimeControlTransports,
} from "../src/lib/runtime-control-transport.ts";

function deferred() {
  let settled = false;
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve() {
      if (settled) return;
      settled = true;
      resolvePromise();
    },
  };
}

async function within(promise, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function consume(responsePromise) {
  const response = await responsePromise;
  assert.equal(response.status, 200);
  await response.text();
}

test("Runtime control transport bounds Hot fan-out and keeps jobs separate from services", async () => {
  const dispatchers = [];
  const requests = [];
  const transports = createRuntimeControlTransports({
    dispatcherFactory(options) {
      const dispatcher = { index: dispatchers.length };
      dispatchers.push({ dispatcher, options });
      return dispatcher;
    },
    async fetchImplementation(input, init) {
      requests.push({ input: String(input), dispatcher: init?.dispatcher });
      return Response.json({ ok: true });
    },
  });

  await transports.job("http://127.0.0.1:43121/v1/jobs/job_1");
  await transports.service("http://127.0.0.1:43121/v1/status");

  assert.deepEqual(
    dispatchers.map(({ options }) => options),
    [
      {
        connections: RUNTIME_JOB_CONTROL_CONNECTIONS,
        pipelining: 0,
        keepAliveTimeout: RUNTIME_CONTROL_KEEP_ALIVE_MS,
        keepAliveMaxTimeout: RUNTIME_CONTROL_KEEP_ALIVE_MS,
      },
      {
        connections: RUNTIME_SERVICE_CONTROL_CONNECTIONS,
        pipelining: 0,
        keepAliveTimeout: RUNTIME_CONTROL_KEEP_ALIVE_MS,
        keepAliveMaxTimeout: RUNTIME_CONTROL_KEEP_ALIVE_MS,
      },
    ],
  );
  assert.equal(requests[0].dispatcher, dispatchers[0].dispatcher);
  assert.equal(requests[1].dispatcher, dispatchers[1].dispatcher);
  assert.notEqual(requests[0].dispatcher, requests[1].dispatcher);
  assert.equal(
    RUNTIME_JOB_CONTROL_CONNECTIONS + RUNTIME_SERVICE_CONTROL_CONNECTIONS,
    24,
  );
});

test("Runtime control transport keeps only a sanitized socket failure code", async () => {
  const evidence = [];
  const transports = createRuntimeControlTransports({
    dispatcherFactory() {
      return {};
    },
    async fetchImplementation() {
      const privateCause = Object.assign(new Error("private socket detail"), {
        code: "UND_ERR_SOCKET",
        socket: { localPort: 43121, bytesWritten: 321, bytesRead: 0 },
      });
      throw new TypeError("fetch failed", { cause: privateCause });
    },
    onTransportError(value) {
      evidence.push(value);
    },
  });

  await assert.rejects(
    transports.job("http://127.0.0.1:43121/v1/status"),
    (error) => {
      assert.equal(error?.message, "Runtime control transport failed (UND_ERR_SOCKET).");
      assert.doesNotMatch(error?.message ?? "", /private|43121/u);
      return true;
    },
  );
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].pool, "job");
  assert.match(evidence[0].realm, /^\d+-[0-9a-f]{8}$/u);
  assert.equal(evidence[0].code, "UND_ERR_SOCKET");
  assert.equal(evidence[0].bytesWritten, 321);
  assert.equal(evidence[0].bytesRead, 0);
  assert.doesNotMatch(JSON.stringify(evidence[0]), /private|43121|localPort/u);
});

test("cache-busted Hot modules reuse one global Runtime transport", async (t) => {
  const globalKey = "__breadboardRuntimeControlTransportsV1";
  delete globalThis[globalKey];
  t.after(() => {
    delete globalThis[globalKey];
  });

  const firstModule = await import(
    "../src/lib/runtime-control-transport.ts?runtime-control-hmr=first"
  );
  const first = firstModule.runtimeControlTransports();
  const secondModule = await import(
    "../src/lib/runtime-control-transport.ts?runtime-control-hmr=second"
  );
  const second = secondModule.runtimeControlTransports();

  assert.notEqual(firstModule, secondModule);
  assert.equal(first, second);
  assert.equal(first.job, second.job);
  assert.equal(first.service, second.service);
});

test("real Runtime transport bounds both pools and keeps jobs progressing", async (t) => {
  const serviceGate = deferred();
  const jobGate = deferred();
  const serviceAtLimit = deferred();
  const jobAtLimit = deferred();
  const jobProgressed = deferred();
  const serviceProgressed = deferred();
  const handlerErrors = [];
  const socketKinds = new WeakMap();
  const metrics = {
    job: { active: 0, maxActive: 0, openSockets: new Set(), maxOpenSockets: 0 },
    service: { active: 0, maxActive: 0, openSockets: new Set(), maxOpenSockets: 0 },
  };
  let serviceActiveAtJobProgress = null;
  let jobActiveAtServiceProgress = null;

  function observeSocket(kind, socket) {
    const existingKind = socketKinds.get(socket);
    if (existingKind && existingKind !== kind) {
      handlerErrors.push(new Error("A socket crossed Runtime transport pools."));
      return;
    }
    if (existingKind) return;
    socketKinds.set(socket, kind);
    const metric = metrics[kind];
    metric.openSockets.add(socket);
    metric.maxOpenSockets = Math.max(metric.maxOpenSockets, metric.openSockets.size);
    socket.once("close", () => metric.openSockets.delete(socket));
  }

  async function handle(request, response) {
    const pathname = new URL(request.url ?? "/", "http://runtime.test").pathname;
    if (pathname.startsWith("/service/")) observeSocket("service", request.socket);
    if (pathname.startsWith("/job/")) observeSocket("job", request.socket);

    if (pathname.startsWith("/service/held/")) {
      metrics.service.active += 1;
      metrics.service.maxActive = Math.max(metrics.service.maxActive, metrics.service.active);
      if (metrics.service.active === RUNTIME_SERVICE_CONTROL_CONNECTIONS) {
        serviceAtLimit.resolve();
      }
      await serviceGate.promise;
      metrics.service.active -= 1;
    } else if (pathname === "/job/progress") {
      serviceActiveAtJobProgress = metrics.service.active;
      jobProgressed.resolve();
    } else if (pathname.startsWith("/job/held/")) {
      metrics.job.active += 1;
      metrics.job.maxActive = Math.max(metrics.job.maxActive, metrics.job.active);
      if (metrics.job.active === RUNTIME_JOB_CONTROL_CONNECTIONS) jobAtLimit.resolve();
      await jobGate.promise;
      metrics.job.active -= 1;
    } else if (pathname === "/service/progress") {
      jobActiveAtServiceProgress = metrics.job.active;
      serviceProgressed.resolve();
    } else {
      response.writeHead(404);
      response.end();
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"ok":true}');
  }

  const server = http.createServer((request, response) => {
    void handle(request, response).catch((error) => {
      handlerErrors.push(error);
      response.destroy(error);
    });
  });
  await listen(server);

  const dispatchers = [];
  const transports = createRuntimeControlTransports({
    dispatcherFactory(options) {
      const dispatcher = new Agent(options);
      dispatchers.push(dispatcher);
      return dispatcher;
    },
  });
  t.after(async () => {
    serviceGate.resolve();
    jobGate.resolve();
    await Promise.allSettled(dispatchers.map((dispatcher) => dispatcher.close()));
    await close(server);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  const serviceCompletion = Promise.all(
    Array.from({ length: RUNTIME_SERVICE_CONTROL_CONNECTIONS + 1 }, (_, index) =>
      consume(transports.service(`${origin}/service/held/${index}`)),
    ),
  );
  void serviceCompletion.catch(() => undefined);
  await within(serviceAtLimit.promise, "all service sockets to become active");
  assert.equal(metrics.service.active, RUNTIME_SERVICE_CONTROL_CONNECTIONS);

  const jobProgressCompletion = consume(transports.job(`${origin}/job/progress`));
  await within(jobProgressed.promise, "job traffic to bypass saturated service traffic");
  await within(jobProgressCompletion, "the independent job request to finish");
  assert.equal(serviceActiveAtJobProgress, RUNTIME_SERVICE_CONTROL_CONNECTIONS);
  assert.equal(metrics.service.maxActive, RUNTIME_SERVICE_CONTROL_CONNECTIONS);

  serviceGate.resolve();
  await within(serviceCompletion, "held service requests to finish");

  const jobCompletion = Promise.all(
    Array.from({ length: RUNTIME_JOB_CONTROL_CONNECTIONS + 1 }, (_, index) =>
      consume(transports.job(`${origin}/job/held/${index}`)),
    ),
  );
  void jobCompletion.catch(() => undefined);
  await within(jobAtLimit.promise, "all job sockets to become active");
  assert.equal(metrics.job.active, RUNTIME_JOB_CONTROL_CONNECTIONS);

  const serviceProgressCompletion = consume(
    transports.service(`${origin}/service/progress`),
  );
  await within(serviceProgressed.promise, "service traffic to bypass saturated job traffic");
  await within(serviceProgressCompletion, "the independent service request to finish");
  assert.equal(jobActiveAtServiceProgress, RUNTIME_JOB_CONTROL_CONNECTIONS);
  assert.equal(metrics.job.maxActive, RUNTIME_JOB_CONTROL_CONNECTIONS);

  jobGate.resolve();
  await within(jobCompletion, "held job requests to finish");

  assert.equal(handlerErrors.length, 0);
  assert.ok(metrics.job.maxOpenSockets <= RUNTIME_JOB_CONTROL_CONNECTIONS);
  assert.ok(metrics.service.maxOpenSockets <= RUNTIME_SERVICE_CONTROL_CONNECTIONS);
});
