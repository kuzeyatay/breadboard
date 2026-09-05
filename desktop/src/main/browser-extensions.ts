import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { atomicWriteFile } from "./runtime-config";

export const BROWSER_EXTENSIONS_STATE_FILE = "browser-extensions.json";
export const BROWSER_EXTENSIONS_DIRECTORY = "browser-extensions";
const MAX_BROWSER_EXTENSIONS = 64;
export const MAX_EXTENSION_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_EXTENSION_UNPACKED_BYTES = 256 * 1024 * 1024;
const MAX_EXTENSION_FILES = 20_000;
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/u;
const CHROME_WEB_STORE_HOST = "chromewebstore.google.com";
const CHROME_WEB_STORE_UPDATE_URL = "https://clients2.google.com/service/update2/crx";

export type BrowserWebStoreInstallState =
  | "available"
  | "installing"
  | "installed"
  | "failed";

interface BrowserExtensionsState {
  version: 1;
  paths: string[];
}

export function normalizeBrowserExtensionPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const candidate of value.slice(0, MAX_BROWSER_EXTENSIONS)) {
    if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 4_096) {
      continue;
    }
    const resolved = path.resolve(candidate);
    if (!path.isAbsolute(resolved)) continue;
    unique.add(resolved);
  }
  return [...unique];
}

export function readBrowserExtensionPaths(configDir: string): string[] {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(configDir, BROWSER_EXTENSIONS_STATE_FILE), "utf8"),
    ) as { paths?: unknown };
    return normalizeBrowserExtensionPaths(parsed.paths);
  } catch {
    return [];
  }
}

export function writeBrowserExtensionPaths(configDir: string, extensionPaths: string[]): void {
  const normalized = normalizeBrowserExtensionPaths(extensionPaths);
  const state: BrowserExtensionsState = { version: 1, paths: normalized };
  atomicWriteFile(
    path.join(configDir, BROWSER_EXTENSIONS_STATE_FILE),
    JSON.stringify(state, null, 2),
  );
}

export function isBrowserExtensionId(value: unknown): value is string {
  return typeof value === "string" && EXTENSION_ID_PATTERN.test(value);
}

/** Read the extension id from a real Chrome Web Store detail page only. */
export function chromeWebStoreExtensionId(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.hostname !== CHROME_WEB_STORE_HOST) return null;
    const match = url.pathname.match(/^\/detail\/(?:[^/]+\/)?([a-p]{32})(?:\/|$)/u);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The narrow custom navigation emitted by the injected store install button. */
