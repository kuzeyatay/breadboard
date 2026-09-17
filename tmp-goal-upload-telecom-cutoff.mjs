import crypto from "node:crypto";
import fs, { openAsBlob } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encode } from "./dashboard/node_modules/next-auth/jwt/index.js";

const gardenName = "Telecom 1";
const gardenSlug = "telecom-1";
const downloadsDirectory = path.resolve("C:/Users/20252082/Downloads");
const cutoffStart = new Date(2026, 8, 3, 0, 0, 0, 0);
const cutoffEnd = new Date(2026, 8, 3, 6, 52, 0, 0);
const statePath = path.resolve(".tmp-goal-upload-telecom-cutoff-state.json");
const requiredReaderMode = "vlm+anydoc";
const requestNamespace = "goal-telecom1-vlm-anydoc";
const baseUrl =
  process.argv.find((value) => value.startsWith("--base="))?.slice(7) ?? "";
const cancelJobId =
  process.argv.find((value) => value.startsWith("--cancel-job="))?.slice(13) ??
  "";

const manifest = [
  {
    name: "5XTA0 Study Guide 2026-2027 Q1-2.pdf",
    bytes: 279464,
    sha256: "0cf326e4ea18defeddb657e3be41054896dce07c645b08c38d1a5705f61dc610",
  },
  {
    name: "5XTA0-Schedule_2026-2027.pdf",
    bytes: 157175,
    sha256: "d300beda5b8a2ebe191681cd3c4978bcb8f6b2c8aee91f3889b0056a9f318a89",
  },
  {
    name: "5XTA0 – Introduction.pdf",
    bytes: 529523,
    sha256: "a781d447ba3dd0de0742e19708ba095349d20f0d51cdccb5494e6e438115c6e2",
  },
  {
    name: "5XTA0-GE.1-OSI_model.pptx",
    bytes: 2725457,
    sha256: "c01fb463c53696a304a7ff7af254a5cdc9d2dd5bdd11710f360d67bedfda3f41",
  },
  {
    name: "5XTA0.M1.SR_DigitalModulationFormats_Introduction+Baseband.pdf",
    bytes: 3692301,
    sha256: "fa4dddb437c90a76c50daa16c4ce7d43e0ad6c658eaaf3d0e99932d84821c673",
  },
  {
    name: "5XTA0.M1.SR_DigitalModulationFormats_Bandpass_Binary-1.pdf",
    bytes: 2723456,
    sha256: "81e0be05d1ab710cfdfab18e4182f0df71a91f1cbc6c9212340e82d575d6e6b8",
  },
  {
    name: "5XTA0.M1.SR_DigitalModulationFormats_Bandpass_Multilevel+OFDM.pdf",
    bytes: 3785344,
    sha256: "0ed6462b812bb5589cb0c11885dda366b644b79156bd2895193c3e34bf08726b",
  },
  {
    name: "5XTA0.M1.SR_DigitalModulationFormats_Bandpass_OFDM_example.pdf",
    bytes: 181168,
    sha256: "7dda36b4ee28cbff3a107148807d10d8d25e0be00f35a426de5acceafce70b6f",
  },
  {
    name: "Q-function_table.pdf",
    bytes: 113401,
    sha256: "af2342b09640df5e1eb2e8f1d927a4c76c493de72b1c9d6a9485f75668b1d45c",
  },
  {
    name: "5XTA0_M1_SR_DigitalModulationFormats_Instructions-4.pdf",
    bytes: 401165,
    sha256: "332a0168ab30713bc3f39a76929db8b5d96d18e0b2338e6c56f4dabc1e3d30bd",
  },
  {
    name: "5XTA0.M1.SR_DigitalModulationFormats_Solutions_Part1_2026.pdf",
    bytes: 2292093,
    sha256: "c11c6763347263f06d6a276c6ff4d844a7a3056ff1dc7c66378587b59fc1e7b4",
  },
  {
    name: "exam_formulaSheet.pdf",
    bytes: 271775,
    sha256: "685d3acc0529c908131ecf61af9a75b00c172e23880c3d27bc545b4a51523b04",
  },
];

