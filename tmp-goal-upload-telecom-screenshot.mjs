import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs, { openAsBlob } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encode } from "./dashboard/node_modules/next-auth/jwt/index.js";

const gardenName = "Telecom 1";
const gardenSlug = "telecom-1";
const downloadsDirectory = path.resolve("C:/Users/20252082/Downloads");
const canonicalDataRoot = path.resolve(
  "C:/Users/20252082/AppData/Roaming/breadboard-desktop/Data",
);
const canonicalGardenDir = path.join(
  canonicalDataRoot,
  "quartz",
  "content",
  gardenSlug,
);
const statePath = path.resolve(
  ".tmp-goal-upload-telecom-screenshot-vlm-anydoc-state.json",
);
const supersededStatePath = path.resolve(
  ".tmp-goal-upload-telecom-screenshot-state.json",
);
const backupRoot = path.resolve(
  ".tmp-goal-upload-telecom-screenshot-vlm-anydoc-backup",
);
const parserMode = "vlm+anydoc";
const requestNamespace = "goal-telecom1-screenshot-vlm-anydoc-v1";
let baseUrl =
  process.argv.find((value) => value.startsWith("--base="))?.slice(7) ?? "";
const stopAfterArgument = process.argv
  .find((value) => value.startsWith("--stop-after="))
  ?.slice(13);
const stopAfter = stopAfterArgument === undefined ? null : Number(stopAfterArgument);
if (
  stopAfter !== null &&
  (!Number.isSafeInteger(stopAfter) || stopAfter < 1)
) {
  throw new Error(`Invalid --stop-after value: ${stopAfterArgument}`);
}
const targetIndexesArgument = process.argv
  .find((value) => value.startsWith("--target-indexes="))
  ?.slice(17);
const targetIndexes = targetIndexesArgument === undefined
  ? null
  : targetIndexesArgument.split(",").map((value) => Number(value));
if (
  targetIndexes !== null &&
  (targetIndexes.length === 0 ||
    targetIndexes.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    new Set(targetIndexes).size !== targetIndexes.length)
) {
  throw new Error(`Invalid --target-indexes value: ${targetIndexesArgument}`);
}
const forceTargetIndexesArgument = process.argv
  .find((value) => value.startsWith("--force-target-indexes="))
  ?.slice(23);
const forceTargetIndexes = forceTargetIndexesArgument === undefined
  ? []
  : forceTargetIndexesArgument.split(",").map((value) => Number(value));
if (
  forceTargetIndexes.length > 0 &&
  (forceTargetIndexes.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    new Set(forceTargetIndexes).size !== forceTargetIndexes.length)
) {
  throw new Error(`Invalid --force-target-indexes value: ${forceTargetIndexesArgument}`);
}

