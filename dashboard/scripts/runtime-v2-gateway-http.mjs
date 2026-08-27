import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MIN_TOKEN_BYTES = 32;
const MAX_TOKEN_BYTES = 1024;

function fail(message) {
  throw new Error(message);
}

function parsePort(argv) {
  if (argv.length !== 2 || argv[0] !== "--port" || !/^\d{1,5}$/u.test(argv[1])) {
    fail("The Runtime V2 gateway service requires one bounded --port argument.");
  }
  const port = Number(argv[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    fail("The Runtime V2 gateway service port is invalid.");
  }
  return port;
}

function serviceToken(environmentName) {
  const token = process.env[environmentName]?.trim() ?? "";
  const bytes = Buffer.from(token, "utf8");
  if (
    bytes.byteLength < MIN_TOKEN_BYTES ||
    bytes.byteLength > MAX_TOKEN_BYTES ||
    !bytes.every((byte) => byte >= 0x21 && byte <= 0x7e)
  ) {
    fail("The Runtime V2 gateway service capability is invalid.");
  }
  return bytes;
}

function authorized(request, expectedToken) {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const candidate = Buffer.from(header.slice(7), "utf8");
  return candidate.byteLength === expectedToken.byteLength && timingSafeEqual(candidate, expectedToken);
}

function readJsonBody(request, maximumBytes = MAX_REQUEST_BYTES) {
  return new Promise((resolve, reject) => {
    const declared = request.headers["content-length"];
    if (typeof declared === "string") {
      if (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes) {
        reject(Object.assign(new Error("The gateway request is too large."), { status: 413 }));
        request.destroy();
        return;
      }
    }
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.byteLength;
      if (total > maximumBytes) {
        reject(Object.assign(new Error("The gateway request is too large."), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once("error", reject);
    request.once("end", () => {
      try {
        const bytes = Buffer.concat(chunks, total);
        resolve(bytes.byteLength === 0 ? {} : JSON.parse(bytes.toString("utf8")));
      } catch {
        reject(Object.assign(new Error("The gateway request is not valid JSON."), { status: 400 }));
      }
    });
  });
}

function statusOf(error) {
  const status = error && typeof error === "object" ? error.status : undefined;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function errorCode(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  return typeof code === "string" && /^[a-z0-9_-]{1,64}$/u.test(code)
    ? code
    : "gateway_request_failed";
}

function sendJson(response, status, value, maximumBytes = MAX_RESPONSE_BYTES) {
  if (response.destroyed || response.writableEnded) return;
  let bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength > maximumBytes) {
    status = 500;
    bytes = Buffer.from('{"ok":false,"error":{"code":"gateway_response_too_large","message":"The gateway response exceeded its bound."}}\n');
  }
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(bytes.byteLength),
    "cache-control": "no-store",
  });
  response.end(bytes);
}

function startStopInput(stop) {
  let buffered = "";
  process.stdin.setEncoding("utf8");
  const onData = (chunk) => {
    buffered += chunk;
    if (Buffer.byteLength(buffered, "utf8") > 1024) {
      void stop();
      return;
    }
    const newline = buffered.indexOf("\n");
    if (newline < 0) return;
    const line = buffered.slice(0, newline);
    try {
      const value = JSON.parse(line);
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).sort().join(",") !== "force,type" ||
        value.type !== "stop" ||
        value.force !== false
      ) {
        throw new Error("invalid stop record");
      }
    } catch {
      // A malformed native control record is fail-closed too.
    }
    void stop();
  };
  process.stdin.on("data", onData);
  process.stdin.resume();
  return () => {
    process.stdin.off("data", onData);
    process.stdin.pause();
  };
}

export async function startRuntimeV2GatewayHttpService({
  name,
  tokenEnvironmentName,
  route,
  onStarted,
  onStop,
  argv = process.argv.slice(2),
  maximumRequestBytes = MAX_REQUEST_BYTES,
  maximumResponseBytes = MAX_RESPONSE_BYTES,
}) {
  if (
    !Number.isSafeInteger(maximumRequestBytes) ||
    maximumRequestBytes < 1 ||
    maximumRequestBytes > 2 * 1024 * 1024 ||
    !Number.isSafeInteger(maximumResponseBytes) ||
    maximumResponseBytes < 1 ||
    maximumResponseBytes > 2 * 1024 * 1024
  ) {
    fail("The Runtime V2 gateway service bounds are invalid.");
  }
  const port = parsePort(argv);
  const token = serviceToken(tokenEnvironmentName);
  let stopping = false;
  let server;
  let closeStopInput = () => undefined;
  const onSignal = () => void stop();
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    closeStopInput();
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    await onStop?.().catch(() => undefined);
    await new Promise((resolve) => server?.close(() => resolve()));
  };
  server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { ok: true, service: name }, maximumResponseBytes);
      return;
    }
    if (!authorized(request, token)) {
      sendJson(response, 401, { ok: false, error: { code: "unauthorized", message: "Gateway authorization failed." } }, maximumResponseBytes);
      return;
    }
    const disconnected = new AbortController();
    const abort = () => disconnected.abort(new DOMException("Gateway caller disconnected", "AbortError"));
    const onClose = () => {
      if (!response.writableEnded) abort();
    };
    request.once("aborted", abort);
    response.once("close", onClose);
    try {
      const body = await readJsonBody(request, maximumRequestBytes);
      const result = await route({
        method: request.method ?? "",
        path: request.url ?? "",
        body,
        signal: disconnected.signal,
      });
      sendJson(response, 200, { ok: true, result }, maximumResponseBytes);
    } catch (error) {
      sendJson(response, statusOf(error), {
        ok: false,
        error: {
          code: errorCode(error),
          message: error instanceof Error ? error.message.slice(0, 8_192) : "Gateway request failed.",
        },
      }, maximumResponseBytes);
    } finally {
      request.off("aborted", abort);
      response.off("close", onClose);
    }
  });
  server.requestTimeout = 10 * 60_000;
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, LOOPBACK_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  closeStopInput = startStopInput(stop);
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  await onStarted?.();
  return { port, stop };
}
