// The browser extension that makes the agents' browser reachable.
//
// OpenCLI is two halves that only work together: a daemon on the machine, and
// an extension inside a running browser. The CLI installs the daemon, so a
// machine can pass `opencli doctor` on the daemon line and still reach nothing
// — which is exactly what happened. A live Agent Reach run reported ten
// channels closed (reddit, twitter, facebook, instagram, xiaohongshu, xueqiu
// and others) with no credential missing and nothing misconfigured. The half
// that talks to the browser had never been installed, because upstream's only
// documented routes are a Chrome Web Store click and a manual "Load unpacked".
// Neither is something a person should have to discover.
//
// So Breadboard installs it: fetched once, verified against a pinned hash, and
// handed to the browser with --load-extension at launch.
//
// Two properties are deliberate.
//
// It is pinned, not "latest". This code runs unattended on every install, and
// resolving "latest" at runtime means an upstream release could change what
// executes inside a browser holding somebody's logged-in sessions without
// anyone choosing it. The hash below is the release that was read and tested;
// moving to a new one is a two-line edit and a decision someone makes.
//
// It is scoped to the profile Breadboard owns. The extension asks for
// `debugger`, `cookies`, `tabs` and `<all_urls>` — it can act as the signed-in
// user anywhere that browser is signed in, which is the whole point of it and
// also the reason it goes nowhere near the person's real browser. It is loaded
// only into --user-data-dir=<agent-browser-profile>, a separate browser whose
// only accounts are the ones somebody deliberately signed into for the agents.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** The release this code was written against and tested on. */
export const OPENCLI_EXTENSION_VERSION = "1.0.22";

/** The asset, pinned to a tag rather than resolved from "latest". */
export const OPENCLI_EXTENSION_URL =
  "https://github.com/jackwener/OpenCLI/releases/download/v1.8.6/opencli-extension-v1.0.22.zip";

/**
 * SHA-256 of that asset.
 *
 * The whole safety argument rests on this line. Without it, "auto-installs for
 * every user" means every user's browser runs whatever a URL happens to serve.
 */
export const OPENCLI_EXTENSION_SHA256 =
  "9d2e3d053948beab5d97124aa79b1532d2122e33e461eca56cac113afd33207a";

/** Where unpacked extensions live, one directory per version. */
export function openCliExtensionRoot(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.BREADBOARD_DATA_DIR?.trim() || path.join(os.homedir(), ".breadboard");
  return path.join(path.resolve(base), "browser-extensions", "opencli");
}

/** Where this specific version lives. */
export function openCliExtensionDir(
  env: NodeJS.ProcessEnv = process.env,
  version: string = OPENCLI_EXTENSION_VERSION,
): string {
  return path.join(openCliExtensionRoot(env), version);
}

/**
 * The installed extension, or null.
 *
 * Synchronous and cheap on purpose: the launch path calls this, and opening a
 * browser window should never wait on a network round trip. Checks the manifest
 * rather than the directory, so a half-written install reads as absent.
 */
export function installedOpenCliExtension(
  env: NodeJS.ProcessEnv = process.env,
  version: string = OPENCLI_EXTENSION_VERSION,
): { path: string; version: string } | null {
  const dir = openCliExtensionDir(env, version);
  const manifest = path.join(dir, "manifest.json");
  if (!existsSync(manifest)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown };
    const version = typeof parsed.version === "string" ? parsed.version : null;
    if (!version) return null;
    return { path: dir, version };
  } catch {
    // Unreadable or truncated manifest: treat as not installed so the next
    // ensure() replaces it, rather than handing the browser a broken directory.
    return null;
  }
}

/**
 * The flags that load it.
 *
 * Only --load-extension. Chromium also offers --disable-extensions-except,
 * which makes loading more reliable by turning everything else off; that would
 * silently disable anything the person had added to their agents' profile, so
 * it is left out. A live check on Edge 151 confirmed --load-extension alone is
 * enough for the extension to come up and reach the daemon.
 */
