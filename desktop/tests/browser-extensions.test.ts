import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import type { ClientRequest, ClientRequestConstructorOptions } from "electron";
import { runElectronFixture } from "./helpers/run-electron-fixture";
import {
  BROWSER_EXTENSIONS_STATE_FILE,
  MAX_EXTENSION_ARCHIVE_BYTES,
  browserExtensionInstallId,
  browserWebStoreInstallBootstrapScript,
  browserWebStoreInstallCleanupScript,
  chromeExtensionIdFromPublicKey,
  chromeWebStoreDownloadUrl,
  chromeWebStoreExtensionId,
  downloadChromeWebStorePackage,
  installChromeWebStorePackage,
  normalizeBrowserExtensionPaths,
  readBrowserExtensionPaths,
  writeBrowserExtensionPaths,
} from "../src/main/browser-extensions";

class DownloadRequest extends EventEmitter {
  aborted = false;
  followed = 0;
  setHeader() {}
  end() {}
  abort() { this.aborted = true; this.emit("abort"); this.emit("close"); }
  followRedirect() { this.followed += 1; }
}

function startDownload() {
  const request = new DownloadRequest();
  const promise = downloadChromeWebStorePackage("a".repeat(32), "130.0.0.0", (options: ClientRequestConstructorOptions) => {
    assert.equal(options.redirect, "manual");
    return request as unknown as ClientRequest;
  });
  const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} as Record<string, string[]> });
  return { request, response, promise };
}

test("Web Store downloads follow HTTPS redirects without relying on a fetch response URL", async () => {
  const { request, response, promise } = startDownload();
  request.emit("redirect", 302, "GET", "https://clients2.googleusercontent.com/package.crx", {});
  assert.equal(request.followed, 1);
  request.emit("close"); // Electron 33 closes the writable side before the response arrives.
  request.emit("response", response);
  response.emit("data", Buffer.from("Cr24"));
  response.emit("data", Buffer.from("payload"));
  response.emit("end");
  request.emit("close");
  assert.equal((await promise).toString(), "Cr24payload");
  assert.equal(request.aborted, false);
});

test("unsafe redirects are aborted before they are followed", async () => {
  for (const url of ["http://example.com/item.crx", "file:///private/item.crx", "https://user:pass@example.com/item.crx", "invalid URL"]) {
    const { request, promise } = startDownload();
    request.emit("redirect", 302, "GET", url, {});
    await assert.rejects(promise);
    assert.equal(request.followed, 0, url);
    assert.equal(request.aborted, true, url);
  }
});

test("failed, interrupted, looping and oversized downloads settle with an error", async () => {
  for (const failure of ["http", "network", "interrupted", "cancelled", "declared-size", "streamed-size", "redirect-loop"]) {
    const { request, response, promise } = startDownload();
    if (failure === "http") response.statusCode = 404;
    if (failure === "declared-size") response.headers["content-length"] = [String(MAX_EXTENSION_ARCHIVE_BYTES + 1)];
    if (failure === "network") request.emit("error", new Error("Connection failed"));
    if (failure === "cancelled") request.emit("abort");
    if (failure === "redirect-loop") {
      for (let i = 0; i < 11; i += 1) request.emit("redirect", 302, "GET", "https://example.com/loop", {});
      assert.equal(request.followed, 10);
    }
    request.emit("response", response);
    if (failure === "interrupted") response.emit("aborted");
    if (failure === "streamed-size") {
      const chunk = Buffer.alloc(1024 * 1024);
      for (let i = 0; i < 101; i += 1) response.emit("data", chunk);
    }
    await assert.rejects(promise, /HTTP 404|Connection failed|interrupted|cancelled|too large|too many times/, failure);
    assert.equal(request.aborted, true, failure);
  }
});

test("a stalled download times out so the button can be retried", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { request, promise } = startDownload();
  t.mock.timers.tick(60_000);
  await assert.rejects(promise, /timed out/);
  assert.equal(request.aborted, true);
});

function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zip(entries: Array<{ name: string; contents: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.contents);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.contents.length, 18);
    local.writeUInt32LE(entry.contents.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, entry.contents);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.contents.length, 20);
    central.writeUInt32LE(entry.contents.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(central, name);
    localOffset += local.length + name.length + entry.contents.length;
  }
  const localBytes = Buffer.concat(locals);
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(localBytes.length, 16);
  return Buffer.concat([localBytes, centralBytes, end]);
}