export function browserExtensionInstallId(input: string): string | null {
  try {
    const url = new URL(input);
    if (
      url.protocol !== "breadboard-extension:" ||
      url.hostname !== "install" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const id = url.pathname.match(/^\/([a-p]{32})$/u)?.[1];
    return id ?? null;
  } catch {
    return null;
  }
}

/** Chrome's documented Web Store update service, asked for this exact item. */
export function chromeWebStoreDownloadUrl(extensionId: string, chromeVersion: string): string {
  if (!isBrowserExtensionId(extensionId)) throw new Error("Invalid browser extension id.");
  if (!/^\d+(?:\.\d+){0,3}$/u.test(chromeVersion)) {
    throw new Error("Invalid Chromium version.");
  }
  const url = new URL(CHROME_WEB_STORE_UPDATE_URL);
  url.searchParams.set("response", "redirect");
  url.searchParams.set("prodversion", chromeVersion);
  url.searchParams.set("acceptformat", "crx2,crx3");
  url.searchParams.set("x", `id=${extensionId}&uc`);
  return url.toString();
}

/**
 * Add a Breadboard-owned install affordance to a Web Store listing. It lives
 * in a closed shadow root so the store's application CSS cannot disable or
 * restyle it, and it can only emit the validated custom navigation above.
 */
export function browserWebStoreInstallBootstrapScript(
  extensionId: string,
  state: BrowserWebStoreInstallState,
): string {
  if (!isBrowserExtensionId(extensionId)) return "void 0";
  const labels: Record<BrowserWebStoreInstallState, string> = {
    available: "Add to Breadboard",
    installing: "Adding to Breadboard…",
    installed: "Added to Breadboard",
    failed: "Try adding to Breadboard again",
  };
  const label = labels[state];
  const enabled = state === "available" || state === "failed";
  const target = `breadboard-extension://install/${extensionId}`;
  return `(() => {
    const id = "breadboard-web-store-install";
    const cleanupKey = "__breadboardWebStoreInstallCleanup";
    if (typeof window[cleanupKey] === "function") window[cleanupKey]();
    document.getElementById(id)?.remove();
    const host = document.createElement("div");
    host.id = id;
    Object.assign(host.style, {
      all: "initial",
      position: "fixed",
      top: "260px",
      right: "max(28px, calc((100vw - 1072px) / 2))",
      width: "164px",
      height: "42px",
      zIndex: "2147483647"
    });
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = \`button {
      appearance: none;
      width: 100%;
      height: 100%;
      padding: 0 18px;
      border: 1px solid rgba(25, 69, 51, .22);
      border-radius: 21px;
      background: #1f684b;
      color: #fff;
      box-shadow: 0 4px 14px rgba(22, 57, 43, .2);
      font: 600 14px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
    }
    button:hover { background: #18573e; }
    button:focus-visible { outline: 3px solid rgba(31, 104, 75, .3); outline-offset: 3px; }
    button:disabled { background: #e4e9e6; border-color: #d5dcd8; color: #68736d; box-shadow: none; cursor: default; }
    @media (prefers-color-scheme: dark) {
      button:disabled { background: #303733; border-color: #424b46; color: #c2cac5; }
    }\`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = ${JSON.stringify(label)};
    button.disabled = ${enabled ? "false" : "true"};
    button.setAttribute("aria-label", ${JSON.stringify(label)});
    button.addEventListener("click", () => {
      button.disabled = true;
      button.textContent = "Adding to Breadboard…";
      location.href = ${JSON.stringify(target)};
    });
    root.append(style, button);
    document.documentElement.appendChild(host);
    const findChromeButton = () => {
      const roots = [document];
      for (let index = 0; index < roots.length; index += 1) {
        const current = roots[index];
        for (const element of current.querySelectorAll("*")) {
          if (element.shadowRoot) roots.push(element.shadowRoot);
        }
        for (const candidate of current.querySelectorAll("button[disabled]")) {
          if (/chrome/i.test(candidate.textContent || "")) return candidate;
        }
      }
      return null;
    };
    const place = () => {
      const nativeButton = findChromeButton();
      if (!nativeButton) return;
      const rect = nativeButton.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 28) return;
      host.style.left = rect.left + "px";
      host.style.top = rect.top + "px";
      host.style.right = "auto";
      host.style.width = rect.width + "px";
      host.style.height = rect.height + "px";
    };
    let placementFrame = 0;
    const schedulePlace = () => {
      if (placementFrame) return;
      placementFrame = requestAnimationFrame(() => {
        placementFrame = 0;
        place();
      });
    };
    const observer = new MutationObserver(schedulePlace);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setInterval(schedulePlace, 500);
    const stopTimer = setTimeout(() => clearInterval(timer), 15000);
    addEventListener("resize", schedulePlace);
    addEventListener("scroll", schedulePlace, true);
    window[cleanupKey] = () => {
      observer.disconnect();
      clearInterval(timer);
      clearTimeout(stopTimer);
      if (placementFrame) cancelAnimationFrame(placementFrame);
      removeEventListener("resize", schedulePlace);
      removeEventListener("scroll", schedulePlace, true);
    };
    place();
  })()`;
}

export function browserWebStoreInstallCleanupScript(): string {
  return `(() => {
    const cleanup = window.__breadboardWebStoreInstallCleanup;
    if (typeof cleanup === "function") cleanup();
    delete window.__breadboardWebStoreInstallCleanup;
    document.getElementById("breadboard-web-store-install")?.remove();
  })()`;
}

function extensionIdFromBytes(bytes: Buffer): string {
  let id = "";
  for (const byte of bytes.subarray(0, 16)) {
    id += String.fromCharCode(97 + (byte >>> 4), 97 + (byte & 0x0f));
  }
  return id;
}

export function chromeExtensionIdFromPublicKey(publicKey: Buffer): string {
  return extensionIdFromBytes(createHash("sha256").update(publicKey).digest());
}

interface ProtoField {
  number: number;
  bytes: Buffer;
}

function readProtoVarint(buffer: Buffer, start: number): { value: number; next: number } {
  let value = 0;
  let multiplier = 1;
  for (let offset = start; offset < buffer.length && offset < start + 10; offset += 1) {
    const byte = buffer[offset];
    if (byte === undefined) break;
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) throw new Error("Invalid CRX protobuf integer.");
    if ((byte & 0x80) === 0) return { value, next: offset + 1 };
    multiplier *= 128;
  }
  throw new Error("Truncated CRX protobuf integer.");
}

