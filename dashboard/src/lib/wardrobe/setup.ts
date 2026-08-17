// The setup panel behind the gear icon: what Wardrobe is missing, and the two
// actions that fix it.
//
// This is a second trust context, the same way Agent Reach's and OpenScience's
// setup panels are: the person is standing in front of the dialog asking for
// this, so an install runs here even though nothing a model says can ever
// trigger one. The argv is fixed, and the only request field that reaches disk
// is the identity photo's bytes — written to one path this module chooses, after
// being decoded and re-encoded as a PNG rather than trusted.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { planSpawn } from "../agent-reach/spawn-plan.ts";
import {
  installedDependencies,
  modelReferencePath,
  resolveWardrobeRoot,
  runtimeAvailability,
  wardrobeDataDir,
} from "./runtime.ts";

const INSTALL_TIMEOUT_MS = 20 * 60_000;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

export interface SetupStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  dependencies: { installed: boolean; vite: boolean; sharp: boolean };
  /** The identity photo every modeled shot is generated from. */
  identity: { found: boolean; path: string };
  dataDir: string;
}

export function setupStatus(env: NodeJS.ProcessEnv = process.env): SetupStatus {
  const availability = runtimeAvailability(env);
  const dependencies = installedDependencies(env);
  return {
    ready: availability.available,
    reason: availability.reason ?? "",
    clone: { found: availability.cloned, path: availability.root ?? "" },
    dependencies: { installed: availability.installed, ...dependencies },
    identity: {
      found: availability.hasModelReference,
      path: availability.modelReference ?? "",
    },
    dataDir: availability.dataDir ?? "",
  };
}

export interface SetupResult {
  ok: boolean;
  message: string;
  status: SetupStatus;
}

const installGlobal = globalThis as typeof globalThis & {
  __breadboardWardrobeInstall?: Promise<SetupResult>;
};

function runNpmInstall(root: string): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve) => {
    const plan = planSpawn(
      "npm",
      ["install", "--no-audit", "--no-fund", "--loglevel", "error"],
      process.env,
      () => "npm was not found on PATH.",
    );
    if ("error" in plan) {
      resolve({ code: null, log: plan.error });
      return;
    }
    const child = spawn(plan.command, plan.argv, {
      cwd: root,
      windowsHide: true,
      windowsVerbatimArguments: plan.verbatim,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", npm_config_yes: "true" },
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

/**
 * Install the clone's own dependencies, in the clone. Unlike the agents that npm
 * a published package into a Breadboard-owned prefix, this one has to install in
 * place: the runtime is the clone's Vite dev server, and Vite resolves its
 * plugins and its React from the project directory it is started in.
 *
 * Concurrent requests share one install — npm twice over in the same tree is how
 * a half-extracted `node_modules` happens.
 */
export function install(): Promise<SetupResult> {
  if (installGlobal.__breadboardWardrobeInstall) {
    return installGlobal.__breadboardWardrobeInstall;
  }
  const request = (async (): Promise<SetupResult> => {
    const root = resolveWardrobeRoot();
    if (!root) {
      const status = setupStatus();
      return { ok: false, message: status.reason, status };
    }
    const { code, log } = await runNpmInstall(root);
    const status = setupStatus();
    if (status.dependencies.installed) {
      return { ok: true, message: "Wardrobe's dependencies are installed.", status };
    }
    const tail = log.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 400);
    return {
      ok: false,
      message:
        `Wardrobe could not be installed${code === null ? "" : ` (npm exited with ${code})`}. ${tail}`.trim(),
      status,
    };
  })().finally(() => {
    installGlobal.__breadboardWardrobeInstall = undefined;
  });
  installGlobal.__breadboardWardrobeInstall = request;
  return request;
}

/**
 * Store the identity photo the modeled shots are generated from.
 *
 * Decoded and re-encoded through sharp rather than written through, for two
 * reasons: the clone requires a PNG and a person will hand it a phone JPEG, and
 * re-encoding is what guarantees the bytes landing on disk are an image at all.
 * It stays local — it is never uploaded anywhere but the model call it is a
 * reference for, and the clone's `data/` directory is gitignored upstream.
 */
export async function saveIdentityPhoto(dataUrl: string): Promise<SetupResult> {
  const status = () => setupStatus();
  const target = modelReferencePath();
  const dataDir = wardrobeDataDir();
  if (!target || !dataDir) {
    return { ok: false, message: status().reason, status: status() };
  }
  const match = /^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl.trim());
  if (!match) {
    return { ok: false, message: "That is not an image.", status: status() };
  }
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.byteLength || bytes.byteLength > MAX_REFERENCE_BYTES) {
    return { ok: false, message: "That image is empty or too large.", status: status() };
  }
  try {
    const png = await sharp(bytes).rotate().toColorspace("srgb").png().toBuffer();
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, png);
  } catch {
    return { ok: false, message: "That image could not be read.", status: status() };
  }
  return { ok: true, message: "Your photo is saved. Wardrobe can model clothes on it now.", status: status() };
}

/** Forget the identity photo. Modeled shots — and imports — stop until a new one is added. */
export async function removeIdentityPhoto(): Promise<SetupResult> {
  const target = modelReferencePath();
  if (target) await fs.promises.rm(target, { force: true });
  return { ok: true, message: "Your photo was removed.", status: setupStatus() };
}