function crx2(publicKey: Buffer, payload: Buffer): Buffer {
  const header = Buffer.alloc(16);
  header.write("Cr24", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(publicKey.length, 8);
  header.writeUInt32LE(1, 12);
  return Buffer.concat([header, publicKey, Buffer.from([1]), payload]);
}

test("browser extension paths are durable, bounded and deduplicated", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-extensions-"));
  try {
    const first = path.join(fixture, "first");
    const second = path.join(fixture, "second");
    writeBrowserExtensionPaths(fixture, [first, first, second]);
    assert.deepEqual(readBrowserExtensionPaths(fixture), [first, second]);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(fixture, BROWSER_EXTENSIONS_STATE_FILE), "utf8")),
      { version: 1, paths: [first, second] },
    );
    assert.deepEqual(normalizeBrowserExtensionPaths([null, 4, "", first]), [first]);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("an unreadable browser extension record starts empty", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-extensions-"));
  try {
    fs.writeFileSync(path.join(fixture, BROWSER_EXTENSIONS_STATE_FILE), "not json");
    assert.deepEqual(readBrowserExtensionPaths(fixture), []);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("Chrome Web Store and install navigation ids are exact and narrow", () => {
  const id = "ildkmabpimmkaediidaifkhjpohdnifk";
  assert.equal(
    chromeWebStoreExtensionId(`https://chromewebstore.google.com/detail/opencli/${id}`),
    id,
  );
  assert.equal(chromeWebStoreExtensionId(`https://chromewebstore.google.com/detail/${id}`), id);
  assert.equal(chromeWebStoreExtensionId(`https://chromewebstore.google.com.evil.test/detail/x/${id}`), null);
  assert.equal(chromeWebStoreExtensionId(`https://example.com/detail/x/${id}`), null);
  assert.equal(browserExtensionInstallId(`breadboard-extension://install/${id}`), id);
  assert.equal(browserExtensionInstallId(`breadboard-extension://install/${id}?again=1`), null);
  assert.equal(browserExtensionInstallId(`breadboard-extension://remove/${id}`), null);

  const download = new URL(chromeWebStoreDownloadUrl(id, "128.0.6613.186"));
  assert.equal(download.origin + download.pathname, "https://clients2.google.com/service/update2/crx");
  assert.equal(download.searchParams.get("response"), "redirect");
  assert.equal(download.searchParams.get("prodversion"), "128.0.6613.186");
  assert.equal(download.searchParams.get("x"), `id=${id}&uc`);
});

test("the Web Store page gets a direct Breadboard install control", () => {
  const id = "ildkmabpimmkaediidaifkhjpohdnifk";
  const available = browserWebStoreInstallBootstrapScript(id, "available");
  assert.match(available, /Add to Breadboard/);
  assert.match(available, new RegExp(`breadboard-extension:\\/\\/install\\/${id}`));
  assert.match(available, /attachShadow\(\{ mode: "closed" \}\)/);
  assert.match(browserWebStoreInstallBootstrapScript(id, "installed"), /Added to Breadboard/);
  assert.match(browserWebStoreInstallCleanupScript(), /breadboard-web-store-install/);
});

test("a signed Web Store package is unpacked durably with a stable extension id", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-web-store-"));
  try {
    const publicKey = Buffer.from("fixture-public-key");
    const id = chromeExtensionIdFromPublicKey(publicKey);
    const manifest = Buffer.from(JSON.stringify({
      manifest_version: 3,
      name: "Fixture extension",
      version: "1.2.3",
    }));
    const archive = crx2(publicKey, zip([
      { name: "manifest.json", contents: manifest },
      { name: "scripts/content.js", contents: Buffer.from("void 0;") },
    ]));
    const installed = installChromeWebStorePackage(fixture, id, archive);
    assert.equal(installed, path.join(fixture, "browser-extensions", id));
    assert.equal(fs.readFileSync(path.join(installed, "scripts", "content.js"), "utf8"), "void 0;");
    const installedManifest = JSON.parse(fs.readFileSync(path.join(installed, "manifest.json"), "utf8"));
    assert.equal(installedManifest.key, publicKey.toString("base64"));
    assert.throws(
      () => installChromeWebStorePackage(fixture, "a".repeat(32), archive),
      /signing key does not match/,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("Web Store packages cannot write outside their managed extension directory", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-web-store-slip-"));
  try {
    const publicKey = Buffer.from("another-fixture-public-key");
    const id = chromeExtensionIdFromPublicKey(publicKey);
    const archive = crx2(publicKey, zip([
      { name: "../outside.txt", contents: Buffer.from("no") },
    ]));
    assert.throws(
      () => installChromeWebStorePackage(fixture, id, archive),
      /unsafe path/,
    );
    assert.equal(fs.existsSync(path.join(fixture, "outside.txt")), false);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("the Web Store button retries a failed download, installs and restores an extension in Electron", async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-web-store-install-"));
  const publicKey = Buffer.from("web-store-integration-fixture");
  const id = chromeExtensionIdFromPublicKey(publicKey);
  const archive = crx2(publicKey, zip([
    { name: "manifest.json", contents: Buffer.from(JSON.stringify({ manifest_version: 3, name: "Install fixture", version: "1.0" })) },
  ]));
  fs.writeFileSync(path.join(dir, "package.crx"), archive);
  fs.writeFileSync(path.join(dir, "extension-id.txt"), id);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TEST_CONTEXT;
  try {
    const result = await runElectronFixture(require("electron") as string, [path.join(desktop, "tests/fixtures/browser-extensions.cjs"), dir], desktop, env, 60_000);
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.output}`);
    assert.equal(result.status, 0, result.output);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
