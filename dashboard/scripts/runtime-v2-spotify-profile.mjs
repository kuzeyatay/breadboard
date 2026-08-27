import fs from "node:fs";
import path from "node:path";

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

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32"
    ? path.toNamespacedPath(a).toLowerCase() ===
        path.toNamespacedPath(b).toLowerCase()
    : a === b;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
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