function protoLengthDelimitedFields(buffer: Buffer): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readProtoVarint(buffer, offset);
    offset = tag.next;
    const fieldNumber = Math.floor(tag.value / 8);
    const wireType = tag.value & 7;
    if (fieldNumber <= 0) throw new Error("Invalid CRX protobuf field.");
    if (wireType === 2) {
      const length = readProtoVarint(buffer, offset);
      offset = length.next;
      const end = offset + length.value;
      if (end > buffer.length) throw new Error("Truncated CRX protobuf field.");
      fields.push({ number: fieldNumber, bytes: buffer.subarray(offset, end) });
      offset = end;
    } else if (wireType === 0) {
      offset = readProtoVarint(buffer, offset).next;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      throw new Error("Unsupported CRX protobuf field.");
    }
    if (offset > buffer.length) throw new Error("Truncated CRX protobuf field.");
  }
  return fields;
}

function crxPayload(
  archive: Buffer,
  expectedExtensionId: string,
): { zip: Buffer; publicKey: Buffer } {
  if (archive.length > MAX_EXTENSION_ARCHIVE_BYTES) {
    throw new Error("The browser extension package is too large.");
  }
  if (archive.length < 16 || archive.subarray(0, 4).toString("ascii") !== "Cr24") {
    throw new Error("The Web Store returned an invalid CRX package.");
  }
  const version = archive.readUInt32LE(4);
  let zipOffset = 0;
  let publicKey: Buffer | undefined;
  if (version === 2) {
    const publicKeyLength = archive.readUInt32LE(8);
    const signatureLength = archive.readUInt32LE(12);
    zipOffset = 16 + publicKeyLength + signatureLength;
    if (publicKeyLength === 0 || signatureLength === 0 || zipOffset > archive.length) {
      throw new Error("The Web Store returned a truncated CRX2 package.");
    }
    publicKey = archive.subarray(16, 16 + publicKeyLength);
  } else if (version === 3) {
    const headerLength = archive.readUInt32LE(8);
    zipOffset = 12 + headerLength;
    if (headerLength === 0 || zipOffset > archive.length) {
      throw new Error("The Web Store returned a truncated CRX3 package.");
    }
    const header = archive.subarray(12, zipOffset);
    const proofs = protoLengthDelimitedFields(header)
      .filter((field) => field.number === 2 || field.number === 3)
      .flatMap((field) =>
        protoLengthDelimitedFields(field.bytes)
          .filter((nested) => nested.number === 1)
          .map((nested) => nested.bytes),
      );
    publicKey = proofs.find(
      (candidate) => chromeExtensionIdFromPublicKey(candidate) === expectedExtensionId,
    );
    if (!publicKey) throw new Error("The CRX3 signing key does not match this Web Store item.");
  } else {
    throw new Error(`Unsupported CRX version ${version}.`);
  }
  if (chromeExtensionIdFromPublicKey(publicKey) !== expectedExtensionId) {
    throw new Error("The CRX signing key does not match this Web Store item.");
  }
  const zip = archive.subarray(zipOffset);
  if (zip.length < 4 || zip.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("The CRX package has no ZIP payload.");
  }
  return { zip, publicKey };
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) {
    const tableValue = CRC32_TABLE[(value ^ byte) & 0xff];
    if (tableValue === undefined) throw new Error("CRC table is incomplete.");
    value = tableValue ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zipEndOfCentralDirectory(zip: Buffer): number {
  const minimum = Math.max(0, zip.length - 22 - 0xffff);
  for (let offset = zip.length - 22; offset >= minimum; offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("The extension ZIP directory is missing.");
}

function safeZipRelativePath(rawName: Buffer, utf8: boolean): string {
  const name = utf8
    ? new TextDecoder("utf-8", { fatal: true }).decode(rawName)
    : rawName.toString("ascii");
  const normalized = name.replace(/\\/gu, "/");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[a-z]:/iu.test(normalized)
  ) {
    throw new Error("The extension ZIP contains an unsafe path.");
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("The extension ZIP contains an unsafe path.");
  }
  return segments.join(path.sep);
}

function unpackZip(zip: Buffer, destination: string): void {
  const eocd = zipEndOfCentralDirectory(zip);
  const disk = zip.readUInt16LE(eocd + 4);
  const centralDisk = zip.readUInt16LE(eocd + 6);
  const entriesOnDisk = zip.readUInt16LE(eocd + 8);
  const entryCount = zip.readUInt16LE(eocd + 10);
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount > MAX_EXTENSION_FILES ||
    centralOffset + centralSize > eocd
  ) {
    throw new Error("The extension ZIP directory is unsupported.");
  }
  const destinationRoot = path.resolve(destination);
  const seen = new Set<string>();
  let totalUnpacked = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("The extension ZIP directory is truncated.");
    }
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const expectedCrc = zip.readUInt32LE(offset + 16);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const unpackedSize = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const externalAttributes = zip.readUInt32LE(offset + 38);
    const localOffset = zip.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > zip.length) throw new Error("The extension ZIP entry is truncated.");
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8)) {
      throw new Error("The extension ZIP uses an unsupported encoding.");
    }
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0o170000) === 0o120000) {
      throw new Error("The extension ZIP contains a symbolic link.");
    }
    const rawName = zip.subarray(offset + 46, offset + 46 + nameLength);
    const relative = safeZipRelativePath(rawName, (flags & 0x0800) !== 0);
    const duplicateKey = process.platform === "win32" ? relative.toLocaleLowerCase("en-US") : relative;
    if (seen.has(duplicateKey)) throw new Error("The extension ZIP contains duplicate paths.");
    seen.add(duplicateKey);
    const target = path.resolve(destinationRoot, relative);
    if (target !== destinationRoot && !target.startsWith(`${destinationRoot}${path.sep}`)) {
      throw new Error("The extension ZIP contains an unsafe path.");
    }
    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("The extension ZIP local entry is truncated.");
    }
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const localName = zip.subarray(localOffset + 30, localOffset + 30 + localNameLength);
    if (!localName.equals(rawName)) throw new Error("The extension ZIP entry names disagree.");
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zip.length) throw new Error("The extension ZIP data is truncated.");
    const isDirectory = rawName.at(-1) === 0x2f || rawName.at(-1) === 0x5c;
    if (isDirectory) {
      fs.mkdirSync(target, { recursive: true });
      offset = next;
      continue;
    }
    totalUnpacked += unpackedSize;
    if (totalUnpacked > MAX_EXTENSION_UNPACKED_BYTES) {
      throw new Error("The unpacked browser extension is too large.");
    }
    const compressed = zip.subarray(dataStart, dataEnd);
    const contents = method === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: unpackedSize });
    if (contents.length !== unpackedSize || crc32(contents) !== expectedCrc) {
      throw new Error("The extension ZIP entry failed its integrity check.");
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, { flag: "wx" });
    offset = next;
  }
  if (offset !== centralOffset + centralSize) {
    throw new Error("The extension ZIP directory size is inconsistent.");
  }
}