const manifest = [
  {
    name: "5XTA0 Study Guide 2026-2027 Q1.pdf",
    bytes: 279464,
    sha256: "0cf326e4ea18defeddb657e3be41054896dce07c645b08c38d1a5705f61dc610",
  },
  {
    name: "5XTA0 Study Guide 2026-2027 Q1-1.pdf",
    bytes: 279464,
    sha256: "0cf326e4ea18defeddb657e3be41054896dce07c645b08c38d1a5705f61dc610",
  },
  {
    name: "digital-communication-933921952x-9789339219529_compress.pdf",
    bytes: 13819826,
    sha256: "6b15951bbbe36ca12b9181ee22ece326170bbc936b5a3dfb03be27d08f846ebc",
  },
  {
    name: "Modern_Digital_and_Analog_Communication.pdf",
    bytes: 8832579,
    sha256: "3809ad318e73b31e7e0170c263d9e10e695e17e58c84551ca08fbd10896067ba",
  },
  {
    name: "Vdocuments_mx_sistemas_de_comunicacion_d.pdf",
    bytes: 7849555,
    sha256: "b2b85faf08640263a638391ef0ba4eab7113c0bab05a57193ffb06a9603d7d9f",
  },
  {
    name: "Suggested Reading.pdf",
    bytes: 202848,
    sha256: "d9047288dcc1118dd73c3010fc2b3847d6e9ee9b299c6ecbc1af00715fc67508",
  },
  {
    name: "Digital and Analog Communication Systems, 8th Ed. (Leon W. Couch, II) (z-library.sk, 1lib.sk, z-lib.sk).pdf",
    bytes: 5827822,
    sha256: "93a6308f0a76fefb4e7028b018349e3dc3816a5b531a57707894de9e74db8c3f",
  },
  {
    name: "From GSM to LTE-Advanced Pro and 5G An Introduction to Mobile Networks and Mobile Broadband 4th Edition (Martin Sauter) (z-library.sk, 1lib.sk, z-lib.sk).pdf",
    bytes: 11405988,
    sha256: "44db1331949f5e73aa6d905bef2bb61bb1947e7e0232338e9e2047a45d0c83b4",
  },
  {
    name: "Wireless Communications From Fundamentals to Beyond 5G (Andreas F. Molisch) (z-library.sk, 1lib.sk, z-lib.sk).pdf",
    bytes: 86908027,
    sha256: "d711565701b2dd79eeb2dedc8298b2e9b69791ed52279b905cba9e9d952672cf",
  },
  {
    name: "Wireless Communications Principles and Practice (2nd Edition) (Theodore S. Rappaport) (z-library.sk, 1lib.sk, z-lib.sk).pdf",
    bytes: 20813862,
    sha256: "89c0bfef62ae5387c917f83a187c1cbff9dce03ea46463e12f9343c1a9acd21c",
  },
  {
    name: "Optical fiber communications (Gerd Keiser) (z-library.sk, 1lib.sk, z-lib.sk).pdf",
    bytes: 37896193,
    sha256: "ae678878fd55f2dd075e80e7f32f8b6c23702f7e4c8976a2cc73dedeff922024",
  },
  {
    name: "Computer Networks A Systems Approach, Fifth Edition (Larry L. Peterson, Bruce S. Davie) (z-library.sk, 1lib.sk, z-lib.sk).pdf",
    bytes: 30267863,
    sha256: "42c0fdc5940a66d315767f8b99d97c57683d9bb8aa7e73b78ac9b575ac5e6f52",
  },
  {
    name: "Computer Networking, A Top-Down Approach (James F Kurose and Keith W Ross) (z-library.sk, 1lib.sk, z-lib.sk).pdf",
    bytes: 9031660,
    sha256: "dca037384f26ebbaff04e54e39078830285a39b6c82f183dcab032d2e36a8a99",
  },
  {
    name: "5G5G-Advanced The New Generation Wireless Access Technology, 3rd ed. (Erik Dahlman, Stefan Parkvall, Johan Sköld) (z-library.sk, 1lib.sk, z-lib.sk).pdf",
    bytes: 56683398,
    sha256: "4c7c2fa4ce2e487c02539cba6af7761f2ff04e42592a6e2e3ac599ccb76310c8",
  },
  {
    name: "Study_guide_5ECE0.pdf",
    bytes: 1069003,
    sha256: "497395d1d29abdb2cdf1222a97b989e722f6a1c747b6b7aa439633b8d48d8684",
  },
  {
    name: "FSheet_17102024.pdf",
    bytes: 916046,
    sha256: "093161bca74a7ce41dd0b95fa7efad05c8707d72d19e6c7b76b3ade6f8113e46",
  },
];

if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(baseUrl)) {
  throw new Error("Usage: --base=http://127.0.0.1:<port>");
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function dashboardProcessBaseUrls() {
  if (process.platform !== "win32") return [];
  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference='Stop'; $dashboards = Get-CimInstance Win32_Process | " +
          "Where-Object { $_.CommandLine -match 'runtime-v2-(?:hot-)?dashboard\\.mjs' }; " +
          "foreach ($dashboard in $dashboards) { " +
          "if ($dashboard.CommandLine -match '--port\\s+(\\d+)') { $Matches[1]; continue }; " +
          "Get-NetTCPConnection -State Listen -OwningProcess $dashboard.ProcessId -ErrorAction SilentlyContinue | " +
          "ForEach-Object { $_.LocalPort } }",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15_000 },
    );
    return output
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter((value) => /^\d+$/u.test(value))
      .map((port) => `http://127.0.0.1:${port}`);
  } catch {
    return [];
  }
}

async function refreshBaseUrl() {
  const candidates = [...new Set([baseUrl, ...dashboardProcessBaseUrls()])];
  for (const candidate of candidates) {
    try {
      const response = await fetch(`${candidate}/api/health`, {
        headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) continue;
      const previous = baseUrl;
      baseUrl = candidate;
      if (baseUrl !== previous) {
        emit("dashboard-recovered", { from: previous, to: baseUrl });
      }
      return baseUrl;
    } catch {
      // A Runtime V2 generation rollover moves the hot dashboard to a new port.
    }
  }
  throw new Error("No healthy Runtime V2 dashboard process is available");
}

async function waitForHealthyDashboard() {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await refreshBaseUrl();
    } catch (error) {
      emit("waiting-for-dashboard", {
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(Math.min(30_000, attempt * 3_000));
    }
  }
}

function apiUrl(pathname) {
  return new URL(pathname, `${baseUrl}/`).toString();
}

function emit(event, detail = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...detail })}\n`);
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/u)
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/u.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator),
          line.slice(separator + 1).replace(/^['"]|['"]$/gu, ""),
        ];
      }),
  );
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function saveState(state) {
  const temporary = `${statePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, statePath);
}

