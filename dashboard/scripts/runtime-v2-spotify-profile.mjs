import { sameRuntimePath as samePath, runtimePathWithin as pathWithin } from "./runtime-v2-paths.mjs";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const STRANDED_PROFILE_AGE_MS = 24 * 60 * 60 * 1_000;

function invalidProfile(message) {
  throw Object.assign(new Error(message), {
    status: 500,
    code: "invalid_spotify_playback_configuration",
  });
}

function filesystemError(error, code) {
  return (
    error !== null &&
    typeof error === "object" &&
    error.code === code
  );
}

/**
 * Create each profile segment without ever accepting a link as the winner.
 * `makeDirectory` is injectable solely so the EEXIST race can be reproduced
 * deterministically in a focused test.
 */
export function ensureDirectSpotifyProfile(
  root,
  segments,
  { makeDirectory = (candidate) => fs.mkdirSync(candidate, { recursive: false }) } = {},
) {
  let current = root;
  for (const segment of segments) {
    const candidate = path.join(current, segment);
    if (!pathWithin(root, candidate)) {
      invalidProfile("The Spotify playback profile escaped its data root.");
    }

    const existing = fs.lstatSync(candidate, { throwIfNoEntry: false });
    if (!existing) {
      try {
        makeDirectory(candidate);
      } catch (error) {
        // A concurrent creator may legitimately win. It receives no trust from
        // EEXIST: the entry is re-read and fully validated below.
        if (!filesystemError(error, "EEXIST")) throw error;
      }
    }

    const metadata = fs.lstatSync(candidate, { throwIfNoEntry: false });
    if (
      !metadata ||
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      !samePath(fs.realpathSync.native(candidate), candidate)
    ) {
      invalidProfile("The Spotify playback profile is indirect.");
    }
    current = candidate;
  }
  return current;
}

/**
 * Windows can restore a headless browser outside Runtime's process tree after
 * a reboot. Chromium's singleton lock then makes launches against a reused
 * profile exit immediately. Authentication comes from the local player bridge,
 * so no browser cookies need to survive between playback sessions.
 */
export function createSpotifySessionProfile(root, userId) {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    invalidProfile("The Spotify playback user scope is invalid.");
  }
  const directory = ensureDirectSpotifyProfile(root, [
    "database",
    "spotify-browser-player",
    `user-${userId}`,
    `session-${randomUUID()}`,
  ]);
  // A failed cleanup (a browser still holding files) strands its profile, about
  // 75 MB each. A day-old sibling is stranded; a newer one may still be running.
  const parent = path.dirname(directory);
  for (const entry of fs.readdirSync(parent)) {
    if (!/^session-[0-9a-f-]{36}$/u.test(entry)) continue;
    const sibling = path.join(parent, entry);
    if (Date.now() - fs.statSync(sibling).mtimeMs < STRANDED_PROFILE_AGE_MS) continue;
    void fs.promises.rm(sibling, { recursive: true, force: true }).catch(() => undefined);
  }
  return {
    directory,
    async cleanup() {
      const metadata = fs.lstatSync(directory, { throwIfNoEntry: false });
      if (!metadata) return;
      if (
        !pathWithin(root, directory) ||
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        !samePath(fs.realpathSync.native(directory), directory)
      ) {
        invalidProfile("The Spotify playback profile is indirect.");
      }
      await fs.promises.rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 200,
      });
    },
  };
}
