import crypto from "node:crypto";
import fs, { openAsBlob } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encode } from "./dashboard/node_modules/next-auth/jwt/index.js";

const gardenSlug = "electromagnetism-1";
const preservedBookSlug =
  "engineering-electromagnetics-9th-ed-9nbsped-compress";
const downloadsDirectory = "C:/Users/20252082/Downloads";
const contentRoot = path.join(
  process.env.APPDATA ?? "",
  "breadboard-desktop",
  "Data",
  "quartz",
  "content",
);
const gardenDirectory = path.resolve(contentRoot, gardenSlug);
const learnLockPath = path.join(
  contentRoot,
  ".electromagnetism-1.learn-build.lock.json",
);
const statePath = path.resolve(".tmp-goal-reupload-pdfs-state.json");
const baseUrl =
  process.argv.find((value) => value.startsWith("--base="))?.slice(7) ?? "";
const phase =
  process.argv.find((value) => value.startsWith("--phase="))?.slice(8) ??
  "all";
const validPhases = new Set(["inventory", "delete", "upload", "audit", "all"]);
const activeLearnStates = new Set([
  "queued",
  "running",
  "starting",
  "cancelling",
  "canceling",
]);
const failedIngestStates = new Set([
  "cancelled",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

if (!baseUrl || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(baseUrl)) {
  throw new Error("Usage: --base=http://127.0.0.1:<port> [--phase=all]");
}
if (!validPhases.has(phase)) throw new Error(`Unsupported phase: ${phase}`);

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

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

async function authenticatedCookie() {
  const env = readEnvFile(path.join("dashboard", ".env.local"));
  const configPath = path.join(
    ".runtime",
    "desktop-config",
    "desktop-config.json",
  );
  const desktopConfig = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8"))
    : null;
  const database = new DatabaseSync("dashboard/db/brain.db", {
    readOnly: true,
  });
  const user = database
    .prepare("SELECT id, username, email FROM users WHERE id = 1")
    .get();
  database.close();
  if (!user) throw new Error("Breadboard user 1 is unavailable.");
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
    const response = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && String(payload?.user?.id ?? "") === "1") return cookie;
  }
  throw new Error("No local authentication secret matched the running server.");
}

async function sha256(filePath) {
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
  if (!fs.existsSync(statePath)) return null;
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (state?.version !== 1 || state?.gardenSlug !== gardenSlug) {
    throw new Error(`Unexpected re-upload state in ${statePath}.`);
  }
  return state;
}

