import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_BROWSER_OUTPUT_CHARS = 750_000;
const BROWSER_OUTPUT_HEAD_CHARS = 375_000;
const BROWSER_OUTPUT_TRUNCATION_MARKER =
  "\n...[browser output truncated]...\n";
const CHILD_STOP_GRACE_MS = 2_000;
export const TREE_KILLER_TIMEOUT_MS = 4_000;
export const TREE_CLOSE_TIMEOUT_MS = 5_000;
const NATURAL_BROWSER_CLOSE_GRACE_MS = 1_500;
const WRAPPER_EXIT_HOLD_MS = 250;
export const PROCESS_SNAPSHOT_TIMEOUT_MS = 5_000;
const PROCESS_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
export const TREE_QUIESCENCE_TIMEOUT_MS = 8_000;
const BROWSER_PROFILE_REMOVE_TIMEOUT_MS = 5_000;
const BROWSER_PROFILE_REMOVE_RETRY_BASE_MS = 50;
const BROWSER_PROFILE_REMOVE_RETRY_MAX_MS = 400;
const TRANSIENT_WINDOWS_PROFILE_REMOVE_CODES = new Set([
  "EBUSY",
  "ENOTEMPTY",
  "EPERM",
]);
const BROWSER_WRAPPER_ARGUMENT = "--breadboard-browser-wrapper";
const EXECUTOR_PATH = fileURLToPath(import.meta.url);

function fail(message) {
  throw new Error(message);
}

function isDirectFile(filePath) {
  try {
    const resolved = path.resolve(filePath);
    const metadata = fs.lstatSync(resolved);
    return metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      samePath(fs.realpathSync.native(resolved), resolved);
  } catch {
    return false;
  }
}

function samePath(left, right, platform = process.platform) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForClose(closePromise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      closePromise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function windowsSystemRoot(env = process.env) {
  return String(
    env.SystemRoot ?? env.SYSTEMROOT ?? env.WINDIR ?? env.windir ?? "",
  ).trim();
}

export function trustedWindowsTreeKiller(env = process.env) {
  const configuredRoot = windowsSystemRoot(env);
  if (!configuredRoot) return null;
  try {
    const root = path.resolve(configuredRoot);
    const rootMetadata = fs.lstatSync(root);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) return null;
    const canonicalRoot = fs.realpathSync.native(root);
    const candidate = path.join(canonicalRoot, "System32", "taskkill.exe");
    if (!isDirectFile(candidate)) return null;
    const canonicalCandidate = fs.realpathSync.native(candidate);
    if (!samePath(path.dirname(path.dirname(canonicalCandidate)), canonicalRoot)) {
      return null;
    }
    return canonicalCandidate;
  } catch {
    return null;
  }
}

export function trustedWindowsPowerShell(env = process.env) {
  const configuredRoot = windowsSystemRoot(env);
  if (!configuredRoot) return null;
  try {
    const root = fs.realpathSync.native(path.resolve(configuredRoot));
    const candidate = path.join(
      root,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    if (!isDirectFile(candidate)) return null;
    const canonicalCandidate = fs.realpathSync.native(candidate);
    if (!samePath(
      path.resolve(canonicalCandidate, "..", "..", "..", ".."),
      root,
    )) return null;
    return canonicalCandidate;
  } catch {
    return null;
  }
}

function boundedSnapshotRow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pid = Number(value.ProcessId);
  const parentPid = Number(value.ParentProcessId);
  const creation = String(value.CreationDate ?? "");
  const match = /^\/Date\((\d+)\)\/$/u.exec(creation);
  const creationMs = match ? Number(match[1]) : Date.parse(creation);
  const name = String(value.Name ?? "");
  const executable = value.ExecutablePath === null
    ? null
    : String(value.ExecutablePath ?? "");
  if (
    !Number.isSafeInteger(pid) || pid <= 0 ||
    !Number.isSafeInteger(parentPid) || parentPid < 0 ||
    !Number.isSafeInteger(creationMs) || creationMs <= 0 ||
    name.length < 1 || name.length > 260 ||
    (executable !== null && executable.length > 32_768)
  ) return null;
  return { pid, parentPid, creationMs, name, executable };
}

