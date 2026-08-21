// Which browser OpenCLI should drive.
//
// The daemon accepts a connection from every browser profile running the
// extension, and refuses to act when more than one is connected and none has
// been chosen:
//
//   BROWSER_CONNECT: Multiple Browser Bridge profiles are connected
//
// That refusal takes out every login-backed Agent Reach channel at once, and
// it is a state Breadboard can walk a person into. Anyone who installed
// OpenCLI from the Chrome Web Store for their own use now has two connected
// profiles the moment Breadboard opens its browser: theirs and ours. Shipping
// the extension without settling this would trade six closed channels for ten
// broken ones.
//
// So Breadboard names its own profile and selects it. Identification is by
// difference rather than by guessing: snapshot which profiles are connected
// before the window opens, and the one that appears afterwards is the one we
// just launched. Nothing else is touched — another profile keeps its alias,
// and a person who later runs `opencli profile use` themselves overrides this.
//
// Reading uses the daemon's loopback status API, which is documented and free
// of side effects. `opencli doctor` is not usable here: it auto-starts the
// daemon, so a health check written on it changes what it measures.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { agentBrowserProfileDir } from "./browser-profile.ts";

const DAEMON_STATUS_URL = "http://127.0.0.1:19825/status";

/** The alias Breadboard gives the profile it launched. */
export const BREADBOARD_PROFILE_ALIAS = "breadboard";

/** How long to wait for a freshly launched browser to connect its extension. */
const CLAIM_TIMEOUT_MS = 12_000;
const POLL_INTERVAL_MS = 500;

export interface BridgeStatus {
  /** Every profile currently connected to the daemon. */
  contextIds: string[];
  /** The daemon is refusing to act until a profile is chosen. */
  profileRequired: boolean;
}

/**
 * Which profiles the daemon can see, or null if it is not running.
 *
 * Null and empty are different answers and the caller needs both: no daemon
 * means there is nothing to claim, while a running daemon with no profiles
 * means the extension has not come up yet and waiting is worthwhile.
 */
export async function readBridgeStatus(options?: {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<BridgeStatus | null> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(DAEMON_STATUS_URL, {
      headers: { "X-OpenCLI": "1" },
      signal: options?.signal ?? AbortSignal.timeout(2_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      ok?: unknown;
      profiles?: unknown;
      profileRequired?: unknown;
    };
    if (payload.ok !== true) return null;
    const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
    const contextIds = profiles
      .map((entry) =>
        entry && typeof entry === "object" && typeof (entry as { contextId?: unknown }).contextId === "string"
          ? (entry as { contextId: string }).contextId
          : null,
      )
      .filter((id): id is string => Boolean(id));
    return { contextIds, profileRequired: payload.profileRequired === true };
  } catch {
    // Not running, not listening, or too slow. All mean the same thing here.
    return null;
  }
}

/**
 * Where the identified profile is remembered.
 *
 * Identification by difference only works once. The daemon keeps a profile
 * listed after its window closes, and the same --user-data-dir reconnects
 * under the same contextId, so on every re-open ours is already in the
 * "before" snapshot and looks like everyone else's. Writing the id down the
 * first time it *was* unambiguous turns a one-shot inference into a durable
 * fact, which is what makes this work on the second run and the hundredth.
 */
export function bridgeProfileRecordPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(path.dirname(agentBrowserProfileDir(env)), "agent-browser-bridge.json");
}

/** The contextId Breadboard's browser last connected under, if it is known. */
export function rememberedContextId(env: NodeJS.ProcessEnv = process.env): string | null {
  const file = bridgeProfileRecordPath(env);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { contextId?: unknown };
    return typeof parsed.contextId === "string" && parsed.contextId ? parsed.contextId : null;
  } catch {
    return null;
  }
}

function rememberContextId(contextId: string, env: NodeJS.ProcessEnv): void {
  try {
    const file = bridgeProfileRecordPath(env);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ contextId, at: new Date().toISOString() }), "utf8");
  } catch {
    // Only costs us the shortcut next time; the claim itself still stands.
  }
}

/**
 * The environment that points OpenCLI at Breadboard's browser.
 *
 * `opencli profile use` is not enough on its own. On 1.8.6 it marks the profile
 * `default` in `profile list` and the daemon still answers every command with
 * "Multiple Browser Bridge profiles are connected" — verified live, with two
 * browsers connected and ours selected. What does work is naming the profile
 * per invocation, so that is what this passes.
 *
 * Conditional on purpose. A profile that is not connected is a hard failure
 * (`Browser profile "x" is not connected`), so setting this unconditionally
 * would break the ordinary single-browser case to fix the rarer one. The
 * contextId is used rather than the alias because it is what the daemon itself
 * reports, and it cannot drift if the alias is later reassigned.
 */