function loadState() {
  if (!fs.existsSync(statePath)) {
    const state = {
      version: 2,
      gardenName,
      gardenSlug,
      requestNamespace,
      parserMode,
      createdAt: new Date().toISOString(),
      targets: manifest.map((item) => ({
        ...item,
        filePath: path.join(downloadsDirectory, item.name),
        stage: "pending",
        attempt: 0,
        requestId: null,
        runtimeJobId: null,
        startedAt: null,
        slug: null,
        displaced: null,
      })),
    };
    saveState(state);
    return state;
  }
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (
    state?.version !== 2 ||
    state?.gardenSlug !== gardenSlug ||
    state?.requestNamespace !== requestNamespace ||
    state?.parserMode !== parserMode ||
    !Array.isArray(state?.targets) ||
    state.targets.length !== manifest.length
  ) {
    throw new Error(`Unexpected upload state in ${statePath}`);
  }
  return state;
}

async function validateManifest(state, targets = state.targets) {
  const expectedNames = new Set(manifest.map((item) => item.name));
  if (expectedNames.size !== manifest.length) {
    throw new Error("The upload manifest contains duplicate filenames");
  }
  for (const target of targets) {
    const expected = manifest.find((item) => item.name === target.name);
    if (!expected) throw new Error(`State contains an unknown file: ${target.name}`);
    const resolved = path.resolve(target.filePath);
    if (
      path.dirname(resolved).toLowerCase() !== downloadsDirectory.toLowerCase() ||
      path.basename(resolved) !== target.name
    ) {
      throw new Error(`Manifest path escapes Downloads: ${target.name}`);
    }
    const stat = fs.statSync(resolved, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new Error(`Manifest file is missing: ${resolved}`);
    if (stat.size !== expected.bytes) throw new Error(`File size changed: ${target.name}`);
    const digest = await sha256File(resolved);
    if (digest !== expected.sha256) throw new Error(`File hash changed: ${target.name}`);
  }
  emit("manifest-validated", { count: targets.length });
}

function verifyGardenIdentity() {
  const database = new DatabaseSync("dashboard/db/brain.db", { readOnly: true });
  try {
    const matches = database
      .prepare("SELECT id, user_id, name, slug FROM clusters WHERE name = ? OR slug = ?")
      .all(gardenName, gardenSlug);
    if (
      matches.length !== 1 ||
      matches[0].name !== gardenName ||
      matches[0].slug !== gardenSlug ||
      Number(matches[0].user_id) !== 1
    ) {
      throw new Error(`Garden identity is ambiguous: ${JSON.stringify(matches)}`);
    }
    emit("garden-validated", { name: matches[0].name, slug: matches[0].slug });
  } finally {
    database.close();
  }
}

async function authenticatedCookie() {
  await waitForHealthyDashboard();
  const env = readEnvFile(path.join("dashboard", ".env.local"));
  const desktopConfigPath = path.join(
    ".runtime",
    "desktop-config",
    "desktop-config.json",
  );
  const desktopConfig = fs.existsSync(desktopConfigPath)
    ? JSON.parse(fs.readFileSync(desktopConfigPath, "utf8"))
    : null;
  const database = new DatabaseSync("dashboard/db/brain.db", { readOnly: true });
  const user = database
    .prepare("SELECT id, username, email FROM users WHERE id = 1")
    .get();
  database.close();
  if (!user) throw new Error("Breadboard user 1 is unavailable");
  const secrets = [env.NEXTAUTH_SECRET, desktopConfig?.nextAuthSecret].filter(
    (secret, index, values) =>
      typeof secret === "string" &&
      secret.trim() &&
      values.indexOf(secret) === index,
  );
  for (const secret of secrets) {
    const token = await encode({
      secret,
      token: {
        id: String(user.id),
        sub: String(user.id),
        name: user.username,
        email: user.email,
      },
      maxAge: 24 * 60 * 60,
    });
    const cookie = `next-auth.session-token=${token}`;
    try {
      const response = await fetch(apiUrl("/api/auth/session"), {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && String(payload?.user?.id ?? "") === "1") return cookie;
    } catch {
      // Try the next locally configured secret.
    }
  }
  throw new Error("No local authentication secret matched the running server");
}

async function fetchJson(url, options = {}, attempts = 240) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const parsedUrl = new URL(url);
      const response = await fetch(apiUrl(`${parsedUrl.pathname}${parsedUrl.search}`), {
        ...options,
        signal: options.signal ?? AbortSignal.timeout(120_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return { response, payload };
      lastError = new Error(`HTTP ${response.status} ${JSON.stringify(payload)}`);
      if (![409, 423, 429, 500, 502, 503, 504].includes(response.status)) {
        throw lastError;
      }
    } catch (error) {
      lastError = error;
    }
    emit("api-retry", {
      url: String(url),
      attempt,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    });
    await refreshBaseUrl().catch(() => undefined);
    await sleep(Math.min(30_000, attempt * 3_000));
  }
  throw lastError;
}

async function documents(cookie) {
  const { payload } = await fetchJson(
    `${baseUrl}/api/documents?clusterSlug=${encodeURIComponent(gardenSlug)}`,
    { headers: { Cookie: cookie, "Cache-Control": "no-cache" } },
  );
  if (!Array.isArray(payload?.documents)) {
    throw new Error(`Document inventory is malformed: ${JSON.stringify(payload)}`);
  }
  return payload.documents;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function frontmatterScalar(content, key) {
  const match = content.match(
    new RegExp(`^${escapeRegExp(key)}:\\s*(?:"([^"]*)"|'([^']*)'|([^\\r\\n]*))\\s*$`, "mu"),
  );
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function frontmatterArray(content, key) {
  const match = content.match(
    new RegExp(`^${escapeRegExp(key)}:\\s*(\\[[^\\r\\n]*\\])\\s*$`, "mu"),
  );
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed)
      ? parsed.filter((value) => typeof value === "string" && value.trim())
      : [];
  } catch {
    return [];
  }
}

function resolveGardenRelative(relativePath) {
  const normalized = String(relativePath ?? "").replace(/\\\\/gu, "/").replace(/^\/+/, "");
  const resolved = path.resolve(canonicalGardenDir, ...normalized.split("/"));
  if (
    resolved !== canonicalGardenDir &&
    !resolved.startsWith(`${canonicalGardenDir}${path.sep}`)
  ) {
    throw new Error(`Garden path escapes Telecom 1: ${relativePath}`);
  }
  return resolved;
}

function sourceNoteFile(source) {
  const relPath = String(source?.relPath ?? "").replace(/\\\\/gu, "/");
  if (!relPath || !relPath.toLowerCase().startsWith("sources/")) {
    throw new Error(`Source note path is invalid for ${source?.sourceFile ?? "unknown"}`);
  }
  const filePath = resolveGardenRelative(relPath);
  if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Source note is missing on disk: ${relPath}`);
  }
  return filePath;
}

function sourceParseMode(source) {
  return frontmatterScalar(fs.readFileSync(sourceNoteFile(source), "utf8"), "parse_mode");
}

function sourceHasRequiredProvenance(source) {
  const content = fs.readFileSync(sourceNoteFile(source), "utf8");
  return (
    frontmatterScalar(content, "parse_mode") === parserMode &&
    frontmatterScalar(content, "extraction_method").includes("+anydoc-") &&
    frontmatterArray(content, "learning_pages").length > 0 &&
    frontmatterArray(content, "topics").length > 0 &&
    content.includes("## Concept coverage") &&
    content.includes("## AnyDoc cross-check")
  );
}

async function matchingSources(cookie, sourceFile) {
  const live = await documents(cookie);
  return live.filter(
    (item) =>
      item?.type === "source-document" &&
      String(item.sourceFile ?? "").toLowerCase() === sourceFile.toLowerCase(),
  );
}

async function matchingSource(cookie, sourceFile) {
  const matches = await matchingSources(cookie, sourceFile);
  const correct = matches.filter((source) => sourceHasRequiredProvenance(source));
  if (correct.length > 1) {
    throw new Error(`Duplicate ${parserMode} sources for ${sourceFile}`);
  }
  return correct[0] ?? null;
}

function markdownFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(filePath);
    }
  };
  visit(root);
  return files;
}

function gardenAssetFromUrl(assetUrl) {
  const prefix = `/${gardenSlug}/assets/`;
  if (!assetUrl.startsWith(prefix)) return null;
  const assetName = assetUrl.slice(prefix.length);
  if (!assetName || assetName !== path.basename(assetName)) {
    throw new Error(`Source asset path escapes Telecom 1: ${assetUrl}`);
  }
  return resolveGardenRelative(`assets/${assetName}`);
}

function backupIdentity(target) {
  return crypto
    .createHash("sha256")
    .update(`${target.name}\0${target.sha256}\0superseded-standard`)
    .digest("hex")
    .slice(0, 24);
}

function planWrongModeDisplacement(target, source) {
  const notePath = sourceNoteFile(source);
  const noteContent = fs.readFileSync(notePath, "utf8");
  const sourceDate = frontmatterScalar(noteContent, "date");
  const sourceSlug = String(source.slug ?? "");
  if (!sourceSlug || !sourceDate) {
    throw new Error(`Cannot safely identify the wrong-mode source ${target.name}`);
  }

  const ownedMarkdown = markdownFiles(canonicalGardenDir).filter((filePath) => {
    const content = fs.readFileSync(filePath, "utf8");
    if (filePath === notePath) return true;
    const sameExactSource = frontmatterScalar(content, "source_file") === target.name;
    const sameGeneratedSource =
      frontmatterScalar(content, "source_document") === sourceSlug &&
      frontmatterScalar(content, "date") === sourceDate;
    return sameExactSource || sameGeneratedSource;
  });
  if (!ownedMarkdown.includes(notePath)) ownedMarkdown.push(notePath);

  const assetPaths = new Set();
  for (const filePath of ownedMarkdown) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const assetUrl of [
      frontmatterScalar(content, "source_pdf"),
      frontmatterScalar(content, "source_media"),
      ...frontmatterArray(content, "source_images"),
    ].filter(Boolean)) {
      const assetPath = gardenAssetFromUrl(assetUrl);
      if (assetPath) assetPaths.add(assetPath);
    }
  }

  const destinationRoot = path.join(backupRoot, backupIdentity(target));
  const entries = [...new Set([...ownedMarkdown, ...assetPaths])].map((original) => {
    if (
      original !== canonicalGardenDir &&
      !original.startsWith(`${canonicalGardenDir}${path.sep}`)
    ) {
      throw new Error(`Replacement plan escaped Telecom 1: ${original}`);
    }
    const relative = path.relative(canonicalGardenDir, original);
    return {
      original,
      backup: path.join(destinationRoot, relative),
      sha256: null,
      moved: false,
    };
  });
  return {
    parserMode: sourceParseMode(source) || "standard",
    sourceSlug,
    sourceDate,
    plannedAt: new Date().toISOString(),
    complete: false,
    entries,
  };
}

async function displaceWrongModeSource(state, target, source) {
  if (!target.displaced) {
    target.displaced = planWrongModeDisplacement(target, source);
    saveState(state);
    emit("wrong-mode-source-planned", {
      filename: target.name,
      priorMode: target.displaced.parserMode,
      entryCount: target.displaced.entries.length,
    });
  }

  for (const entry of target.displaced.entries) {
    if (entry.moved) continue;
    const originalStat = fs.statSync(entry.original, { throwIfNoEntry: false });
    const backupStat = fs.statSync(entry.backup, { throwIfNoEntry: false });
    if (!originalStat?.isFile() && backupStat?.isFile()) {
      entry.sha256 = entry.sha256 ?? (await sha256File(entry.backup));
      entry.moved = true;
      saveState(state);
      continue;
    }
    if (!originalStat?.isFile()) {
      throw new Error(`Wrong-mode artifact vanished before backup: ${entry.original}`);
    }
    fs.mkdirSync(path.dirname(entry.backup), { recursive: true });
    const digest = await sha256File(entry.original);
    if (backupStat?.isFile()) {
      const backupDigest = await sha256File(entry.backup);
      if (backupDigest !== digest) {
        throw new Error(`Backup collision while replacing ${target.name}`);
      }
      fs.unlinkSync(entry.original);
    } else {
      fs.renameSync(entry.original, entry.backup);
    }
    entry.sha256 = digest;
    entry.moved = true;
    saveState(state);
  }
  target.displaced.complete = true;
  target.displaced.completedAt = new Date().toISOString();
  saveState(state);
  emit("wrong-mode-source-backed-up", {
    filename: target.name,
    entryCount: target.displaced.entries.length,
    backupRoot: path.dirname(target.displaced.entries[0]?.backup ?? backupRoot),
  });
}

async function ensureRequiredParserAvailability(cookie) {
  const [vlm, anydoc] = await Promise.all([
    fetchJson(`${baseUrl}/api/vlm-ocr/status`, {
      headers: { Cookie: cookie, "Cache-Control": "no-cache" },
    }),
    fetchJson(`${baseUrl}/api/anydoc/status`, {
      headers: { Cookie: cookie, "Cache-Control": "no-cache" },
    }),
  ]);
  if (vlm.payload?.available !== true) {
    throw new Error(`VLM is unavailable: ${JSON.stringify(vlm.payload)}`);
  }
  if (anydoc.payload?.available !== true) {
    throw new Error(`AnyDoc is unavailable: ${JSON.stringify(anydoc.payload)}`);
  }
  emit("parser-combination-validated", {
    mode: parserMode,
    vlm: true,
    anydoc: true,
  });
}

async function waitForLearnIdle(cookie) {
  const active = new Set(["queued", "running", "starting", "cancelling", "canceling"]);
  for (;;) {
    const { payload } = await fetchJson(
      `${baseUrl}/api/gardens/${gardenSlug}/learn/status`,
      { headers: { Cookie: cookie, "Cache-Control": "no-cache" } },
    );
    const status = String(
      payload?.job?.status ?? payload?.learn?.status ?? payload?.status ?? "unknown",
    ).toLowerCase();
    if (!active.has(status)) {
      emit("learn-idle", { status });
      return;
    }
    emit("waiting-for-learn", { status });
    await sleep(15_000);
  }
}

async function readIngestEvents(response, filename) {
  if (!response.body) throw new Error("Ingest response has no event stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;
  let terminalError = "";
  let lastStep = "";
  const consumeLine = (line) => {
    if (!line.startsWith("data: ")) return;
    const serialized = line.slice(6);
    if (serialized === "[DONE]") return;
    let event;
    try {
      event = JSON.parse(serialized);
    } catch {
      return;
    }
    if (event?.type === "progress" && typeof event.step === "string") {
      if (event.step !== lastStep) {
        lastStep = event.step;
        emit("upload-progress", { filename, step: event.step });
      }
    } else if (event?.type === "result") {
      result = event;
    } else if (event?.type === "error") {
      terminalError = typeof event.error === "string" ? event.error : "Upload failed";
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line.trimEnd());
  }
  buffer += decoder.decode();
  for (const line of buffer.split("\n")) consumeLine(line.trimEnd());
  if (result?.success === true && result?.mapGenerated === true) return result;
  if (result?.success === true) {
    throw new Error(
      result?.mapGenerationWarning ||
        "Upload returned success without a complete generated knowledge map",
    );
  }
  throw new Error(terminalError || "Ingest stream ended without a result");
}

async function lookupIngestJob(cookie, requestId) {
  const response = await fetch(apiUrl("/api/ingest/jobs/lookup"), {
    method: "POST",
    headers: {
      Cookie: cookie,
      "X-Breadboard-Ingest-Cluster-Slug": gardenSlug,
      "X-Breadboard-Ingest-Request-Id": requestId,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload?.jobId !== "string" || typeof payload?.state !== "string") {
    throw new Error(`Ingest lookup failed: HTTP ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitForSupersededStandardJob(cookie) {
  if (!fs.existsSync(supersededStatePath)) return;
  const superseded = JSON.parse(fs.readFileSync(supersededStatePath, "utf8"));
  const active = new Set([
    "queued",
    "starting",
    "running",
    "working",
    "finalizing",
    "cancelling",
    "canceling",
  ]);
  for (const target of superseded?.targets ?? []) {
    if (!target?.requestId) continue;
    for (;;) {
      const prior = await lookupIngestJob(cookie, target.requestId);
      if (!prior || !active.has(String(prior.state).toLowerCase())) {
        emit("superseded-job-terminal", {
          filename: target.name,
          state: prior?.state ?? "not-found",
        });
        break;
      }
      emit("waiting-for-superseded-job", {
        filename: target.name,
        state: prior.state,
      });
      await sleep(10_000);
    }
  }
}

async function reattachIngestJob(cookie, target, jobId) {
  const response = await fetch(
    apiUrl(`/api/ingest/jobs/${encodeURIComponent(jobId)}/events`),
    {
      headers: {
        Cookie: cookie,
        "X-Breadboard-Ingest-Cluster-Slug": gardenSlug,
        "X-Breadboard-Ingest-Started-At": String(target.startedAt ?? Date.now()),
      },
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Ingest recovery stream returned HTTP ${response.status} ${body}`);
  }
  return readIngestEvents(response, target.name);
}

async function ingestBody(target) {
  const body = new FormData();
  body.append("clusterSlug", gardenSlug);
  body.append("file", await openAsBlob(target.filePath, { type: "application/pdf" }), target.name);
  body.append("isHandwriting", "false");
  body.append("parseWithVlm", "true");
  body.append("parseWithAnydoc", "true");
  body.append("generateMap", "true");
  return body;
}

function requestIdentity(target, attempt) {
  // Filename is deliberately part of the identity. Two screenshot entries have
  // identical bytes, and content-hash-only recovery would conflate their jobs.
  const identity = crypto
    .createHash("sha256")
    .update(`${target.name}\0${target.sha256}`)
    .digest("hex")
    .slice(0, 32);
  return `${requestNamespace}-${identity}-${attempt}`;
}

async function completeTarget(state, target, result, event) {
  target.stage = "uploaded";
  target.slug = result.slug ?? null;
  target.requestId = null;
  target.runtimeJobId = null;
  saveState(state);
  emit(event, {
    filename: target.name,
    slug: target.slug,
    duplicate: result.duplicate === true,
  });
}

async function uploadTarget(cookie, state, target, forceReplace = false) {
  let allowExistingSource = true;
  if (forceReplace && target.stage === "uploaded") {
    target.stage = "pending";
    target.requestId = null;
    target.runtimeJobId = null;
    target.startedAt = null;
    target.slug = null;
    target.displaced = null;
    saveState(state);
    emit("forced-target-reset", { filename: target.name });
    allowExistingSource = false;
  }
  for (;;) {
    await validateManifest(state, [target]);
    const existing = await matchingSource(cookie, target.name);
    if (existing) {
      if (!allowExistingSource) {
        throw new Error(`Forced replacement source still exists for ${target.name}`);
      }
      await completeTarget(
        state,
        target,
        { slug: existing.slug, duplicate: true },
        "already-uploaded",
      );
      return;
    }

    const wrongModeSources = (await matchingSources(cookie, target.name)).filter(
      (source) => !sourceHasRequiredProvenance(source),
    );
    if (wrongModeSources.length > 1) {
      throw new Error(`Multiple wrong-mode sources require manual review for ${target.name}`);
    }
    if (!allowExistingSource && wrongModeSources.length > 0) {
      throw new Error(`Forced replacement source still exists for ${target.name}`);
    }
    if (wrongModeSources.length === 1) {
      await displaceWrongModeSource(state, target, wrongModeSources[0]);
      continue;
    }

    if (target.requestId) {
      try {
        const prior = await lookupIngestJob(cookie, target.requestId);
        if (
          prior &&
          ["queued", "starting", "running", "working", "finalizing", "cancelling", "canceling"].includes(prior.state)
        ) {
          target.runtimeJobId = prior.jobId;
          saveState(state);
          emit("upload-reattached", {
            filename: target.name,
            jobId: prior.jobId,
            state: prior.state,
          });
          const result = await reattachIngestJob(cookie, target, prior.jobId);
          await completeTarget(state, target, result, "upload-complete");
          return;
        }
      } catch (error) {
        emit("upload-recovery-error", {
          filename: target.name,
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(10_000);
        continue;
      }
      const appeared = await matchingSource(cookie, target.name);
      if (appeared) continue;
      target.requestId = null;
      target.runtimeJobId = null;
      target.startedAt = null;
      saveState(state);
    }

    target.attempt += 1;
    target.requestId = requestIdentity(target, target.attempt);
    target.startedAt = Date.now();
    allowExistingSource = true;
    saveState(state);
    emit("upload-started", {
      filename: target.name,
      bytes: target.bytes,
      attempt: target.attempt,
      requestId: target.requestId,
    });

    try {
      const response = await fetch(apiUrl("/api/ingest"), {
        method: "POST",
        headers: {
          Cookie: cookie,
          "X-Breadboard-Ingest-Cluster-Slug": gardenSlug,
          "X-Breadboard-Ingest-File-Size": String(target.bytes),
          "X-Breadboard-Ingest-Request-Id": target.requestId,
        },
        body: await ingestBody(target),
      });
      target.runtimeJobId = response.headers.get("X-Breadboard-Runtime-Job-Id");
      saveState(state);
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} ${body}`);
      }
      const result = await readIngestEvents(response, target.name);
      await completeTarget(state, target, result, "upload-complete");
      return;
    } catch (error) {
      emit("upload-attempt-error", {
        filename: target.name,
        attempt: target.attempt,
        error: error instanceof Error ? error.message : String(error),
      });
      await refreshBaseUrl().catch(() => undefined);
      await sleep(Math.min(30_000, target.attempt * 5_000));
    }
  }
}

function sourcePdfFile(source) {
  const sourcePdf = String(source?.sourcePdf ?? "");
  const prefix = `/${gardenSlug}/assets/`;
  if (!sourcePdf.startsWith(prefix)) {
    throw new Error(`Source PDF path is missing or invalid for ${source?.sourceFile ?? "unknown"}`);
  }
  const filename = sourcePdf.slice(prefix.length);
  if (!filename || filename !== path.basename(filename)) {
    throw new Error(`Source PDF path escapes the garden for ${source.sourceFile}`);
  }
  return path.join(canonicalDataRoot, "quartz", "content", gardenSlug, "assets", filename);
}

async function audit(cookie, state, initialSourceFiles, targets = state.targets) {
  await validateManifest(state);
  const live = await documents(cookie);
  const sourceDocuments = live.filter((item) => item?.type === "source-document");
  const manifestNames = new Set(manifest.map((item) => item.name.toLowerCase()));
  const verified = [];
  for (const target of targets) {
    const matches = sourceDocuments.filter(
      (item) => String(item.sourceFile ?? "").toLowerCase() === target.name.toLowerCase(),
    );
    if (matches.length !== 1) {
      throw new Error(`Final audit found ${matches.length} sources for ${target.name}`);
    }
    const { payload: document } = await fetchJson(
      `${baseUrl}/api/documents/${encodeURIComponent(matches[0].slug)}?clusterSlug=${encodeURIComponent(gardenSlug)}`,
      { headers: { Cookie: cookie, "Cache-Control": "no-cache" } },
    );
    const content = String(document?.content ?? "");
    if (!content.startsWith("---\n") || !content.includes(`source_file: ${JSON.stringify(target.name)}`)) {
      throw new Error(`Source frontmatter is incomplete for ${target.name}`);
    }
    if (
      frontmatterScalar(content, "parse_mode") !== parserMode ||
      !frontmatterScalar(content, "extraction_method").includes("+anydoc-") ||
      frontmatterArray(content, "learning_pages").length === 0 ||
      frontmatterArray(content, "topics").length === 0 ||
      !content.includes("## Concept coverage") ||
      !content.includes("## AnyDoc cross-check")
    ) {
      throw new Error(`Required VLM + AnyDoc provenance is missing for ${target.name}`);
    }
    const assetPath = sourcePdfFile(matches[0]);
    const stat = fs.statSync(assetPath, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size !== target.bytes) {
      throw new Error(`Source PDF asset is missing or has the wrong size for ${target.name}`);
    }
    const digest = await sha256File(assetPath);
    if (digest !== target.sha256) {
      throw new Error(`Source PDF asset hash differs for ${target.name}`);
    }
    verified.push({
      filename: target.name,
      slug: matches[0].slug,
      bytes: stat.size,
      sha256: digest,
    });
  }
  const unexpectedNewSourceFiles = sourceDocuments
    .map((item) => String(item.sourceFile ?? ""))
    .filter(Boolean)
    .filter((name) => !initialSourceFiles.has(name.toLowerCase()))
    .filter((name) => !manifestNames.has(name.toLowerCase()));
  if (unexpectedNewSourceFiles.length > 0) {
    throw new Error(
      `Unexpected non-manifest source files appeared: ${unexpectedNewSourceFiles.join(", ")}`,
    );
  }
  emit("audit-complete", {
    garden: gardenName,
    slug: gardenSlug,
    verifiedCount: verified.length,
    verified,
    unexpectedNewSourceFiles,
  });
}

verifyGardenIdentity();
const state = loadState();
const runTargets = targetIndexes === null
  ? state.targets.slice(0, stopAfter ?? state.targets.length)
  : targetIndexes.map((index) => {
      const target = state.targets[index];
      if (!target) throw new Error(`Target index ${index} is outside the manifest`);
      return target;
    });
await validateManifest(state, runTargets);
const cookie = await authenticatedCookie();
await ensureRequiredParserAvailability(cookie);
await waitForSupersededStandardJob(cookie);
await waitForLearnIdle(cookie);
const initialDocuments = await documents(cookie);
const initialSourceFiles = new Set(
  initialDocuments
    .filter((item) => item?.type === "source-document")
    .map((item) => String(item.sourceFile ?? "").toLowerCase())
    .filter(Boolean),
);

for (const target of runTargets) {
  await uploadTarget(
    cookie,
    state,
    target,
    forceTargetIndexes.includes(state.targets.indexOf(target)),
  );
}

await audit(cookie, state, initialSourceFiles, runTargets);
if (targetIndexes !== null) {
  emit("selection-complete", {
    garden: gardenName,
    completedCount: runTargets.length,
    targetIndexes,
  });
} else if (runTargets.length < state.targets.length) {
  emit("stopped-at-boundary", {
    garden: gardenName,
    completedCount: runTargets.length,
    remainingCount: state.targets.length - runTargets.length,
  });
} else {
  emit("all-complete", { garden: gardenName, count: state.targets.length });
}