export async function windowsProcessSnapshot(
  env,
  powershell,
  timeoutMs = PROCESS_SNAPSHOT_TIMEOUT_MS,
) {
  const script = [
    "$ErrorActionPreference='Stop'",
    "[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)",
    "$rows=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,Name,ExecutablePath",
    "ConvertTo-Json -Compress -Depth 2 -InputObject @($rows)",
  ].join("; ");
  return await new Promise((resolve) => {
    let child;
    let stdout = Buffer.alloc(0);
    let overflow = false;
    let settled = false;
    const finish = (rows) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(rows);
    };
    try {
      child = spawn(powershell, [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script,
      ], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
        env: {
          SystemRoot: windowsSystemRoot(env),
          WINDIR: windowsSystemRoot(env),
        },
      });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The bounded snapshot helper may already have exited.
      }
      finish(null);
    }, Math.max(1, Math.min(PROCESS_SNAPSHOT_TIMEOUT_MS, timeoutMs)));
    child.stdout?.on("data", (chunk) => {
      if (overflow) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stdout.byteLength + bytes.byteLength > PROCESS_SNAPSHOT_MAX_BYTES) {
        overflow = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // The bounded snapshot helper may already have exited.
        }
        return;
      }
      stdout = Buffer.concat([stdout, bytes]);
    });
    child.once("error", () => finish(null));
    child.once("close", (code) => {
      if (code !== 0 || overflow) {
        finish(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout.toString("utf8").replace(/^\uFEFF/u, ""));
        if (!Array.isArray(parsed)) {
          finish(null);
          return;
        }
        const rows = parsed.map(boundedSnapshotRow).filter(Boolean);
        finish(rows.length > 0 ? rows : null);
      } catch {
        finish(null);
      }
    });
  });
}

function sameProcessIdentity(left, right) {
  return left.pid === right.pid && left.creationMs === right.creationMs;
}

export function extendOwnedLineage(known, rows) {
  const currentByPid = new Map(rows.map((row) => [row.pid, row]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      const existing = known.get(row.pid);
      if (existing) continue;
      const parent = known.get(row.parentPid);
      const currentParent = currentByPid.get(row.parentPid);
      // A historical parent PID is not ownership. Windows can reuse that PID
      // after our process exits; admitting a new child through the stale map
      // would make an unrelated tree eligible for `/T /F`.
      if (
        !parent ||
        !currentParent ||
        !sameProcessIdentity(parent, currentParent) ||
        row.creationMs < parent.creationMs
      ) continue;
      known.set(row.pid, row);
      changed = true;
    }
  }
}

export function isCurrentOwnedWindowsRoot(rootPid, initialRows, currentRows) {
  if (!Array.isArray(initialRows) || !Array.isArray(currentRows)) return false;
  const initialRoot = initialRows.find((row) => row.pid === rootPid);
  const currentRoot = currentRows.find((row) => row.pid === rootPid);
  return Boolean(
    initialRoot &&
    currentRoot &&
    sameProcessIdentity(initialRoot, currentRoot),
  );
}

function liveOwnedLineage(known, rows) {
  extendOwnedLineage(known, rows);
  return rows.filter((row) => {
    const identity = known.get(row.pid);
    return identity && sameProcessIdentity(identity, row);
  });
}

async function confirmWindowsLineageQuiescence({
  rootPid,
  initialRows,
  observedRows,
  env,
  powershell,
  taskkill,
}) {
  const root = initialRows.find((row) => row.pid === rootPid);
  if (!root) return false;
  const known = new Map([[root.pid, root]]);
  extendOwnedLineage(known, initialRows);
  if (Array.isArray(observedRows)) extendOwnedLineage(known, observedRows);
  const deadline = Date.now() + TREE_QUIESCENCE_TIMEOUT_MS;
  let emptyScans = 0;
  while (Date.now() < deadline) {
    const remainingBeforeSnapshot = deadline - Date.now();
    if (remainingBeforeSnapshot <= 0) return false;
    const rows = await windowsProcessSnapshot(
      env,
      powershell,
      remainingBeforeSnapshot,
    );
    if (!rows) return false;
    const survivors = liveOwnedLineage(known, rows);
    if (survivors.length === 0) {
      emptyScans += 1;
      if (emptyScans >= 2) return true;
      await delay(100);
      continue;
    }
    emptyScans = 0;
    const survivorIds = new Set(survivors.map((row) => row.pid));
    const roots = survivors.filter((row) => !survivorIds.has(row.parentPid));
    for (const survivor of roots) {
      const remainingBeforeKill = deadline - Date.now();
      if (remainingBeforeKill <= 0) return false;
      await runTreeKiller(
        taskkill,
        survivor.pid,
        env,
        Math.min(TREE_KILLER_TIMEOUT_MS, remainingBeforeKill),
      );
    }
    await delay(100);
  }
  return false;
}

function processGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return Boolean(
      error && typeof error === "object" && error.code !== "ESRCH",
    );
  }
}