export async function openCliProfileEnv(options?: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, string>> {
  const env = options?.env ?? process.env;
  // Anything the person set themselves wins; this is a default, not a policy.
  if (env.OPENCLI_PROFILE?.trim()) return {};
  const remembered = rememberedContextId(env);
  if (!remembered) return {};
  const status = await readBridgeStatus({ fetchImpl: options?.fetchImpl });
  if (!status || !status.contextIds.includes(remembered)) return {};
  return { OPENCLI_PROFILE: remembered };
}

export type ProfileClaim =
  /** Ours was identified, named and selected. */
  | { status: "claimed"; contextId: string; alias: string }
  /** One profile is connected, so the daemon has no choice to make. */
  | { status: "not_needed"; reason: string }
  /** Something is connected that we cannot safely tell apart from ours. */
  | { status: "skipped"; reason: string };

function runOpenCli(args: string[], timeoutMs = 10_000): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    execFile(
      "opencli",
      args,
      // shell:true so Windows resolves the npm-installed `opencli.cmd` shim,
      // which execFile will not find on its own.
      { timeout: timeoutMs, shell: process.platform === "win32", windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, message: (stderr || stdout || error.message).trim().slice(0, 400) });
          return;
        }
        resolve({ ok: true, message: String(stdout).trim().slice(0, 400) });
      },
    );
  });
}

/**
 * Name and select the profile that appeared after the window opened.
 *
 * Best-effort, like the install: every failure is a `skipped` with a reason,
 * because the browser is already open by the time this runs and nothing here
 * is worth taking that away from the person.
 */
export async function claimBreadboardProfile(options: {
  /** Profiles connected *before* the window was launched. */
  before: readonly string[];
  fetchImpl?: typeof fetch;
  execImpl?: (args: string[]) => Promise<{ ok: boolean; message: string }>;
  timeoutMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
}): Promise<ProfileClaim> {
  const env = options.env ?? process.env;
  const exec = options.execImpl ?? ((args: string[]) => runOpenCli(args));
  const sleep = options.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (options.timeoutMs ?? CLAIM_TIMEOUT_MS);
  const known = new Set(options.before);
  const remembered = rememberedContextId(env);

  let appeared: string | null = null;
  let last: BridgeStatus | null = null;
  for (;;) {
    const status = await readBridgeStatus({ fetchImpl: options.fetchImpl });
    last = status ?? last;
    if (status) {
      // What we already know beats what we can infer. On every run after the
      // first this is the branch that fires, and it is the only one that stays
      // correct when someone else's browser is connected too.
      if (remembered && status.contextIds.includes(remembered)) {
        appeared = remembered;
        break;
      }
      const fresh = status.contextIds.filter((id) => !known.has(id));
      if (fresh.length === 1) {
        appeared = fresh[0];
        break;
      }
      if (fresh.length > 1) {
        // Two browsers came up during the same window. Guessing which is ours
        // could hand the agents somebody's personal session, so decline.
        return {
          status: "skipped",
          reason: `${fresh.length} profiles connected at once, so none could be identified as Breadboard's`,
        };
      }
    }
    if (Date.now() >= deadline) break;
    await sleep(POLL_INTERVAL_MS);
  }

  if (!appeared) {
    // Nothing new turned up. That is the ordinary case for a re-open: the
    // daemon remembers a profile after its window closes, and the same
    // --user-data-dir reconnects under the same contextId, so ours is already
    // in the snapshot and can never look fresh.
    if (!last) return { status: "skipped", reason: "the OpenCLI daemon is not running" };
    if (last.contextIds.length === 1 && !last.profileRequired) {
      // One connected profile needs no selecting — this is what the daemon
      // does by default, and it is why the commands worked before any of this
      // existed. Renaming on a guess here is the one move that could point the
      // agents at somebody's personal browser, so it is not made.
      return { status: "not_needed", reason: "one browser is connected, so OpenCLI has no choice to make" };
    }
    return {
      status: "skipped",
      reason:
        last.contextIds.length === 0
          ? "the browser did not connect its extension in time"
          : `${last.contextIds.length} browsers are connected and none could be identified as Breadboard's — choose one with "opencli profile use"`,
    };
  }

  const renamed = await exec(["profile", "rename", appeared, BREADBOARD_PROFILE_ALIAS]);
  if (!renamed.ok) {
    return { status: "skipped", reason: `could not name the profile: ${renamed.message}` };
  }
  const selected = await exec(["profile", "use", BREADBOARD_PROFILE_ALIAS]);
  if (!selected.ok) {
    return { status: "skipped", reason: `could not select the profile: ${selected.message}` };
  }
  // Written only after both commands succeeded, so a remembered id is always
  // one that was genuinely identified and genuinely selected.
  rememberContextId(appeared, env);
  return { status: "claimed", contextId: appeared, alias: BREADBOARD_PROFILE_ALIAS };
}
