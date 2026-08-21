import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const extension = await import("../src/lib/agent-browser/opencli-extension.ts");
const source = (relativePath) =>
  fs
    .readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8")
    .replace(/\r\n/g, "\n");

function scratchEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-opencli-"));
  return { BREADBOARD_DATA_DIR: dir };
}

/** A zip that looks like the release, so the accept path can be exercised. */
async function buildArchive(manifest) {
  const { default: AdmZip } = await import("adm-zip");
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest), "utf8"));
  zip.addFile("popup.html", Buffer.from("<!doctype html>", "utf8"));
  const bytes = zip.toBuffer();
  return { bytes, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

const respondWith = (bytes) => async () =>
  new Response(bytes, { status: 200 });

test("the extension lives beside the account's data, one directory per version", () => {
  const data = path.join(os.tmpdir(), "breadboard-data");
  assert.equal(
    extension.openCliExtensionDir({ BREADBOARD_DATA_DIR: data }),
    path.join(path.resolve(data), "browser-extensions", "opencli", extension.OPENCLI_EXTENSION_VERSION),
  );
  // Versioned, so upgrading installs alongside rather than over a directory a
  // running browser may still have open.
  assert.equal(
    extension.openCliExtensionDir({ BREADBOARD_DATA_DIR: data }, "9.9.9"),
    path.join(path.resolve(data), "browser-extensions", "opencli", "9.9.9"),
  );
  assert.equal(
    extension.openCliExtensionDir({}),
    path.join(os.homedir(), ".breadboard", "browser-extensions", "opencli", extension.OPENCLI_EXTENSION_VERSION),
  );
});

test("an extension is reported installed only once its manifest reads", () => {
  const env = scratchEnv();
  assert.equal(extension.installedOpenCliExtension(env), null);

  const dir = extension.openCliExtensionDir(env);
  fs.mkdirSync(dir, { recursive: true });
  // A directory alone is not an install: an interrupted unpack would leave one.
  assert.equal(extension.installedOpenCliExtension(env), null);

  fs.writeFileSync(path.join(dir, "manifest.json"), "{ truncated", "utf8");
  assert.equal(
    extension.installedOpenCliExtension(env),
    null,
    "a half-written manifest must read as absent so the next ensure replaces it",
  );

  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({ name: "OpenCLI", version: extension.OPENCLI_EXTENSION_VERSION }),
    "utf8",
  );
  assert.deepEqual(extension.installedOpenCliExtension(env), {
    path: dir,
    version: extension.OPENCLI_EXTENSION_VERSION,
  });
});

test("an archive whose checksum does not match the pin is refused", async () => {
  const env = scratchEnv();
  const { bytes } = await buildArchive({ name: "OpenCLI", version: "1.0.22" });

  const result = await extension.ensureOpenCliExtension({
    env,
    fetchImpl: respondWith(bytes),
    release: { url: "https://example.invalid/ext.zip", sha256: "0".repeat(64), version: "1.0.22" },
  });

  assert.equal(result.status, "unavailable");
  assert.match(result.reason, /checksum/);
  assert.equal(
    extension.installedOpenCliExtension(env, "1.0.22"),
    null,
    "nothing may land on disk when the bytes are not the reviewed ones",
  );
});

test("an archive that is not this extension is refused even when the bytes match", async () => {
  const env = scratchEnv();
  // Hash pinned to whatever was served, so only the manifest check can catch it.
  const { bytes, sha256 } = await buildArchive({ name: "Something Else", version: "1.0.22" });

  const result = await extension.ensureOpenCliExtension({
    env,
    fetchImpl: respondWith(bytes),
    release: { url: "https://example.invalid/ext.zip", sha256, version: "1.0.22" },
  });

  assert.equal(result.status, "unavailable");
  assert.match(result.reason, /expected OpenCLI/);
  assert.equal(extension.installedOpenCliExtension(env, "1.0.22"), null);
});

test("a matching archive is unpacked, and a second call reuses it", async () => {
  const env = scratchEnv();
  const { bytes, sha256 } = await buildArchive({ name: "OpenCLI", version: "1.0.22" });
  const release = { url: "https://example.invalid/ext.zip", sha256, version: "1.0.22" };

  const first = await extension.ensureOpenCliExtension({
    env,
    fetchImpl: respondWith(bytes),
    release,
  });
  assert.equal(first.status, "installed");
  assert.ok(fs.existsSync(path.join(first.path, "manifest.json")));
  assert.ok(fs.existsSync(path.join(first.path, "popup.html")));

  // The staging directory must not survive next to the installed one.
  const siblings = fs.readdirSync(path.dirname(first.path));
  assert.deepEqual(siblings, ["1.0.22"]);

  const second = await extension.ensureOpenCliExtension({
    env,
    fetchImpl: async () => assert.fail("an installed extension must not be re-downloaded"),
    release,
  });
  assert.equal(second.status, "present");
  assert.equal(second.path, first.path);
});