async function runTreeKiller(
  taskkill,
  pid,
  env,
  timeoutMs = TREE_KILLER_TIMEOUT_MS,
) {
  return await new Promise((resolve) => {
    let settled = false;
    let killer;
    let output = "";
    const finish = (succeeded, code = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ succeeded, code, output: output.slice(-1_000) });
    };
    try {
      killer = spawn(taskkill, ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          SystemRoot: windowsSystemRoot(env),
          WINDIR: windowsSystemRoot(env),
        },
      });
    } catch {
      resolve({ succeeded: false, code: null, output: "spawn failed" });
      return;
    }
    const timer = setTimeout(() => {
      try {
        killer.kill();
      } catch {
        // The bounded helper may already have exited.
      }
      finish(false, null);
    }, Math.max(1, Math.min(TREE_KILLER_TIMEOUT_MS, timeoutMs)));
    killer.stdout?.on("data", (chunk) => {
      output = appendBoundedBrowserOutput(output, chunk);
    });
    killer.stderr?.on("data", (chunk) => {
      output = appendBoundedBrowserOutput(output, chunk);
    });
    killer.once("error", (error) => {
      output = appendBoundedBrowserOutput(output, String(error));
      finish(false, null);
    });
    killer.once("close", (code) => finish(code === 0, code));
  });
}

export async function terminateOwnedBrowserTree(
  child,
  platform,
  env,
  taskkill,
  ownership = {},
) {
  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return { method: "none", confirmed: false };
  }
  if (platform === "win32") {
    const powershell = ownership.powershell ?? trustedWindowsPowerShell(env);
    const admittedRows = Array.isArray(ownership.initialRows)
      ? ownership.initialRows
      : null;
    const processSnapshot = ownership.processSnapshot ?? windowsProcessSnapshot;
    const finalRows = powershell
      ? await processSnapshot(env, powershell)
      : null;
    // Cleanup-time rows are observation only. They can never establish the
    // creation identity that had to be admitted while this child handle was
    // freshly spawned; promoting them would authorize a reused PID.
    const initialRows = admittedRows;
    const rootExitedBeforeFallback =
      child.exitCode !== null || child.signalCode !== null;
    const rootIdentityConfirmed =
      !rootExitedBeforeFallback &&
      isCurrentOwnedWindowsRoot(pid, admittedRows, finalRows);
    // Never hand taskkill a PID whose creation identity changed (or could not
    // be proven). The wrapper's natural exit can race this cleanup path, and a
    // newly reused PID must not become our process tree.
    const treeKiller = ownership.treeKiller ?? runTreeKiller;
    const treeKill = taskkill && rootIdentityConfirmed
      ? await treeKiller(taskkill, pid, env)
      : {
          succeeded: false,
          code: null,
          output: rootExitedBeforeFallback
            ? "wrapper exited before taskkill"
            : "root process identity was not confirmed",
        };
    const lineageConfirmed = initialRows && powershell && taskkill
      ? await confirmWindowsLineageQuiescence({
          rootPid: pid,
          initialRows,
          observedRows: admittedRows ? finalRows : null,
          env,
          powershell,
          taskkill,
        })
      : false;
    const confirmed = lineageConfirmed === true;
    const rootUnavailableBeforeFallback =
      rootExitedBeforeFallback || !rootIdentityConfirmed;
    if (!confirmed && !rootExitedBeforeFallback) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Rust's kill-on-close Job Object remains the production backstop.
      }
    }
    return {
      method: confirmed
        ? (treeKill.succeeded ? "taskkill-tree" : "lineage-quiescence")
        : (rootExitedBeforeFallback ? "natural-exit-race" : "process-kill"),
      confirmed,
      rootExitedBeforeFallback: rootUnavailableBeforeFallback,
      rootIdentityConfirmed,
      code: treeKill.code,
      detail: `taskkill exit=${treeKill.code ?? "none"}; lineage=${lineageConfirmed === true}: ${treeKill.output}`,
    };
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // The process group may already be gone.
    }
  }
  await delay(CHILD_STOP_GRACE_MS);
  if (processGroupExists(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // The process group may have closed during escalation.
      }
    }
  }
  const deadline = Date.now() + TREE_CLOSE_TIMEOUT_MS;
  while (processGroupExists(pid) && Date.now() < deadline) await delay(25);
  return {
    method: "process-group",
    confirmed: !processGroupExists(pid),
  };
}

export async function confirmNaturalBrowserClose(
  child,
  platform,
  env,
  taskkill,
  ownership = {},
) {
  if (platform === "win32") {
    const powershell = ownership.powershell ?? trustedWindowsPowerShell(env);
    const initialRows = Array.isArray(ownership.initialRows)
      ? ownership.initialRows
      : null;
    const confirmed = initialRows && powershell && taskkill
      ? await confirmWindowsLineageQuiescence({
          rootPid: child.pid,
          initialRows,
          env,
          powershell,
          taskkill,
        })
      : false;
    return {
      confirmed: confirmed === true,
      method: confirmed === true
        ? "natural-exit-lineage"
        : "natural-exit-unconfirmed",
    };
  }
  if (!processGroupExists(child.pid)) {
    return { confirmed: true, method: "natural-exit" };
  }
  const termination = await terminateOwnedBrowserTree(
    child,
    platform,
    env,
    taskkill,
  );
  return {
    confirmed: termination.confirmed,
    method: termination.method,
  };
}