export function openCliExtensionArgs(extensionPath: string): string[] {
  return [`--load-extension=${extensionPath}`];
}

export type ExtensionInstall =
  | { status: "present"; path: string; version: string }
  | { status: "installed"; path: string; version: string }
  | { status: "unavailable"; reason: string };

/**
 * Make sure the extension is on disk, fetching it if it is not.
 *
 * Best-effort by contract. Every failure returns `unavailable` with a reason
 * rather than throwing, because the caller's real job is opening a browser
 * window and an offline machine must still get one — without the extension the
 * six login-backed channels stay closed, which is the status quo, whereas a
 * thrown error would take the sign-in window down with it and leave the person
 * no way to fix anything.
 */
export async function ensureOpenCliExtension(options?: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /**
   * The release to install. Defaults to the pinned one; a caller passing
   * something else is a test, since production has exactly one answer here.
   * Injectable so the accept path can be exercised against a built archive
   * instead of the network or a binary committed to the repository.
   */
  release?: { url: string; sha256: string; version: string };
}): Promise<ExtensionInstall> {
  const env = options?.env ?? process.env;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const release = options?.release ?? {
    url: OPENCLI_EXTENSION_URL,
    sha256: OPENCLI_EXTENSION_SHA256,
    version: OPENCLI_EXTENSION_VERSION,
  };

  const already = installedOpenCliExtension(env, release.version);
  if (already) return { status: "present", path: already.path, version: already.version };

  let bytes: Buffer;
  try {
    const response = await fetchImpl(release.url, { signal: options?.signal });
    if (!response.ok) {
      return { status: "unavailable", reason: `download failed with HTTP ${response.status}` };
    }
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { status: "unavailable", reason: `download failed: ${reason}` };
  }

  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== release.sha256) {
    // Refuse rather than warn. This is the one check standing between "we
    // install an extension for every user" and "we run whatever a URL served".
    return {
      status: "unavailable",
      reason: `archive did not match the pinned checksum (expected ${release.sha256.slice(0, 12)}, got ${digest.slice(0, 12)})`,
    };
  }

  const target = openCliExtensionDir(env, release.version);
  const staging = `${target}.incoming-${process.pid}-${Date.now().toString(36)}`;
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    mkdirSync(staging, { recursive: true });

    const archivePath = path.join(staging, "extension.zip");
    writeFileSync(archivePath, bytes);

    const { default: AdmZip } = await import("adm-zip");
    const unpacked = path.join(staging, "unpacked");
    new AdmZip(archivePath).extractAllTo(unpacked, true);

    // Verify what came out of the archive, not just what went in. A zip whose
    // hash matches but whose contents are not this extension should not be
    // handed to a browser.
    const manifestPath = path.join(unpacked, "manifest.json");
    if (!existsSync(manifestPath)) {
      return { status: "unavailable", reason: "archive contained no manifest.json" };
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name?: unknown;
      version?: unknown;
    };
    if (manifest.name !== "OpenCLI" || manifest.version !== release.version) {
      return {
        status: "unavailable",
        reason: `archive contained ${String(manifest.name)} v${String(manifest.version)}, expected OpenCLI v${release.version}`,
      };
    }

    // Publish by rename, so the directory the launch path sees is either
    // absent or complete and never a partial unpack.
    try {
      renameSync(unpacked, target);
    } catch {
      // Another process finished first. Its copy passed the same checks.
      const raced = installedOpenCliExtension(env);
      if (raced) return { status: "present", path: raced.path, version: raced.version };
      throw new Error("could not move the unpacked extension into place");
    }

    return { status: "installed", path: target, version: OPENCLI_EXTENSION_VERSION };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { status: "unavailable", reason: `install failed: ${reason}` };
  } finally {
    try {
      rmSync(staging, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
