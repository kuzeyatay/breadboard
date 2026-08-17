import * as net from "node:net";

/**
 * Loopback port-ownership checks.
 *
 * Extracted from `fixtures.ts` so the harness self-test suite can prove that a
 * still-held port is reported as a leak rather than silently tolerated. The
 * check must be able to fail: a run that leaves a QA-owned service listening
 * has leaked a child process, and treating that as success is exactly the kind
 * of false green this QA layer exists to prevent.
 */

export interface PortReleaseFailure extends Error {
  readonly unreleasedPorts: readonly number[];
}

export async function isLoopbackPortFree(port: number): Promise<boolean> {
  return (await canBindPort(port)) && !(await canConnectToPort(port));
}

export function canBindPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    const finish = (free: boolean): void => {
      server.removeAllListeners();
      resolve(free);
    };
    server.once("error", () => finish(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => finish(true));
    });
  });
}

export function canConnectToPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (connected: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(400, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/** Which of `ports` are still held right now. */
export async function unreleasedPorts(
  ports: readonly number[],
): Promise<readonly number[]> {
  const states = await Promise.all(
    ports.map(async (port) => ({ port, free: await isLoopbackPortFree(port) })),
  );
  return states.filter((state) => !state.free).map((state) => state.port);
}

/**
 * Wait for every QA-owned port to be released, then throw with the exact
 * offending ports. The error message is deliberately stable so receipts and the
 * failure classifier can key on it.
 */
export async function waitForPortsReleased(
  ports: readonly number[],
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let unavailable = [...ports];
  for (;;) {
    unavailable = [...(await unreleasedPorts(ports))];
    if (unavailable.length === 0) return;
    if (Date.now() > deadline) break;
    await boundedDelay(100);
  }
  const error = new Error(
    `QA-owned loopback ports were not released within ${timeoutMs}ms: ${unavailable.join(", ")}`,
  ) as PortReleaseFailure & { unreleasedPorts: readonly number[] };
  Object.assign(error, { unreleasedPorts: unavailable });
  throw error;
}

function boundedDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