function screenshotReceipt(args, stderr) {
  const screenshotArgument = args.find((entry) =>
    entry.startsWith("--screenshot="));
  if (!screenshotArgument) return undefined;
  const screenshotPath = screenshotArgument.slice("--screenshot=".length);
  const receipts = Array.from(
    stderr.matchAll(/(\d+)\s+bytes written to file\b/giu),
  );
  const receipt = receipts.at(-1);
  if (!receipt) return false;
  const expectedBytes = Number(receipt[1]);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) return false;
  try {
    const metadata = fs.statSync(screenshotPath);
    return metadata.isFile() && metadata.size === expectedBytes;
  } catch {
    return false;
  }
}

export function hasRenderedInteractiveVisualizerWebglFallback({ stdout }) {
  if (typeof stdout !== "string") return false;
  // Only attributes on the serialized document's first opening <html> tag are
  // authoritative. Inline scripts can contain exact fallback markup as inert
  // source, and stderr is process diagnostics rather than DOM evidence.
  const htmlTag = stdout.match(/<html\b[^>]*>/iu)?.[0] ?? "";
  return (
    /\bdata-breadboard-webgl-fallback=["']rendered["']/iu.test(htmlTag) &&
    /\bdata-breadboard-runtime-tests=["']failed["']/iu.test(htmlTag) &&
    !/\bdata-breadboard-webgl=["']ready["']/iu.test(stdout)
  );
}

function throwInteractiveVisualizerCancellation(signal, cleanupConfirmed) {
  const reason = signal?.reason ??
    new Error("Interactive visualizer was cancelled.");
  if (cleanupConfirmed) throw reason;
  throw new Error(`${reason instanceof Error ? reason.message : String(reason)} Browser process-tree cleanup was not confirmed.`);
}

export function appendBoundedBrowserOutput(current, chunk) {
  const next = current +
    (typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  if (next.length <= MAX_BROWSER_OUTPUT_CHARS) return next;
  const tailChars = MAX_BROWSER_OUTPUT_CHARS -
    BROWSER_OUTPUT_HEAD_CHARS -
    BROWSER_OUTPUT_TRUNCATION_MARKER.length;
  return next.slice(0, BROWSER_OUTPUT_HEAD_CHARS) +
    BROWSER_OUTPUT_TRUNCATION_MARKER +
    next.slice(-tailChars);
}

export function findInteractiveVisualizerBrowser(
  env = process.env,
  platform = process.platform,
) {
  const configured = String(env.BREADBOARD_VISUAL_BROWSER_PATH ?? "").trim();
  const candidates = platform === "win32"
    ? [
        configured,
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      ]
    : [
        configured,
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/google-chrome",
      ];
  return candidates.filter(Boolean).find(isDirectFile) ?? null;
}

/**
 * Keep one stable, trusted Node PID above Chromium so output observation can
 * race browser teardown without turning a reused raw browser PID into cleanup
 * authority. Callers that do not supply a direct executable get no wrapper and
 * must retain their ordinary spawn-error path.
 */
export function ownedBrowserWrapperInvocation(executable, args) {
  if (
    !isDirectFile(executable) ||
    !Array.isArray(args) ||
    args.some((entry) => typeof entry !== "string")
  ) return null;
  return {
    executable: process.execPath,
    args: [
      EXECUTOR_PATH,
      BROWSER_WRAPPER_ARGUMENT,
      executable,
      ...args,
    ],
  };
}

export async function runInteractiveVisualizerBrowserProcess({
  executable,
  args,
  timeoutMs,
  signal,
  env = process.env,
  completionKind,
}) {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("Interactive visualizer was cancelled.");
  }
  const platform = process.platform;
  const taskkill = platform === "win32"
    ? trustedWindowsTreeKiller(env)
    : null;
  const powershell = platform === "win32"
    ? trustedWindowsPowerShell(env)
    : null;
  if (platform === "win32" && (!taskkill || !powershell)) {
    fail("Trusted Windows process-tree termination and accounting are unavailable.");
  }
  let child;
  try {
    child = spawn(executable, args, {
      windowsHide: true,
      detached: platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw error;
  }
  // Record the wrapper identity and its already-started descendants while the
  // stable root is unquestionably resident. A completion frame can be queued
  // before Node observes `close`; under contention the root may disappear by
  // the time cleanup starts, so post-exit PID absence alone is never proof.
  const initialRowsPromise = platform === "win32"
    ? windowsProcessSnapshot(env, powershell)
    : Promise.resolve(null);
  let stdout = "";
  let stderr = "";
  let observed = false;
  let resolveObserved;
  const observedPromise = new Promise((resolve) => {
    resolveObserved = resolve;
  });
  const expectedCompletion = completionKind ??
    (args.some((entry) => entry === "--dump-dom")
      ? "dom"
      : (args.some((entry) => entry.startsWith("--screenshot="))
        ? "screenshot"
        : "process"));
  const inspectCompletion = () => {
    if (observed) return;
    const complete = expectedCompletion === "dom"
      ? /<\/html>\s*$/iu.test(stdout.trimEnd())
      : expectedCompletion === "screenshot"
        ? screenshotReceipt(args, stderr) === true
        : false;
    if (!complete) return;
    observed = true;
    resolveObserved({ kind: "observed" });
  };
  child.stdout?.on("data", (chunk) => {
    stdout = appendBoundedBrowserOutput(stdout, chunk);
    inspectCompletion();
  });
  child.stderr?.on("data", (chunk) => {
    stderr = appendBoundedBrowserOutput(stderr, chunk);
    inspectCompletion();
  });
  const closePromise = new Promise((resolve) => {
    child.once("close", (code, closeSignal) => resolve({
      kind: "close",
      code,
      signal: closeSignal,
    }));
  });
  const errorPromise = new Promise((resolve) => {
    child.once("error", (error) => resolve({ kind: "error", error }));
  });
  let resolveAbort;
  const abortPromise = new Promise((resolve) => {
    resolveAbort = resolve;
  });
  const onAbort = () => resolveAbort({ kind: "abort" });
  signal?.addEventListener("abort", onAbort, { once: true });
  let timeoutHandle;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  const initialRows = await initialRowsPromise;
  const ownership = { powershell, initialRows };
  const terminal = await Promise.race([
    closePromise,
    errorPromise,
    observedPromise,
    abortPromise,
    timeoutPromise,
  ]);
  clearTimeout(timeoutHandle);
  signal?.removeEventListener("abort", onAbort);
  if (terminal.kind === "close") {
    const cleanup = await confirmNaturalBrowserClose(
      child,
      platform,
      env,
      taskkill,
      ownership,
    );
    // A cancellation can settle while the early lineage snapshot is in flight,
    // leaving both close and abort promises ready when the race is observed.
    // Cleanup remains mandatory whichever ready promise wins iteration order.
    if (signal?.aborted) {
      throwInteractiveVisualizerCancellation(signal, cleanup.confirmed);
    }
    return {
      exitCode: cleanup.confirmed ? terminal.code : null,
      stdout,
      stderr,
      timedOut: false,
      cleanupConfirmed: cleanup.confirmed,
      cleanupMethod: cleanup.method,
    };
  }
  if (terminal.kind === "observed" && !signal?.aborted) {
    const naturallyClosed = await waitForClose(
      closePromise,
      NATURAL_BROWSER_CLOSE_GRACE_MS,
    );
    if (naturallyClosed?.kind === "close" && !signal?.aborted) {
      signal?.removeEventListener("abort", onAbort);
      const cleanup = await confirmNaturalBrowserClose(
        child,
        platform,
        env,
        taskkill,
        ownership,
      );
      return {
        exitCode: cleanup.confirmed ? naturallyClosed.code : null,
        stdout,
        stderr,
        timedOut: false,
        cleanupConfirmed: cleanup.confirmed,
        cleanupMethod: cleanup.method,
        cleanupCode: null,
      };
    }
  }
  const termination = await terminateOwnedBrowserTree(
    child,
    platform,
    env,
    taskkill,
    ownership,
  );
  const closed = await waitForClose(closePromise, TREE_CLOSE_TIMEOUT_MS);
  const cleanupConfirmed =
    termination.confirmed && closed?.kind === "close";
  if (!cleanupConfirmed) {
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
  if (terminal.kind === "abort" || signal?.aborted) {
    throwInteractiveVisualizerCancellation(signal, cleanupConfirmed);
  }
  if (terminal.kind === "error") {
    throw terminal.error;
  }
  const timedOut = terminal.kind === "timeout";
  if (timedOut) {
    stderr = appendBoundedBrowserOutput(stderr, "\nBrowser test timed out.");
  }
  if (!cleanupConfirmed) {
    stderr = appendBoundedBrowserOutput(
      stderr,
      `\nBrowser process-tree cleanup was not confirmed. ${termination.detail ?? ""}`,
    );
  }
  return {
    exitCode: terminal.kind === "observed" && cleanupConfirmed ? 0 : null,
    stdout,
    stderr,
    timedOut,
    cleanupConfirmed,
    cleanupMethod: termination.method,
    cleanupCode: termination.code ?? null,
  };
}

export async function removeOwnedBrowserProfile(
  outputDir,
  profilePath,
  dependencies = {},
) {
  const resolvedOutput = path.resolve(outputDir);
  const resolvedProfile = path.resolve(profilePath);
  if (!samePath(path.dirname(resolvedProfile), resolvedOutput)) {
    fail("The visualizer browser profile escaped its output directory.");
  }
  const metadata = fs.lstatSync(resolvedProfile);
  if (metadata.isSymbolicLink()) {
    fs.unlinkSync(resolvedProfile);
    return;
  }
  if (!metadata.isDirectory()) {
    fail("The visualizer browser profile changed type.");
  }
  const platform = dependencies.platform ?? process.platform;
  const remove = dependencies.remove ?? fs.rmSync;
  const now = dependencies.now ?? Date.now;
  const wait = dependencies.wait ?? delay;
  const deadline = now() + BROWSER_PROFILE_REMOVE_TIMEOUT_MS;
  let retries = 0;
  for (;;) {
    try {
      remove(resolvedProfile, {
        recursive: true,
        force: true,
        maxRetries: 0,
      });
      return;
    } catch (error) {
      const remainingMs = deadline - now();
      const retryable =
        platform === "win32" &&
        error &&
        typeof error === "object" &&
        TRANSIENT_WINDOWS_PROFILE_REMOVE_CODES.has(error.code);
      if (!retryable || remainingMs <= 0) throw error;
      const retryMs = Math.min(
        remainingMs,
        BROWSER_PROFILE_REMOVE_RETRY_BASE_MS * (2 ** Math.min(retries, 3)),
        BROWSER_PROFILE_REMOVE_RETRY_MAX_MS,
      );
      retries += 1;
      await wait(retryMs);
    }
  }
}

async function runIsolatedBrowser({
  executable,
  args,
  timeoutMs,
  signal,
  outputDir,
}) {
  const profilePath = fs.mkdtempSync(path.join(
    path.resolve(outputDir),
    ".browser-profile-",
  ));
  let result;
  try {
    const wrapper = ownedBrowserWrapperInvocation(executable, [
      `--user-data-dir=${profilePath}`,
      "--disable-background-mode",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-sync",
      "--run-all-compositor-stages-before-draw",
      ...args,
    ]);
    if (!wrapper) fail("The isolated visualizer browser launch is invalid.");
    result = await runInteractiveVisualizerBrowserProcess({
      executable: wrapper.executable,
      args: wrapper.args,
      timeoutMs,
      signal,
    });
  } finally {
    try {
      await removeOwnedBrowserProfile(outputDir, profilePath);
    } catch (error) {
      if (!result) throw error;
      result.cleanupConfirmed = false;
      result.stderr = appendBoundedBrowserOutput(
        result.stderr,
        `\nBrowser profile cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}

async function runBrowserWrapper() {
  const executable = process.argv[3];
  const args = process.argv.slice(4);
  if (!executable || !isDirectFile(executable) || args.length < 1) {
    fail("The isolated visualizer browser launch is invalid.");
  }
  const child = spawn(executable, args, {
    windowsHide: true,
    detached: false,
    stdio: ["ignore", "inherit", "inherit"],
  });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  // Keep this stable wrapper PID alive briefly after Chromium closes. Output
  // can arrive one event-loop turn before the child's close record on Windows;
  // the hold prevents PID reuse and gives the owner a deterministic root for
  // its exact /PID /T shutdown without extending the browser's own lifetime.
  await delay(WRAPPER_EXIT_HOLD_MS);
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exitCode = result.code ?? 1;
}

export async function runInteractiveVisualizerBrowserTestsInWorker({
  html,
  mode,
  outputDir,
  timeoutMs = 22_000,
  browserPath,
  signal,
}) {
  const browser = browserPath ?? findInteractiveVisualizerBrowser();
  const checkedAt = new Date().toISOString();
  if (!browser) {
    return {
      passed: false,
      checkedAt,
      viewports: [],
      checks: [{
        name: "browser availability",
        passed: false,
        detail: "No configured Chromium or Microsoft Edge executable was found.",
      }],
      screenshotCreated: false,
    };
  }
  if (typeof html !== "string" || Buffer.byteLength(html, "utf8") > 10_000_000) {
    fail("The interactive visualizer browser input is outside its bound.");
  }
  if (!["2d", "3d", "hybrid"].includes(mode)) {
    fail("The interactive visualizer browser mode is invalid.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 90_000) {
    fail("The interactive visualizer browser timeout is invalid.");
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const htmlPath = path.join(outputDir, "candidate.html");
  fs.writeFileSync(htmlPath, html, { encoding: "utf8", flag: "wx" });
  const scenarios = [
    { name: "375x667 light", width: 375, height: 667, flags: [] },
    { name: "1280x800 dark", width: 1280, height: 800, flags: ["--force-dark-mode"] },
    {
      name: "1280x800 reduced-motion",
      width: 1280,
      height: 800,
      flags: ["--force-prefers-reduced-motion"],
    },
  ];
  const checks = [];
  const externalReference =
    /(?:src|href)\s*=\s*["']https?:|url\(\s*["']?https?:/i.test(html);
  checks.push({
    name: "offline bundle",
    passed: !externalReference && html.includes("connect-src 'none'"),
    detail: externalReference
      ? "The compiled document contains an external resource reference."
      : "Self-contained bundle with network denied by CSP.",
  });
  const url = `${pathToFileURL(htmlPath).href}?test=1&channel=browser-gate`;
  for (const scenario of scenarios) {
    const result = await runIsolatedBrowser({
      executable: browser,
      timeoutMs,
      signal,
      outputDir,
      args: [
        "--headless=new",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-component-update",
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        "--disable-dev-shm-usage",
        ...(mode !== "2d"
          ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
          : ["--disable-gpu"]),
        ...scenario.flags,
        `--window-size=${scenario.width},${scenario.height}`,
        "--virtual-time-budget=3000",
        "--dump-dom",
        url,
      ],
    });
    const output = `${result.stdout}\n${result.stderr}`;
    const passed =
      !result.timedOut &&
      result.exitCode === 0 &&
      result.cleanupConfirmed &&
      output.includes('data-breadboard-runtime-tests="passed"') &&
      output.includes('data-breadboard-interaction-tests="passed"') &&
      !output.includes('data-breadboard-overflow="true"') &&
      (mode === "2d" || output.includes('data-breadboard-webgl="ready"'));
    checks.push({
      name: `browser mount ${scenario.name}`,
      passed,
      detail: passed
        ? `mounted, exercised controls, and passed runtime checks; process tree closed with ${result.cleanupMethod}`
        : [
            `exit=${result.exitCode ?? "none"}`,
            `timedOut=${result.timedOut}`,
            `cleanup=${result.cleanupConfirmed}`,
            `cleanupMethod=${result.cleanupMethod}`,
            `cleanupCode=${result.cleanupCode ?? "none"}`,
            `runtime=${output.includes('data-breadboard-runtime-tests="passed"')}`,
            `interaction=${output.includes('data-breadboard-interaction-tests="passed"')}`,
            `overflow=${output.includes('data-breadboard-overflow="true"')}`,
            `webgl=${output.includes('data-breadboard-webgl="ready"')}`,
            output.match(/<html[^>]*>/i)?.[0] ?? output.slice(-500),
          ].join("; "),
    });
  }
  if (mode !== "2d") {
    const fallback = await runIsolatedBrowser({
      executable: browser,
      timeoutMs,
      signal,
      outputDir,
      args: [
        "--headless=new",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-3d-apis",
        "--disable-webgl",
        "--disable-webgl2",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--no-first-run",
        "--window-size=900,640",
        "--virtual-time-budget=2000",
        "--dump-dom",
        `${pathToFileURL(htmlPath).href}?test=1&channel=webgl-fallback`,
      ],
    });
    const output = `${fallback.stdout}\n${fallback.stderr}`;
    const renderedFallback = hasRenderedInteractiveVisualizerWebglFallback({
      stdout: fallback.stdout,
    });
    const passed =
      !fallback.timedOut &&
      fallback.exitCode === 0 &&
      fallback.cleanupConfirmed &&
      renderedFallback;
    checks.push({
      name: "WebGL unavailable fallback",
      passed,
      detail: passed
        ? `Accessible fallback rendered with WebGL disabled; process tree closed with ${fallback.cleanupMethod}.`
        : [
            `exit=${fallback.exitCode ?? "none"}`,
            `timedOut=${fallback.timedOut}`,
            `cleanup=${fallback.cleanupConfirmed}`,
            `cleanupMethod=${fallback.cleanupMethod}`,
            `cleanupCode=${fallback.cleanupCode ?? "none"}`,
            `fallback=${renderedFallback}`,
            `runtime=${output.includes('data-breadboard-runtime-tests="passed"')}`,
            `interaction=${output.includes('data-breadboard-interaction-tests="passed"')}`,
            output.match(/<html[^>]*>/i)?.[0] ?? output.slice(-500),
          ].join("; "),
    });
  }
  let screenshotCreated = true;
  for (const preview of [
    { name: "desktop", width: 1000, height: 720 },
    { name: "mobile", width: 375, height: 667 },
  ]) {
    const screenshotPath = path.join(outputDir, `${preview.name}.png`);
    const screenshot = await runIsolatedBrowser({
      executable: browser,
      timeoutMs,
      signal,
      outputDir,
      args: [
        "--headless=new",
        "--disable-extensions",
        "--disable-background-networking",
        "--no-first-run",
        "--hide-scrollbars",
        "--disable-dev-shm-usage",
        ...(mode !== "2d"
          ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
          : ["--disable-gpu"]),
        `--window-size=${preview.width},${preview.height}`,
        "--virtual-time-budget=3000",
        `--screenshot=${screenshotPath}`,
        `${pathToFileURL(htmlPath).href}?test=1&channel=browser-screenshot`,
      ],
    });
    const created =
      !screenshot.timedOut &&
      screenshot.exitCode === 0 &&
      screenshot.cleanupConfirmed &&
      fs.existsSync(screenshotPath) &&
      fs.statSync(screenshotPath).size > 0;
    screenshotCreated = screenshotCreated && created;
    checks.push({
      name: `${preview.name} preview screenshot`,
      passed: created,
      detail: created
        ? `created; process tree closed with ${screenshot.cleanupMethod}`
        : (screenshot.stderr || "Screenshot was not created.").slice(-700),
    });
  }
  return {
    passed: checks.every((check) => check.passed),
    checkedAt,
    viewports: scenarios.map((scenario) => scenario.name),
    checks,
    screenshotCreated,
  };
}

export async function executeInteractiveVisualizerPublication({
  plan,
  packageValue,
  outputDir,
  modules,
  timeoutMs,
  browserPath,
  signal,
  onStage = () => {},
}) {
  onStage("preparing", 0, 4);
  const custom = modules.custom.isCustomInteractiveVisualizerPackage(packageValue);
  const compiled = custom
    ? (() => {
        const value = modules.custom.compileCustomInteractiveVisualizerPackage(
          plan,
          packageValue,
        );
        return {
          manifest: value.manifest,
          validation: value.validation,
          sourceHash: value.sourceHash,
          customPackage: value.package,
          definition: null,
          html: "",
          css: "",
        };
      })()
    : {
        ...modules.validator.compileInteractiveVisualizerPackage(
          plan,
          packageValue,
        ),
        customPackage: null,
      };
  if (
    !compiled.validation.valid ||
    !compiled.manifest ||
    (!compiled.customPackage && !compiled.definition)
  ) {
    return {
      status: "validation-failed",
      validation: compiled.validation,
      manifest: null,
      sourceHash: null,
      tests: null,
      bundleHash: null,
      outputPath: null,
      customPackage: custom,
    };
  }
  if (signal?.aborted) {
    throw signal.reason ?? new Error("Interactive visualizer was cancelled.");
  }
  onStage("generating", 1, 4);
  const bundle = compiled.customPackage
    ? await modules.custom.bundleCustomInteractiveVisualizer(
        compiled.customPackage,
      )
    : await modules.runtime.bundleInteractiveVisualizer({
        definition: compiled.definition,
        manifest: compiled.manifest,
        html: compiled.html,
        css: compiled.css,
      });
  onStage("processing", 2, 4);
  const tests = await runInteractiveVisualizerBrowserTestsInWorker({
    html: bundle.html,
    mode: compiled.manifest.mode,
    outputDir,
    timeoutMs,
    browserPath,
    signal,
  });
  if (!tests.passed) {
    return {
      status: "browser-failed",
      validation: compiled.validation,
      manifest: compiled.manifest,
      sourceHash: compiled.sourceHash,
      tests,
      bundleHash: bundle.hash,
      outputPath: null,
      customPackage: custom,
    };
  }
  onStage("persisting", 3, 4);
  const outputPath = path.join(outputDir, "bundle.html");
  fs.writeFileSync(outputPath, bundle.html, { encoding: "utf8", flag: "wx" });
  onStage("finalizing", 4, 4);
  return {
    status: "ready",
    validation: compiled.validation,
    manifest: compiled.manifest,
    sourceHash: compiled.sourceHash,
    tests,
    bundleHash: bundle.hash,
    outputPath,
    customPackage: custom,
  };
}

const invokedAsBrowserWrapper =
  typeof process.argv[1] === "string" &&
  samePath(process.argv[1], EXECUTOR_PATH) &&
  process.argv[2] === BROWSER_WRAPPER_ARGUMENT;
if (invokedAsBrowserWrapper) {
  void runBrowserWrapper().catch((error) => {
    process.exitCode = 1;
    fs.writeSync(
      2,
      `[interactive-visualizer-browser-wrapper] ${error instanceof Error ? error.message : String(error)}\n`,
      undefined,
      "utf8",
    );
  });
}