/**
 * Verify, safely unpack and stage a Web Store CRX as the durable unpacked
 * directory Electron requires. No network access happens in this helper.
 */
export function installChromeWebStorePackage(
  configDir: string,
  extensionId: string,
  archive: Buffer,
): string {
  if (!isBrowserExtensionId(extensionId)) throw new Error("Invalid browser extension id.");
  const { zip, publicKey } = crxPayload(archive, extensionId);
  const root = path.join(configDir, BROWSER_EXTENSIONS_DIRECTORY);
  fs.mkdirSync(root, { recursive: true });
  const staging = fs.mkdtempSync(path.join(root, `.${extensionId}-`));
  const installed = path.join(root, extensionId);
  let moved = false;
  try {
    unpackZip(zip, staging);
    const manifestPath = path.join(staging, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
    const manifestRecord = manifest as Record<string, unknown>;
    if (
      !manifest ||
      typeof manifest !== "object" ||
      Array.isArray(manifest) ||
      (manifestRecord.manifest_version !== 2 && manifestRecord.manifest_version !== 3) ||
      typeof manifestRecord.name !== "string" ||
      typeof manifestRecord.version !== "string"
    ) {
      throw new Error("The browser extension manifest is invalid.");
    }
    manifestRecord.key = publicKey.toString("base64");
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.rmSync(installed, { recursive: true, force: true });
    fs.renameSync(staging, installed);
    moved = true;
    return installed;
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (moved) fs.rmSync(installed, { recursive: true, force: true });
    throw error;
  }
}
