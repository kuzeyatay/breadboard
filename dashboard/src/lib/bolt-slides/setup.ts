// The setup panel behind the gear icon: what Bolt Slides is missing, and the
// one action that fixes it.
//
// There is exactly one thing to install — the clone's npm dependencies — and it
// runs only because a person pressed the button in the setup dialog. The argv
// is fixed, nothing from a request becomes part of it, and a deck run never
// installs anything: a run that found a missing dependency and fetched it would
// be a network install triggered by a sentence in a chat.
//
// `npm install` is used rather than `npm ci` deliberately. The checkout ships a
// lockfile, but it is a vendored clone a person may have already installed by
// hand — `ci` would delete that install and start over, which on this machine
// means several minutes to arrive back where it was.

import { spawn } from "node:child_process";
import { planSpawn } from "../agent-reach/spawn-plan.ts";
import { forgetKitDigest, kitDigest } from "./kit-digest.ts";
import { boltSlidesAvailability, resolveBoltSlidesRoot } from "./runtime.ts";

const INSTALL_TIMEOUT_MS = 20 * 60_000;

export interface BoltSlidesSetupStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  dependencies: { installed: boolean; missing: string[] };
  /** How many components the deck author has to compose with, once readable. */
  kit: { components: number; tokens: number };
}

export function setupStatus(env: NodeJS.ProcessEnv = process.env): BoltSlidesSetupStatus {
  const availability = boltSlidesAvailability(env);
  const digest = availability.cloned ? kitDigest() : null;
  return {
    ready: availability.available,
    reason: availability.reason ?? "",
    clone: { found: availability.cloned, path: availability.root ?? "" },
    dependencies: { installed: availability.installed, missing: availability.missing },
    kit: {
      components: digest?.components.length ?? 0,
      tokens: digest?.tokens.length ?? 0,
    },
  };
}

export interface BoltSlidesInstallResult {
  ok: boolean;
  message: string;
  status: BoltSlidesSetupStatus;
}

const installGlobal = globalThis as typeof globalThis & {
  __breadboardBoltSlidesInstall?: Promise<BoltSlidesInstallResult>;
};

function run(
  command: string,
  argv: readonly string[],
  cwd: string,
): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve) => {
    const plan = planSpawn(command, [...argv], process.env, () => `${command} was not found on PATH.`);
    if ("error" in plan) {
      resolve({ code: null, log: plan.error });
      return;
    }
    const child = spawn(plan.command, plan.argv, {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: plan.verbatim,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", npm_config_fund: "false", npm_config_audit: "false" },
    });
    let log = "";
    const collect = (chunk: string) => {
      log = `${log}${chunk}`.slice(-8_000);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, INSTALL_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, log: `${log}${error.message}` });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, log });
    });
  });
}

function tail(log: string): string {
  return log.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 400);
}

export function installDependencies(): Promise<BoltSlidesInstallResult> {
  if (installGlobal.__breadboardBoltSlidesInstall) {
    return installGlobal.__breadboardBoltSlidesInstall;
  }
  const request = (async (): Promise<BoltSlidesInstallResult> => {
    const root = resolveBoltSlidesRoot();
    if (!root) {
      return {
        ok: false,
        message: "The bolt-slides clone was not found. Clone it beside the dashboard first.",
        status: setupStatus(),
      };
    }
    const installed = await run("npm", ["install", "--no-audit", "--no-fund"], root);
    // The kit is read from the checkout and cached for the process; an install
    // is the one moment that answer changes.
    forgetKitDigest();
    const status = setupStatus();
    if (status.ready) {
      return {
        ok: true,
        message: `Bolt Slides is ready. ${status.kit.components} components are available to compose with.`,
        status,
      };
    }
    return {
      ok: false,
      message: `Bolt Slides' dependencies could not be installed. ${tail(installed.log)}`.trim(),
      status,
    };
  })().finally(() => {
    installGlobal.__breadboardBoltSlidesInstall = undefined;
  });
  installGlobal.__breadboardBoltSlidesInstall = request;
  return request;
}