test("a download that fails leaves the caller a browser rather than an exception", async () => {
  const env = scratchEnv();

  const offline = await extension.ensureOpenCliExtension({
    env,
    fetchImpl: async () => {
      throw new Error("getaddrinfo ENOTFOUND github.com");
    },
  });
  assert.equal(offline.status, "unavailable");
  assert.match(offline.reason, /ENOTFOUND/);

  const notFound = await extension.ensureOpenCliExtension({
    env,
    fetchImpl: async () => new Response("", { status: 404 }),
  });
  assert.equal(notFound.status, "unavailable");
  assert.match(notFound.reason, /404/);
});

test("the sign-in window loads the extension when it is present, and opens regardless when it is not", () => {
  const launch = source("src/lib/agent-browser/browser-profile.ts");
  assert.match(
    launch,
    /const extension = installedOpenCliExtension\(env\);/,
    "the launch path reads the installed extension synchronously — opening a window must not await a download",
  );
  assert.match(
    launch,
    /\.\.\.\(extension \? openCliExtensionArgs\(extension\.path\) : \[\]\)/,
    "absent must degrade to no flags rather than blocking the launch",
  );

  // Loaded per-launch rather than installed into the profile: the capability
  // exists only while Breadboard's own browser is open.
  assert.equal(
    extension.openCliExtensionArgs("/x/ext").join(" "),
    "--load-extension=/x/ext",
  );
  assert.ok(
    !extension.openCliExtensionArgs("/x/ext").some((arg) => arg.includes("disable-extensions-except")),
    "disabling everything else would silently turn off extensions the person added themselves",
  );
});

test("opening the sign-in browser is what installs the extension", () => {
  const route = source("src/app/api/agent-browser/browser-profile/route.ts");
  const open = route.slice(route.indexOf('action === "open"'), route.indexOf('action === "close"'));
  assert.match(open, /await ensureOpenCliExtension\(\)/);
  assert.ok(
    open.indexOf("ensureOpenCliExtension") < open.indexOf("openSignInWindow"),
    "the fetch has to finish before the window opens, or the first launch misses it",
  );
});

test("the release is pinned rather than resolved at runtime", () => {
  const module = source("src/lib/agent-browser/opencli-extension.ts");
  assert.match(extension.OPENCLI_EXTENSION_SHA256, /^[0-9a-f]{64}$/);
  assert.ok(
    extension.OPENCLI_EXTENSION_URL.includes(`v${extension.OPENCLI_EXTENSION_VERSION}`),
    "the pinned URL and the pinned version must describe the same release",
  );
  assert.ok(
    !/releases\/latest/.test(module),
    "resolving 'latest' would let an upstream release change what runs in a browser holding real sessions",
  );
});

test("a run gets its browser off-screen, not headless", () => {
  const launch = source("src/lib/agent-browser/browser-profile.ts");
  assert.match(
    launch,
    /--window-position=-32000,-32000/,
    "a real window parked off every display is what sites treat normally",
  );
  // Verified live: the extension does connect under --headless=new, and then
  // Reddit answers with a challenge page instead of JSON. Driving a real
  // browser is the entire point of OpenCLI. Checked against the code rather
  // than the file, since the comment explaining this names the flag too.
  const code = launch.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(
    !/--headless/.test(code),
    "headless connects but gets challenged, which defeats the purpose",
  );
  assert.match(
    launch,
    /options\.background\s*$|options\.background\n/m,
    "the off-screen flags must be conditional, so signing in still shows a window",
  );
});

test("a background window is reused, put away, and never taken from a person", () => {
  const launch = source("src/lib/agent-browser/browser-profile.ts");
  const ensure = launch.slice(launch.indexOf("export function ensureBridgeWindow"));
  assert.match(
    ensure,
    /const existing = signInWindow\(env\);\s*\r?\n\s*if \(existing\) return \{ window: existing, opened: false \}/,
    "one process per --user-data-dir, so an open window is always reused",
  );
  assert.match(
    ensure,
    /if \(!installedOpenCliExtension\(env\)\) return \{ window: null, opened: false \}/,
    "a browser with no extension is a window nobody asked for",
  );
  const close = launch.slice(launch.indexOf("export function closeBridgeWindow"));
  assert.match(
    close,
    /if \(!current\?\.background\) return;/,
    "a person's sign-in window must survive a run that borrowed it",
  );

  const runManager = source("src/lib/agent-reach/run-manager.ts");
  assert.match(runManager, /run\.openedBridgeWindow = ensureBridgeWindow\(\)\.opened/);
  assert.match(
    runManager,
    /\.finally\(\(\) => \{\s*\r?\n\s*if \(run\.openedBridgeWindow\) closeBridgeWindow\(\);/,
    "closing has to happen on abort and failure too, not just on success",
  );
});
