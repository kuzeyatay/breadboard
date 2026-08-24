// "Is this service already running?" — the question every Breadboard launcher
// asks before it spawns anything.
//
// Starting the stack used to be unconditional: `npm run dev` spawned a fresh
// copy of every service whether or not one was already up. On loopback ports
// that means the second copy either loses the race to bind and dies with a
// stack trace, or (worse, on the desktop side) quietly moves to a spare port
// and runs a duplicate against the same data. Two `next dev` servers and two
// Hermes runtimes on one machine is not a state anybody asked for.
//
// Three answers, because "something is listening" is not the same as "the thing
// listening is ours":
//
//   running — an instance we can actually use answered. Adopt it; start nothing.
//   foreign — the port is held by something that did not answer the way this
//             service does (an unrelated app, or a Breadboard service holding a
//             different secret). Reported, then left to the launcher: starting
//             anyway is what happens today and stays the safe default.
//   absent  — nothing is listening. Start normally.
//
// A fourth, transient state sits behind those: a server that accepted the
// connection and has not answered yet. That is not a stranger — it is a service
// warming up, and a lazily-compiling `next dev` stays there for fifteen seconds
// on the first request to a route. Probes wait it out (see `probeService`)
// instead of reading silence as "nobody is home".
//
// Probes hit a credential-gated endpoint wherever the service has one. An open
// /health proves a service of the right kind is there; it does not prove the
// running instance will accept our secret, and adopting one that will not is
// how you get a stack that looks healthy and 401s on the first real request.

import net from "node:net";

/**
 * @typedef {object} ProbeSpec
 * @property {string} url                     Full loopback URL to probe.
 * @property {"GET"|"POST"} [method]          Defaults to GET.
 * @property {string} [body]                  Request body, for POST probes.
 * @property {Record<string,string>} [headers]
 * @property {string} [expectBodyIncludes]    Substring the body must contain.
 * @property {number[]} [acceptStatuses]      Exact statuses that mean "ours",
 *                                            replacing the 2xx/3xx rule. Used
 *                                            for gated endpoints, where 401 is
 *                                            the interesting failure and a 400
 *                                            or 404 means the secret matched.
 * @property {number} [timeoutMs]
 */

/**
 * One attempt.
 *
 * `warming` is the state that matters and the one a naive probe gets wrong: the
 * request was accepted and simply not answered yet. A cold `next dev` holds the
 * connection open for as long as it takes to compile the route — fifteen
 * seconds is ordinary — so a single short probe reads a perfectly good server
 * as a stranger and starts a second one over it.
 *
 * @returns {Promise<"running" | "foreign" | "warming" | "absent">}
 */
async function probeOnce(spec) {
  const timeoutMs = spec.timeoutMs ?? 2_500;
  let response;
  try {
    response = await fetch(spec.url, {
      method: spec.method ?? "GET",
      headers: spec.headers,
      body: spec.body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const { port, hostname } = new URL(spec.url);
    // A timeout means the connection was accepted and the answer is still
    // coming; anything else (refused, reset) means nothing usable is there.
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    if (timedOut) return "warming";
    return (await isListening(Number(port), hostname, 1_000)) ? "foreign" : "absent";
  }
  const status = response.status;
  const statusOk = spec.acceptStatuses ? spec.acceptStatuses.includes(status) : response.ok;
  if (!statusOk) return "foreign";
  if (!spec.expectBodyIncludes) return "running";
  const text = await response.text().catch(() => "");
  return text.includes(spec.expectBodyIncludes) ? "running" : "foreign";
}

/**
 * Keep asking while the server is up but still answering nothing, up to
 * `budgetMs` (default one attempt). A real reply — wrong status, wrong body,
 * a 401 — settles it immediately, so the budget is only ever spent on a port
 * that is genuinely holding the request open.
 *
 * @returns {Promise<"running" | "foreign" | "absent">}
 */
export async function probeService(spec, budgetMs = 0) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const result = await probeOnce(spec);
    if (result !== "warming") return result;
    if (Date.now() >= deadline) return "foreign";
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * How long to wait on a silent occupant, per service. Only the lazily-compiling
 * ones need more than a single attempt.
 */
export const WARMING_BUDGET_MS = { dashboard: 45_000, quartz: 20_000 };

/** True when something holds the port, regardless of what it speaks. */
export function isListening(port, host = "127.0.0.1", timeoutMs = 1_000) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (listening) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/**
 * The focused-launcher guard: exit successfully when an instance we can use is
 * already serving, so `npm run dev:<service>` (and the full stack, which runs
 * these launchers) reuses it instead of racing it for the port.
 *
 * A foreign occupant is reported and then left alone — the caller proceeds
 * exactly as it did before this existed, and the service's own bind error
 * stays the authority on what went wrong.
 */
export async function exitIfAlreadyRunning(name, spec, budgetMs = 0) {
  const state = await probeService(spec, budgetMs);
  const target = new URL(spec.url).origin;
  if (state === "running") {
    process.stdout.write(`[${name}] Already running at ${target} — reusing it.\n`);
    process.exit(0);
  }
  if (state === "foreign") {
    process.stderr.write(
      `[${name}] ${target} is held by a process that does not answer as this service; starting anyway.\n`,
    );
  }
  return state;
}
