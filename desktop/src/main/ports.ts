import * as net from "node:net";

/**
 * Dynamic loopback port allocation.
 *
 * Preferred ports keep parity with the documented dev stack (3000/8765/4096/8081)
 * so external tooling and docs stay recognizable, but any conflict falls back
 * to an OS-assigned free port. Everything binds 127.0.0.1 only.
 */
/**
 * A port counts as free only when we can bind it AND nothing answers a
 * connection on it.
 *
 * The bind test alone is not sufficient on Windows: when another process
 * listens on `0.0.0.0:PORT` without `SO_EXCLUSIVEADDRUSE` (the default for
 * Node/Next/Python dev servers), binding the more specific `127.0.0.1:PORT`
 * still succeeds. Handing that port to a service would either fail later or,
 * worse, let the desktop app talk to an unrelated process that happens to
 * serve the same routes (e.g. a developer's `next dev` on 3000).
 */
export async function isPortFree(port: number, host = "127.0.0.1"): Promise<boolean> {
  if (!(await canBind(port, host))) return false;
  return !(await someoneIsListening(port, host));
}

function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

function someoneIsListening(port: number, host: string, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export async function findFreePort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ port: 0, host, exclusive: true }, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a port")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

export async function allocatePort(preferred: number, taken: Set<number>): Promise<number> {
  if (!taken.has(preferred) && (await isPortFree(preferred))) {
    taken.add(preferred);
    return preferred;
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = await findFreePort();
    if (!taken.has(port)) {
      taken.add(port);
      return port;
    }
  }
  throw new Error(`Could not allocate a free loopback port (preferred ${preferred})`);
}