async function fetchJson(url, options = {}, attempts = 8) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal ?? AbortSignal.timeout(120_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return { response, payload };
      lastError = new Error(
        `HTTP ${response.status} ${JSON.stringify(payload)}`,
      );
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

async function documentDetail(cookie, slug) {
  const { payload } = await fetchJson(
    `${baseUrl}/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(gardenSlug)}`,
    { headers: { Cookie: cookie, "Cache-Control": "no-cache" } },
  );
  if (payload?.success !== true || typeof payload?.content !== "string") {
    throw new Error(`Document detail is malformed for ${slug}.`);
  }
  return payload;
}

function isPdfSource(document) {
  return (
    document?.type === "source-document" &&
    (String(document.sourceFile ?? "").toLowerCase().endsWith(".pdf") ||
      String(document.sourcePdf ?? "").trim().length > 0)
  );
}

function assetPathFromUrl(assetUrl) {
  const normalized = String(assetUrl ?? "").split(/[?#]/u, 1)[0];
  const prefix = `/${gardenSlug}/`;
  if (!normalized.startsWith(prefix)) {
    throw new Error(`Unexpected garden asset URL: ${assetUrl}`);
  }
  const relative = normalized.slice(prefix.length).replaceAll("/", path.sep);
  const resolved = path.resolve(gardenDirectory, relative);
  if (!resolved.startsWith(`${gardenDirectory}${path.sep}`)) {
    throw new Error(`Garden asset escapes its directory: ${assetUrl}`);
  }
  return resolved;
}

function frontmatterValue(content, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^${escaped}:\\s*(.*?)\\s*$`, "mu").exec(content);
  return (match?.[1] ?? "").trim().replace(/^['"]|['"]$/gu, "");
}

function learnState(payload) {
  return String(
    payload?.job?.status ??
      payload?.learn?.status ??
      payload?.status ??
      "unknown",
  ).toLowerCase();
}

async function assertLearnHalted(cookie) {
  const { payload } = await fetchJson(
    `${baseUrl}/api/gardens/${gardenSlug}/learn/status`,
    { headers: { Cookie: cookie, "Cache-Control": "no-cache" } },
  );
  const status = learnState(payload);
  if (activeLearnStates.has(status)) {
    throw new Error(`Learn is still active (${status}); refusing source mutation.`);
  }
  emit("learn-halted", { status });
  return status;
}

async function waitForLearnLock() {
  let lastNotice = 0;
  while (fs.existsSync(learnLockPath)) {
    const now = Date.now();
    if (now - lastNotice > 30_000) {
      emit("waiting-for-learn-lock", { path: learnLockPath });
      lastNotice = now;
    }
    await sleep(5_000);
  }
}

async function assertReadersAvailable(cookie) {
  const [vlm, anydoc] = await Promise.all([
    fetchJson(`${baseUrl}/api/vlm-ocr/status`, {
      headers: { Cookie: cookie, "Cache-Control": "no-cache" },
    }),
    fetchJson(`${baseUrl}/api/anydoc/status`, {
      headers: { Cookie: cookie, "Cache-Control": "no-cache" },
    }),
  ]);
  if (vlm.payload?.available !== true) {
    throw new Error(`VLM reader unavailable: ${JSON.stringify(vlm.payload)}`);
  }
  if (anydoc.payload?.available !== true) {
    throw new Error(`AnyDoc reader unavailable: ${JSON.stringify(anydoc.payload)}`);
  }
  emit("readers-ready", {
    vlm: vlm.payload,
    anydoc: anydoc.payload,
  });
}

async function createInventory(cookie) {
  await assertLearnHalted(cookie);
  await waitForLearnLock();
  await assertReadersAvailable(cookie);
  const live = await documents(cookie);
  const pdfSources = live.filter(isPdfSource);
  const book = pdfSources.find((source) => source.slug === preservedBookSlug);
  if (!book) throw new Error("The preserved Engineering Electromagnetics book is missing.");
  const similarlyNamed = pdfSources.filter(
    (source) =>
      source.slug !== preservedBookSlug &&
      /engineering electromagnetics.*(?:ninth|9th)/iu.test(
        `${source.title ?? ""} ${source.sourceFile ?? ""}`,
      ),
  );
  if (similarlyNamed.length > 0) {
    throw new Error(
      `Ambiguous Engineering Electromagnetics sources: ${similarlyNamed.map((item) => item.slug).join(", ")}`,
    );
  }
  const targets = pdfSources
    .filter((source) => source.slug !== preservedBookSlug)
    .sort((left, right) =>
      String(left.sourceFile).localeCompare(String(right.sourceFile)),
    );
  if (targets.length === 0) throw new Error("No non-book PDF sources were found.");

  const records = [];
  for (const source of targets) {
    const sourceFile = String(source.sourceFile ?? "");
    if (!sourceFile || path.basename(sourceFile) !== sourceFile) {
      throw new Error(`Unsafe or missing source filename on ${source.slug}.`);
    }
    const originalPath = path.resolve(downloadsDirectory, sourceFile);
    if (
      path.dirname(originalPath).toLowerCase() !==
      path.resolve(downloadsDirectory).toLowerCase()
    ) {
      throw new Error(`Source filename escapes Downloads: ${sourceFile}`);
    }
    if (!fs.statSync(originalPath, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Original PDF is missing from Downloads: ${sourceFile}`);
    }
    const retainedPath = assetPathFromUrl(source.sourcePdf);
    if (!fs.statSync(retainedPath, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Retained source PDF is missing: ${retainedPath}`);
    }
    const [originalHash, retainedHash] = await Promise.all([
      sha256(originalPath),
      sha256(retainedPath),
    ]);
    if (originalHash !== retainedHash) {
      throw new Error(
        `Downloads and retained source differ for ${sourceFile}; deletion was not started.`,
      );
    }
    records.push({
      slug: source.slug,
      sourceFile,
      sourcePdf: source.sourcePdf,
      originalPath,
      sha256: originalHash,
      bytes: fs.statSync(originalPath).size,
      title: source.title,
      description: source.description,
      stage: "pending",
      requestId: null,
      attempts: 0,
    });
  }

  const bookDetail = await documentDetail(cookie, book.slug);
  const bookAssetPath = assetPathFromUrl(book.sourcePdf);
  const media = live
    .filter(
      (source) =>
        source?.type === "source-document" &&
        (["audio", "video"].includes(
          String(source.sourceType ?? "").toLowerCase(),
        ) ||
          String(source.sourceMedia ?? "").trim()),
    )
    .map((source) => ({
      slug: source.slug,
      sourceFile: source.sourceFile,
      sourceMedia: source.sourceMedia,
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
  const state = {
    version: 1,
    gardenSlug,
    createdAt: new Date().toISOString(),
    learnStatus: await assertLearnHalted(cookie),
    preservedBook: {
      slug: book.slug,
      sourceFile: book.sourceFile,
      sourcePdf: book.sourcePdf,
      contentHash: crypto
        .createHash("sha256")
        .update(bookDetail.content)
        .digest("hex"),
      assetHash: await sha256(bookAssetPath),
    },
    media,
    targets: records,
  };
  saveState(state);
  emit("inventory-complete", {
    preservedBook: state.preservedBook,
    pdfsToReupload: records.map((record) => ({
      slug: record.slug,
      sourceFile: record.sourceFile,
      bytes: record.bytes,
      sha256: record.sha256,
    })),
    mediaSourcesPreserved: media.length,
    statePath,
  });
  return state;
}

async function validateStateFiles(state) {
  for (const target of state.targets) {
    const metadata = fs.statSync(target.originalPath, { throwIfNoEntry: false });
    if (!metadata?.isFile()) {
      throw new Error(`Original PDF disappeared: ${target.originalPath}`);
    }
    const digest = await sha256(target.originalPath);
    if (digest !== target.sha256 || metadata.size !== target.bytes) {
      throw new Error(`Original PDF changed: ${target.sourceFile}`);
    }
  }
}

async function deleteSource(cookie, slug, sourceFile) {
  for (;;) {
    const live = await documents(cookie);
    const source = live.find(
      (item) =>
        item?.type === "source-document" &&
        (item.slug === slug ||
          String(item.sourceFile ?? "").toLowerCase() ===
            sourceFile.toLowerCase()),
    );
    if (!source) return;
    if (source.slug === preservedBookSlug) {
      throw new Error("Refusing to delete the preserved Engineering book.");
    }
    try {
      const { payload } = await fetchJson(
        `${baseUrl}/api/documents/${encodeURIComponent(source.slug)}?clusterSlug=${encodeURIComponent(gardenSlug)}`,
        {
          method: "DELETE",
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(10 * 60_000),
        },
        1,
      );
      if (payload?.success !== true) {
        throw new Error(`Deletion response was malformed: ${JSON.stringify(payload)}`);
      }
      emit("pdf-deleted", {
        slug: source.slug,
        sourceFile,
        deletedSlugs: payload.deletedSlugs,
      });
      return;
    } catch (error) {
      const remaining = (await documents(cookie)).some(
        (item) =>
          item?.type === "source-document" &&
          String(item.sourceFile ?? "").toLowerCase() ===
            sourceFile.toLowerCase(),
      );
      if (!remaining) return;
      emit("delete-retry", {
        slug: source.slug,
        sourceFile,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(10_000);
    }
  }
}

async function deleteTargets(cookie, state) {
  await assertLearnHalted(cookie);
  await waitForLearnLock();
  const live = await documents(cookie);
  if (!live.some((item) => item.slug === preservedBookSlug)) {
    throw new Error("The preserved Engineering book is missing before deletion.");
  }
  for (const target of state.targets) {
    if (target.stage === "uploaded") continue;
    await deleteSource(cookie, target.slug, target.sourceFile);
    target.stage = "deleted";
    target.requestId = null;
    saveState(state);
  }
  const after = await documents(cookie);
  const remainingTargets = after.filter((item) =>
    state.targets.some(
      (target) =>
        String(item.sourceFile ?? "").toLowerCase() ===
        target.sourceFile.toLowerCase(),
    ),
  );
  if (remainingTargets.length > 0) {
    throw new Error(
      `PDF deletion audit failed: ${remainingTargets.map((item) => item.slug).join(", ")}`,
    );
  }
  if (!after.some((item) => item.slug === preservedBookSlug)) {
    throw new Error("The preserved Engineering book disappeared.");
  }
  emit("deletion-complete", {
    deletedPdfSources: state.targets.length,
    preservedBook: preservedBookSlug,
  });
}

async function readIngestEvents(response, filename) {
  if (!response.body) throw new Error("Ingest response has no event stream.");
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
    if (
      event?.type === "progress" &&
      typeof event.step === "string" &&
      event.step !== lastStep
    ) {
      lastStep = event.step;
      emit("upload-progress", { filename, step: event.step });
    } else if (event?.type === "usage") {
      emit("upload-usage", { filename, tokenUsage: event.tokenUsage });
    } else if (event?.type === "result") {
      result = event;
    } else if (event?.type === "error") {
      terminalError =
        typeof event.error === "string" ? event.error : "Upload failed";
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
  if (result?.success === true) return result;
  throw new Error(terminalError || "Ingest stream ended without a result.");
}

async function lookupIngestJob(cookie, requestId) {
  const response = await fetch(`${baseUrl}/api/ingest/jobs/lookup`, {
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
  if (
    !response.ok ||
    typeof payload?.jobId !== "string" ||
    typeof payload?.state !== "string"
  ) {
    throw new Error(
      `Ingest recovery lookup failed: HTTP ${response.status} ${JSON.stringify(payload)}`,
    );
  }
  return payload;
}

async function reattachIngestJob(cookie, target, jobId) {
  const response = await fetch(
    `${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/events`,
    {
      headers: {
        Cookie: cookie,
        "X-Breadboard-Ingest-Cluster-Slug": gardenSlug,
        "X-Breadboard-Ingest-Started-At": String(
          target.startedAt ?? Date.now(),
        ),
        "X-Breadboard-Ingest-Model": encodeURIComponent("gpt-5.6-sol"),
      },
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Ingest recovery stream returned HTTP ${response.status} ${body}`);
  }
  return readIngestEvents(response, target.sourceFile);
}

async function matchingSource(cookie, sourceFile) {
  const live = await documents(cookie);
  const matches = live.filter(
    (item) =>
      item?.type === "source-document" &&
      String(item.sourceFile ?? "").toLowerCase() === sourceFile.toLowerCase(),
  );
  if (matches.length > 1) {
    throw new Error(`Duplicate live sources for ${sourceFile}.`);
  }
  return matches[0] ?? null;
}

async function verifyHybridSource(cookie, target) {
  const source = await matchingSource(cookie, target.sourceFile);
  if (!source) return { ok: false, reason: "source is not present" };
  const detail = await documentDetail(cookie, source.slug);
  const parseMode = frontmatterValue(detail.content, "parse_mode");
  const extractionMethod = frontmatterValue(
    detail.content,
    "extraction_method",
  );
  const sourceFile = frontmatterValue(detail.content, "source_file");
  const sourcePdf = frontmatterValue(detail.content, "source_pdf");
  const sourceAsset = sourcePdf ? assetPathFromUrl(sourcePdf) : "";
  const checks = {
    sourceFileExact: sourceFile === target.sourceFile,
    parseMode: parseMode === "vlm+anydoc",
    extractionMethod:
      extractionMethod.includes("hunyuan-ocr-gguf") &&
      extractionMethod.includes("+anydoc-"),
    anydocCrossCheck: detail.content.includes("## AnyDoc cross-check"),
    retainedPdf: Boolean(
      sourceAsset &&
        fs.statSync(sourceAsset, { throwIfNoEntry: false })?.isFile(),
    ),
    title: Boolean(String(source.title ?? "").trim()),
    description: Boolean(String(source.description ?? "").trim()),
  };
  return {
    ok: Object.values(checks).every(Boolean),
    source,
    checks,
    parseMode,
    extractionMethod,
    sourceFile,
    sourcePdf,
  };
}

async function ingestBody(target) {
  const body = new FormData();
  body.append("clusterSlug", gardenSlug);
  body.append(
    "file",
    await openAsBlob(target.originalPath, { type: "application/pdf" }),
    target.sourceFile,
  );
  body.append("isHandwriting", "false");
  body.append("parseWithVlm", "true");
  body.append("parseWithAnydoc", "true");
  body.append("vlmTask", "doc_parse");
  body.append("generateMap", "true");
  return body;
}

async function queueTarget(cookie, state, target) {
  if (target.stage === "uploaded") return;
  await assertLearnHalted(cookie);
  await waitForLearnLock();
  await assertReadersAvailable(cookie);

  const existing = await verifyHybridSource(cookie, target);
  if (existing.ok) {
    target.stage = "uploaded";
    target.slug = existing.source.slug;
    target.requestId = null;
    target.runtimeJobId = null;
    target.startedAt = null;
    saveState(state);
    return;
  }
  if (existing.source) {
    throw new Error(
      `Cannot prequeue ${target.sourceFile} while a non-hybrid source exists.`,
    );
  }

  if (target.requestId) {
    const prior = await lookupIngestJob(cookie, target.requestId);
    if (prior && !failedIngestStates.has(prior.state)) {
      target.runtimeJobId = prior.jobId;
      saveState(state);
      emit("upload-prequeued", {
        filename: target.sourceFile,
        requestId: target.requestId,
        runtimeJobId: prior.jobId,
        state: prior.state,
      });
      return;
    }
    target.requestId = null;
    target.runtimeJobId = null;
    target.startedAt = null;
    saveState(state);
  }

  target.attempts += 1;
  target.requestId = crypto.randomUUID();
  target.startedAt = Date.now();
  saveState(state);
  emit("upload-prequeue-started", {
    filename: target.sourceFile,
    bytes: target.bytes,
    attempt: target.attempts,
    requestId: target.requestId,
    mode: "vlm+anydoc",
  });
  try {
    const response = await fetch(`${baseUrl}/api/ingest`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Cookie: cookie,
        "X-Breadboard-Ingest-Cluster-Slug": gardenSlug,
        "X-Breadboard-Ingest-File-Size": String(target.bytes),
        "X-Breadboard-Ingest-Request-Id": target.requestId,
      },
      body: await ingestBody(target),
    });
    target.runtimeJobId = response.headers.get(
      "X-Breadboard-Runtime-Job-Id",
    );
    saveState(state);
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${errorText}`);
    }
    await response.body?.cancel().catch(() => undefined);
    emit("upload-prequeued", {
      filename: target.sourceFile,
      requestId: target.requestId,
      runtimeJobId: target.runtimeJobId,
      state: "queued",
    });
  } catch (error) {
    // The request ID remains durable. uploadTarget will resolve it through the
    // lookup route before it can ever submit the file again.
    emit("upload-prequeue-uncertain", {
      filename: target.sourceFile,
      requestId: target.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function uploadTarget(cookie, state, target) {
  for (;;) {
    await assertLearnHalted(cookie);
    // The canonical sibling lock is shared by Learn, deletes, ingestion, and
    // publication. A delete response can disconnect after removing the note
    // but before its Quartz publish releases this lease; do not create doomed
    // ingestion jobs while that fenced owner is still live.
    const waitedOnMutation = fs.existsSync(learnLockPath);
    await waitForLearnLock();
    if (waitedOnMutation && target.requestId) {
      target.requestId = null;
      saveState(state);
    }
    await assertReadersAvailable(cookie);
    const existing = await verifyHybridSource(cookie, target);
    if (existing.ok) {
      target.stage = "uploaded";
      target.slug = existing.source.slug;
      target.requestId = null;
      saveState(state);
      emit("pdf-already-hybrid", {
        filename: target.sourceFile,
        slug: target.slug,
      });
      return;
    }
    if (existing.source) {
      emit("non-hybrid-source-rejected", {
        filename: target.sourceFile,
        slug: existing.source.slug,
        checks: existing.checks,
        parseMode: existing.parseMode,
      });
      await deleteSource(cookie, existing.source.slug, target.sourceFile);
      target.stage = "deleted";
      target.requestId = null;
      saveState(state);
    }

    if (target.requestId) {
      try {
        const prior = await lookupIngestJob(cookie, target.requestId);
        if (!prior || failedIngestStates.has(prior.state)) {
          emit("stale-upload-cleared", {
            filename: target.sourceFile,
            requestId: target.requestId,
            state: prior?.state ?? "not-found",
          });
          target.requestId = null;
          target.runtimeJobId = null;
          target.startedAt = null;
          saveState(state);
        } else {
          target.runtimeJobId = prior.jobId;
          saveState(state);
          emit("upload-reattached", {
            filename: target.sourceFile,
            requestId: target.requestId,
            runtimeJobId: prior.jobId,
            state: prior.state,
          });
          const result = await reattachIngestJob(cookie, target, prior.jobId);
          emit("upload-result", {
            filename: target.sourceFile,
            runtimeJobId: prior.jobId,
            result,
          });
          const verified = await verifyHybridSource(cookie, target);
          if (!verified.ok) {
            throw new Error(
              `Post-upload hybrid audit failed: ${JSON.stringify(verified)}`,
            );
          }
          target.stage = "uploaded";
          target.slug = verified.source.slug;
          target.requestId = null;
          target.runtimeJobId = null;
          target.startedAt = null;
          saveState(state);
          emit("pdf-uploaded", {
            filename: target.sourceFile,
            slug: target.slug,
            mode: verified.parseMode,
            extractionMethod: verified.extractionMethod,
          });
          return;
        }
      } catch (error) {
        emit("upload-recovery-wait", {
          filename: target.sourceFile,
          requestId: target.requestId,
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(20_000);
        continue;
      }
    }

    target.attempts += 1;
    target.requestId = target.requestId ?? crypto.randomUUID();
    target.startedAt = Date.now();
    saveState(state);
    emit("upload-started", {
      filename: target.sourceFile,
      bytes: target.bytes,
      attempt: target.attempts,
      requestId: target.requestId,
      mode: "vlm+anydoc",
    });
    try {
      const response = await fetch(`${baseUrl}/api/ingest`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "X-Breadboard-Ingest-Cluster-Slug": gardenSlug,
          "X-Breadboard-Ingest-File-Size": String(target.bytes),
          "X-Breadboard-Ingest-Request-Id": target.requestId,
        },
        body: await ingestBody(target),
      });
      const runtimeJobId = response.headers.get(
        "X-Breadboard-Runtime-Job-Id",
      );
      target.runtimeJobId = runtimeJobId;
      saveState(state);
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} ${errorText}`);
      }
      const result = await readIngestEvents(response, target.sourceFile);
      emit("upload-result", {
        filename: target.sourceFile,
        runtimeJobId,
        result,
      });
      const verified = await verifyHybridSource(cookie, target);
      if (!verified.ok) {
        throw new Error(
          `Post-upload hybrid audit failed: ${JSON.stringify(verified)}`,
        );
      }
      target.stage = "uploaded";
      target.slug = verified.source.slug;
      target.requestId = null;
      target.runtimeJobId = null;
      target.startedAt = null;
      saveState(state);
      emit("pdf-uploaded", {
        filename: target.sourceFile,
        slug: target.slug,
        mode: verified.parseMode,
        extractionMethod: verified.extractionMethod,
      });
      return;
    } catch (error) {
      emit("upload-retry", {
        filename: target.sourceFile,
        attempt: target.attempts,
        requestId: target.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      saveState(state);
      await sleep(20_000);
    }
  }
}