if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(baseUrl)) {
  throw new Error("Usage: --base=http://127.0.0.1:<port>");
}

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
    return {
      version: 1,
      gardenName,
      gardenSlug,
      cutoffStart: cutoffStart.toISOString(),
      cutoffEnd: cutoffEnd.toISOString(),
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
      })),
    };
  }
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (
    state?.version !== 1 ||
    state?.gardenSlug !== gardenSlug ||
    !Array.isArray(state?.targets) ||
    state.targets.length !== manifest.length
  ) {
    throw new Error(`Unexpected upload state in ${statePath}`);
  }
  return state;
}

function migrateRequestNamespace(state) {
  if (state.requestNamespace === requestNamespace) return;
  state.requestNamespace = requestNamespace;
  for (const target of state.targets) {
    target.stage = "pending";
    target.attempt = 0;
    target.requestId = null;
    target.runtimeJobId = null;
    target.startedAt = null;
    target.slug = null;
  }
  saveState(state);
  emit("request-namespace-migrated", { requestNamespace });
}

async function validateManifest(state) {
  const expectedNames = new Set(manifest.map((item) => item.name));
  if (expectedNames.size !== manifest.length) {
    throw new Error("The upload manifest contains duplicate filenames");
  }
  for (const target of state.targets) {
    const expected = manifest.find((item) => item.name === target.name);
    if (!expected) throw new Error(`State contains a non-manifest file: ${target.name}`);
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
    if (
      stat.birthtime < cutoffStart ||
      stat.birthtime >= cutoffEnd ||
      stat.mtime >= cutoffEnd
    ) {
      throw new Error(`File is outside the strict download cutoff: ${target.name}`);
    }
    const digest = await sha256File(resolved);
    if (digest !== expected.sha256) throw new Error(`File hash changed: ${target.name}`);
  }
  emit("manifest-validated", {
    count: state.targets.length,
    cutoff: "2026-09-03T06:52:00+02:00 (exclusive)",
    files: state.targets.map((target) => target.name),
  });
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
      const response = await fetch(`${baseUrl}/api/auth/session`, {
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

async function matchingSource(cookie, sourceFile) {
  const live = await documents(cookie);
  const matches = live.filter(
    (item) =>
      item?.type === "source-document" &&
      String(item.sourceFile ?? "").toLowerCase() === sourceFile.toLowerCase(),
  );
  if (matches.length > 1) {
    throw new Error(`Duplicate live sources for ${sourceFile}`);
  }
  return matches[0] ?? null;
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

function mimeType(filename) {
  return filename.toLowerCase().endsWith(".pptx")
    ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    : "application/pdf";
}

function ingestBody(target) {
  return openAsBlob(target.filePath, { type: mimeType(target.name) }).then((blob) => {
    const isPdf = target.name.toLowerCase().endsWith(".pdf");
    const body = new FormData();
    body.append("clusterSlug", gardenSlug);
    body.append("file", blob, target.name);
    body.append("isHandwriting", "false");
    // Breadboard supports the visual VLM for PDFs/images. AnyDoc supports both
    // PDFs and PPTX, so PDFs use both readers and the PowerPoint uses AnyDoc.
    body.append("parseWithVlm", String(isPdf));
    body.append("parseWithAnydoc", "true");
    body.append("generateMap", "true");
    return body;
  });
}

async function requireReaderAvailability(cookie) {
  const [{ payload: vlm }, { payload: anydoc }] = await Promise.all([
    fetchJson(`${baseUrl}/api/vlm-ocr/status`, {
      headers: { Cookie: cookie, "Cache-Control": "no-cache" },
    }),
    fetchJson(`${baseUrl}/api/anydoc/status`, {
      headers: { Cookie: cookie, "Cache-Control": "no-cache" },
    }),
  ]);
  if (vlm?.available !== true) {
    throw new Error(`VLM is unavailable: ${String(vlm?.detail ?? "unknown reason")}`);
  }
  if (anydoc?.available !== true) {
    throw new Error(`AnyDoc is unavailable: ${String(anydoc?.detail ?? "unknown reason")}`);
  }
  emit("readers-validated", {
    pdfMode: "vlm+anydoc",
    pptxMode: "anydoc (VLM does not support PPTX)",
    vlmRunning: vlm?.running === true,
    vlmManaged: vlm?.managed === true,
    anydocVersion: anydoc?.version ?? null,
  });
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
    if (
      event?.type === "progress" &&
      typeof event.step === "string" &&
      event.step !== lastStep
    ) {
      lastStep = event.step;
      emit("upload-progress", { filename, step: event.step });
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
  if (result?.success === true) return result;
  throw new Error(terminalError || "Ingest stream ended without a result");
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

async function cancelTargetJob(cookie, target) {
  if (!target.runtimeJobId) return;
  const jobId = target.runtimeJobId;
  try {
    const { payload } = await fetchJson(
      `${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/cancel`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "X-Breadboard-Ingest-Cluster-Slug": gardenSlug,
        },
      },
      4,
    );
    emit("upload-cancelled", {
      filename: target.name,
      jobId,
      state: payload?.state ?? payload?.status ?? "acknowledged",
    });
  } catch (error) {
    // A finalizing job can win the race and disappear before cancellation.
    // Its exact source is deleted below, so this is safe to recover from.
    emit("upload-cancel-race", {
      filename: target.name,
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function deleteSourceDocument(cookie, source) {
  const slug = String(source?.slug ?? "");
  if (!slug) throw new Error("Cannot delete a source without a slug");
  for (;;) {
    try {
      const { payload } = await fetchJson(
        `${baseUrl}/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(gardenSlug)}`,
        { method: "DELETE", headers: { Cookie: cookie } },
        5,
      );
      emit("source-removed", {
        slug,
        sourceFile: source.sourceFile ?? null,
        deletedSlugs: Array.isArray(payload?.deletedSlugs)
          ? payload.deletedSlugs.length
          : null,
      });
      return;
    } catch (error) {
      const stillThere = await matchingSource(cookie, String(source.sourceFile ?? ""));
      if (!stillThere) {
        emit("source-removal-recovered", {
          slug,
          sourceFile: source.sourceFile ?? null,
        });
        return;
      }
      emit("source-removal-waiting", {
        slug,
        sourceFile: source.sourceFile ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(15_000);
    }
  }
}

async function resetNoncompliantRun(cookie, state) {
  emit("reader-reset-started", { from: state.readerMode ?? "standard" });
  for (const target of state.targets) await cancelTargetJob(cookie, target);
  await sleep(3_000);

  const manifestNames = new Set(manifest.map((item) => item.name.toLowerCase()));
  for (let pass = 1; pass <= 4; pass += 1) {
    const live = await documents(cookie);
    const matching = live.filter(
      (item) =>
        item?.type === "source-document" &&
        manifestNames.has(String(item.sourceFile ?? "").toLowerCase()),
    );
    if (matching.length === 0) break;
    for (const source of matching) await deleteSourceDocument(cookie, source);
    await sleep(3_000);
  }

  const remaining = (await documents(cookie)).filter(
    (item) =>
      item?.type === "source-document" &&
      manifestNames.has(String(item.sourceFile ?? "").toLowerCase()),
  );
  if (remaining.length > 0) {
    throw new Error(
      `Noncompliant sources remain after cleanup: ${remaining.map((item) => item.slug).join(", ")}`,
    );
  }

  state.readerMode = requiredReaderMode;
  state.resetAt = new Date().toISOString();
  state.targets = manifest.map((item) => ({
    ...item,
    filePath: path.join(downloadsDirectory, item.name),
    stage: "pending",
    attempt: 0,
    requestId: null,
    runtimeJobId: null,
    startedAt: null,
    slug: null,
  }));
  saveState(state);
  emit("reader-reset-complete", { removedAllNoncompliantSources: true });
}

async function reattachIngestJob(cookie, target, jobId) {
  const response = await fetch(
    `${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/events`,
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

async function uploadTarget(cookie, state, target) {
  for (;;) {
    await validateManifest(state);
    const existing = await matchingSource(cookie, target.name);
    if (existing) {
      target.stage = "uploaded";
      target.slug = existing.slug;
      target.requestId = null;
      target.runtimeJobId = null;
      saveState(state);
      emit("already-uploaded", { filename: target.name, slug: existing.slug });
      return;
    }

    if (target.requestId) {
      let prior;
      try {
        prior = await lookupIngestJob(cookie, target.requestId);
        if (
          prior &&
          [
            "queued",
            "starting",
            "running",
            "working",
            "finalizing",
            "cancelling",
            "canceling",
          ].includes(prior.state)
        ) {
          target.runtimeJobId = prior.jobId;
          saveState(state);
          emit("upload-reattached", {
            filename: target.name,
            jobId: prior.jobId,
            state: prior.state,
          });
          const result = await reattachIngestJob(cookie, target, prior.jobId);
          target.stage = "uploaded";
          target.slug = result.slug ?? null;
          target.requestId = null;
          target.runtimeJobId = null;
          saveState(state);
          emit("upload-complete", {
            filename: target.name,
            slug: target.slug,
            duplicate: result.duplicate === true,
          });
          return;
        }
      } catch (error) {
        emit("upload-recovery-error", {
          filename: target.name,
          error: error instanceof Error ? error.message : String(error),
        });
        // A dropped event stream or lookup request is not evidence that a
        // durable job stopped. Re-poll the same request ID until its state is
        // terminal, preventing a second job from racing the first.
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
    target.requestId = `${requestNamespace}-${target.sha256.slice(0, 24)}-${target.attempt}`;
    target.startedAt = Date.now();
    saveState(state);
    emit("upload-started", {
      filename: target.name,
      bytes: target.bytes,
      attempt: target.attempt,
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
      target.runtimeJobId = response.headers.get("X-Breadboard-Runtime-Job-Id");
      saveState(state);
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} ${body}`);
      }
      const result = await readIngestEvents(response, target.name);
      target.stage = "uploaded";
      target.slug = result.slug ?? null;
      target.requestId = null;
      target.runtimeJobId = null;
      saveState(state);
      emit("upload-complete", {
        filename: target.name,
        slug: target.slug,
        duplicate: result.duplicate === true,
      });
      return;
    } catch (error) {
      emit("upload-attempt-error", {
        filename: target.name,
        attempt: target.attempt,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(Math.min(30_000, target.attempt * 5_000));
    }
  }
}

async function audit(cookie, state, initialSourceFiles) {
  await validateManifest(state);
  const live = await documents(cookie);
  const sourceDocuments = live.filter((item) => item?.type === "source-document");
  const manifestNames = new Set(manifest.map((item) => item.name.toLowerCase()));
  const verified = [];
  for (const target of state.targets) {
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
    const expectedMode = target.name.toLowerCase().endsWith(".pdf")
      ? "vlm+anydoc"
      : "anydoc";
    const recordedMode = String(document?.content ?? "").match(
      /^parse_mode:\s*["']?([^\r\n"']+)/mu,
    )?.[1]?.trim();
    if (recordedMode !== expectedMode) {
      throw new Error(
        `Final audit found parse_mode=${recordedMode ?? "missing"} for ${target.name}; expected ${expectedMode}`,
      );
    }
    verified.push({ filename: target.name, slug: matches[0].slug, parseMode: recordedMode });
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
await validateManifest(state);
const cookie = await authenticatedCookie();
if (cancelJobId) {
  const { payload } = await fetchJson(
    `${baseUrl}/api/ingest/jobs/${encodeURIComponent(cancelJobId)}/cancel`,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        "X-Breadboard-Ingest-Cluster-Slug": gardenSlug,
      },
    },
    6,
  );
  emit("targeted-job-cancelled", {
    jobId: cancelJobId,
    state: payload?.state ?? payload?.status ?? "acknowledged",
  });
  process.exit(0);
}
await waitForLearnIdle(cookie);
if (state.readerMode !== requiredReaderMode) {
  await resetNoncompliantRun(cookie, state);
}
migrateRequestNamespace(state);
await requireReaderAvailability(cookie);
const initialDocuments = await documents(cookie);
const initialSourceFiles = new Set(
  initialDocuments
    .filter((item) => item?.type === "source-document")
    .map((item) => String(item.sourceFile ?? "").toLowerCase())
    .filter(Boolean),
);

for (const target of state.targets) {
  await uploadTarget(cookie, state, target);
}

await audit(cookie, state, initialSourceFiles);
emit("all-complete", { garden: gardenName, count: state.targets.length });