async function uploadTargets(cookie, state) {
  await validateStateFiles(state);
  // Reserve FIFO positions up front so an unrelated producer cannot keep
  // pushing later files behind a continuously growing ingestion backlog.
  for (;;) {
    for (const target of state.targets) {
      await queueTarget(cookie, state, target);
    }
    const unreserved = state.targets.filter(
      (target) => target.stage !== "uploaded" && !target.runtimeJobId,
    );
    if (unreserved.length === 0) break;
    emit("upload-prequeue-wait", {
      filenames: unreserved.map((target) => target.sourceFile),
      reason: "runtime input quota",
    });
    await sleep(5_000);
  }
  for (const target of state.targets) {
    await uploadTarget(cookie, state, target);
  }
}

async function audit(cookie, state) {
  await assertLearnHalted(cookie);
  const live = await documents(cookie);
  const pdfSources = live.filter(isPdfSource);
  const expectedPdfFiles = new Set([
    String(state.preservedBook.sourceFile).toLowerCase(),
    ...state.targets.map((target) => target.sourceFile.toLowerCase()),
  ]);
  const actualPdfFiles = new Set(
    pdfSources.map((source) => String(source.sourceFile).toLowerCase()),
  );
  if (
    expectedPdfFiles.size !== actualPdfFiles.size ||
    [...expectedPdfFiles].some((file) => !actualPdfFiles.has(file))
  ) {
    throw new Error(
      `Final PDF set differs: expected ${JSON.stringify([...expectedPdfFiles])}, got ${JSON.stringify([...actualPdfFiles])}`,
    );
  }
  const book = pdfSources.find((source) => source.slug === preservedBookSlug);
  if (!book) throw new Error("The preserved Engineering book is missing.");
  const bookDetail = await documentDetail(cookie, book.slug);
  const bookContentHash = crypto
    .createHash("sha256")
    .update(bookDetail.content)
    .digest("hex");
  const bookAssetHash = await sha256(assetPathFromUrl(book.sourcePdf));
  if (
    bookContentHash !== state.preservedBook.contentHash ||
    bookAssetHash !== state.preservedBook.assetHash
  ) {
    throw new Error("The preserved Engineering book changed.");
  }

  const hybrid = [];
  for (const target of state.targets) {
    const verified = await verifyHybridSource(cookie, target);
    if (!verified.ok) {
      throw new Error(
        `Final hybrid audit failed for ${target.sourceFile}: ${JSON.stringify(verified)}`,
      );
    }
    hybrid.push({
      sourceFile: target.sourceFile,
      slug: verified.source.slug,
      title: verified.source.title,
      description: verified.source.description,
      parseMode: verified.parseMode,
      extractionMethod: verified.extractionMethod,
      sourcePdf: verified.sourcePdf,
    });
  }

  const media = live
    .filter(
      (source) =>
        source?.type === "source-document" &&
        (["audio", "video"].includes(
          String(source.sourceType ?? "").toLowerCase(),
        ) ||
          String(source.sourceMedia ?? "").trim()),
    )
    .map((source) => ({
      slug: source.slug,
      sourceFile: source.sourceFile,
      sourceMedia: source.sourceMedia,
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
  if (JSON.stringify(media) !== JSON.stringify(state.media)) {
    throw new Error("Audio/video source inventory changed during PDF replacement.");
  }
  emit("final-audit-complete", {
    learn: "halted",
    preservedBook: {
      slug: book.slug,
      sourceFile: book.sourceFile,
      unchanged: true,
    },
    hybridPdfCount: hybrid.length,
    mediaSourceCount: media.length,
    hybrid,
  });
}

const cookie = await authenticatedCookie();
let state = loadState();
if (!state) state = await createInventory(cookie);
else {
  await validateStateFiles(state);
  emit("inventory-resumed", {
    statePath,
    targets: state.targets.length,
    stages: state.targets.map((target) => ({
      sourceFile: target.sourceFile,
      stage: target.stage,
    })),
  });
}

if (phase === "inventory") process.exit(0);
if (phase === "delete" || phase === "all") await deleteTargets(cookie, state);
if (phase === "delete") process.exit(0);
if (phase === "upload" || phase === "all") await uploadTargets(cookie, state);
if (phase === "upload") process.exit(0);
await audit(cookie, state);
