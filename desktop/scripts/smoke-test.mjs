// Installed-application smoke test.
//
// Usage: node scripts/smoke-test.mjs "<installed Breadboard.exe>" "<isolated user-data dir>" [results.json]
//
// Launches the installed app, discovers the dynamically allocated ports from
// the desktop log, exercises the running stack over HTTP (health, register,
// login, cluster creation, ingestion, Quartz, OpenHarness surfaces), restarts
// the app to verify persistence, and verifies complete process-tree cleanup.
//
// This drives the real installed binary — it does not import any repo code.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exePath = process.argv[2];
const userData = process.argv[3];
const resultsFile = process.argv[4] ? path.resolve(process.argv[4]) : null;
if (!exePath || !fs.existsSync(exePath)) {
  console.error(
    "Usage: node scripts/smoke-test.mjs <path-to-Breadboard.exe> <isolated-user-data-dir> [results.json]",
  );
  process.exit(2);
}
if (!userData || !path.isAbsolute(userData)) {
  console.error("The smoke test requires an absolute isolated user-data directory.");
  process.exit(2);
}

const desktopLog = path.join(userData, "Data", "logs", "desktop.log");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const results = [];
let failures = 0;
let appPid = null;

function record(name, ok, detail = "") {
  results.push({ name, ok, detail, checkedAt: new Date().toISOString() });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOk(url, options = {}, timeoutMs = 5000) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    return response;
  } catch {
    return null;
  }
}

const endpointsFile = path.join(userData, "Data", "runtime", "endpoints.json");

/**
 * Read the endpoints this launch published. Using the app's own file (rather
 * than assuming 3000/8765/…) is what keeps the checks pointed at the desktop
 * instance even when a developer's dev stack occupies the default ports.
 */
function readEndpoints(minStartedAt) {
  try {
    const parsed = JSON.parse(fs.readFileSync(endpointsFile, "utf8"));
    if (minStartedAt && new Date(parsed.startedAt).getTime() < minStartedAt) return null;
    return parsed.urls ?? null;
  } catch {
    return null;
  }
}

/**
 * Processes belonging to the *installed* app: anything running from the
 * install directory, or any process whose command line references the app's
 * user-data tree (services run with cwd inside it). Deliberately narrow so a
 * developer's own dev stack — or this script's shells, whose paths contain the
 * repo name — is not misreported as a leftover.
 */
function breadboardProcesses() {
  const installDir = path.dirname(exePath);
  const dataDir = userData;
  const out = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `$install='${installDir.replace(/'/g, "''")}'; $data='${dataDir.replace(/'/g, "''")}'; ` +
        `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.ProcessId -ne $PID -and (($_.ExecutablePath -and $_.ExecutablePath.StartsWith($install)) -or ($_.CommandLine -and $_.CommandLine.Contains($data))) } | ` +
        `Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8" },
  );
  try {
    const parsed = JSON.parse(out.stdout.trim() || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function launchApp() {
  const appEnv = { ...process.env };
  delete appEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    exePath,
    [`--breadboard-user-data-dir=${userData}`],
    { detached: true, stdio: "ignore", env: appEnv },
  );
  appPid = child.pid ?? null;
  child.unref();
}

function closeApp() {
  if (appPid !== null) {
    spawnSync("taskkill", ["/pid", String(appPid)], { encoding: "utf8" });
  }
}

function forceCloseApp() {
  if (appPid !== null) {
    spawnSync("taskkill", ["/f", "/t", "/pid", String(appPid)], { encoding: "utf8" });
  }
}

function mainWindowInfo() {
  if (appPid === null) return null;
  const output = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Get-Process -Id ${appPid} -ErrorAction SilentlyContinue | ` +
        `Select-Object Id,MainWindowHandle,MainWindowTitle,Responding | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8" },
  );
  try {
    return JSON.parse(output.stdout.trim());
  } catch {
    return null;
  }
}

function writeResults(exitCode) {
  const summary = {
    executable: exePath,
    installDirectory: path.dirname(exePath),
    userData,
    desktopLog,
    passed: results.length - failures,
    failed: failures,
    total: results.length,
    exitCode,
    finishedAt: new Date().toISOString(),
    checks: results,
  };
  if (resultsFile) {
    fs.mkdirSync(path.dirname(resultsFile), { recursive: true });
    fs.writeFileSync(resultsFile, JSON.stringify(summary, null, 2));
  }
  return summary;
}

async function waitForReady(maxMs, minStartedAt) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const urls = readEndpoints(minStartedAt);
    if (urls) {
      const health = await fetchOk(`${urls.dashboard}/api/health`);
      if (health?.ok) return urls;
    }
    await delay(2000);
  }
  return null;
}

async function main() {
  const launchedAt = Date.now();

  console.log(`[smoke] launching ${exePath}`);
  launchApp();

  const urls = await waitForReady(15 * 60 * 1000, launchedAt);
  record("app becomes ready (all required services healthy)", urls !== null);
  if (!urls) {
    forceCloseApp();
    writeResults(1);
    process.exit(1);
  }
  console.log(`[smoke] endpoints: ${JSON.stringify(urls)}`);

  const managedProcesses = breadboardProcesses();
  const repositoryReferences = managedProcesses.filter((entry) =>
    [entry.ExecutablePath, entry.CommandLine].some(
      (value) => typeof value === "string" && value.toLowerCase().includes(repoRoot.toLowerCase()),
    ),
  );
  record(
    "installed processes do not reference the repository checkout",
    repositoryReferences.length === 0,
    repositoryReferences.map((entry) => `${entry.Name}(${entry.ProcessId})`).join(", "),
  );

  const base = urls.dashboard;

  const windowInfo = mainWindowInfo();
  record(
    "installed main window is visible and responding",
    Boolean(windowInfo?.MainWindowHandle) && windowInfo?.Responding === true,
    windowInfo ? JSON.stringify(windowInfo) : "no window process information",
  );

  const dashboardPage = await fetchOk(`${base}/`, {}, 15_000);
  const dashboardHtml = dashboardPage?.ok ? await dashboardPage.text() : "";
  record(
    "dashboard HTML renders from the packaged server",
    dashboardPage?.ok === true && /<html/i.test(dashboardHtml),
    `status ${dashboardPage?.status}, ${dashboardHtml.length} bytes`,
  );
  const staticMatch = dashboardHtml.match(/["'](\/_next\/static\/[^"']+)["']/);
  const staticAsset = staticMatch ? await fetchOk(`${base}${staticMatch[1]}`, {}, 15_000) : null;
  record(
    "packaged Next.js static asset loads",
    staticAsset?.ok === true,
    staticMatch?.[1] ?? "no static asset reference found",
  );

  // Quartz serves the garden.
  const quartz = await fetchOk(`${urls.quartz}/`, {}, 10000);
  record("Quartz garden responds", quartz !== null && quartz.ok);

  // ChatMock health.
  const chatmock = await fetchOk(`${urls.chatmock}/health`);
  record("ChatMock healthy", chatmock !== null && chatmock.ok);

  // OpenHarness answers (401 without credentials is a valid liveness signal).
  const openharness = await fetchOk(`${urls.openharness}/global/health`);
  record(
    "OpenHarness reachable (auth enforced)",
    openharness !== null && (openharness.status === 401 || openharness.ok),
    `status ${openharness?.status}`,
  );

  // Auth: registration is invite-only; the desktop seeds an initial invite
  // code recorded in its config file.
  let inviteCode = null;
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(userData, "Data", "config", "desktop-config.json"), "utf8"),
    );
    inviteCode = config.initialInviteCode ?? null;
  } catch {
    inviteCode = null;
  }
  record("initial invite code exists in desktop config", inviteCode !== null);
  const username = `smoke${Date.now().toString(36)}`;
  const email = `${username}@local.test`;
  const password = "Smoke-test-1234";
  const register = await fetchOk(`${base}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, email, inviteCode }),
  });
  record(
    "account registration succeeds with the seeded invite code",
    register !== null && register.ok,
    `status ${register?.status}`,
  );

  // NextAuth credentials sign-in (CSRF + callback), collecting cookies.
  const jar = new Map();
  const collect = (response) => {
    const setCookies = response?.headers?.getSetCookie?.() ?? [];
    for (const cookie of setCookies) {
      const [pair] = cookie.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  };
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

  const csrfResponse = await fetchOk(`${base}/api/auth/csrf`);
  collect(csrfResponse);
  const csrf = csrfResponse ? (await csrfResponse.json()).csrfToken : null;
  let sessionUser = null;
  if (csrf) {
    const login = await fetchOk(`${base}/api/auth/callback/credentials`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader(),
      },
      body: new URLSearchParams({ csrfToken: csrf, email, password, json: "true" }).toString(),
      redirect: "manual",
    });
    collect(login);
    const session = await fetchOk(`${base}/api/auth/session`, { headers: { Cookie: cookieHeader() } });
    if (session?.ok) {
      const parsed = await session.json();
      sessionUser = parsed?.user?.name ?? null;
    }
  }
  record("credentials login yields a session", sessionUser !== null, `user ${sessionUser}`);

  // Cluster creation + ingestion (authenticated API).
  let clusterOk = false;
  let ingestOk = false;
  let clusterSlug = null;
  if (sessionUser) {
    const clusterResponse = await fetchOk(
      `${base}/api/clusters`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
        body: JSON.stringify({ name: `Smoke Garden ${Date.now() % 1000}` }),
      },
      30000,
    );
    if (clusterResponse?.ok) {
      const cluster = await clusterResponse.json();
      clusterSlug = cluster?.slug ?? null;
      clusterOk = clusterSlug !== null;
    }
    if (clusterOk) {
      const markdown = "# Smoke Note\n\nA tiny ingestion check for the installed app.\n";
      const form = new FormData();
      form.append("file", new Blob([markdown], { type: "text/markdown" }), "smoke-note.md");
      form.append("clusterSlug", clusterSlug);
      form.append("generateMap", "false");
      const ingest = await fetchOk(
        `${base}/api/ingest`,
        { method: "POST", headers: { Cookie: cookieHeader() }, body: form },
        120000,
      );
      const ingestBody = ingest ? await ingest.text() : "";
      ingestOk = ingest?.ok === true && /"type":"result"/.test(ingestBody);
      if (!ingestOk) {
        console.log(`[smoke] ingest status ${ingest?.status}: ${ingestBody.slice(0, 500)}`);
      }
    }
  }
  record("cluster creation", clusterOk, clusterSlug ?? "");
  record("markdown ingestion", ingestOk);

  // The source appears under sources/ in the user-data content tree.
  if (clusterSlug) {
    const sourcesDir = path.join(userData, "Data", "quartz", "content", clusterSlug, "sources");
    const found =
      fs.existsSync(sourcesDir) && fs.readdirSync(sourcesDir).some((name) => name.endsWith(".md"));
    record("ingested source exists under sources/", found, sourcesDir);
  }

  // Restart: quit, verify cleanup, relaunch, verify persistence.
  closeApp();
  await delay(30000);
  let leftovers = breadboardProcesses();
  if (leftovers.length > 0) {
    await delay(30000);
    leftovers = breadboardProcesses();
  }
  record(
    "quit leaves no managed processes",
    leftovers.length === 0,
    leftovers.map((p) => `${p.Name}(${p.ProcessId})`).join(", "),
  );

  const relaunchedAt = Date.now();
  launchApp();
  const urls2 = await waitForReady(10 * 60 * 1000, relaunchedAt);
  record("second launch becomes ready", urls2 !== null);
  if (urls2 && sessionUser) {
    const base2 = urls2.dashboard;
    // The account persisted: a fresh login must succeed.
    const jar2 = new Map();
    const collect2 = (response) => {
      for (const cookie of response?.headers?.getSetCookie?.() ?? []) {
        const [pair] = cookie.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) jar2.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    };
    const csrf2Response = await fetchOk(`${base2}/api/auth/csrf`);
    collect2(csrf2Response);
    const csrf2 = csrf2Response ? (await csrf2Response.json()).csrfToken : null;
    let persisted = false;
    if (csrf2) {
      const login2 = await fetchOk(`${base2}/api/auth/callback/credentials`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: [...jar2.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
        },
        body: new URLSearchParams({ csrfToken: csrf2, email, password, json: "true" }).toString(),
        redirect: "manual",
      });
      collect2(login2);
      const session2 = await fetchOk(`${base2}/api/auth/session`, {
        headers: { Cookie: [...jar2.entries()].map(([k, v]) => `${k}=${v}`).join("; ") },
      });
      if (session2?.ok) persisted = (await session2.json())?.user?.name != null;
    }
    record("database persists across restart (login works)", persisted);
    if (clusterSlug) {
      const contentDir = path.join(userData, "Data", "quartz", "content", clusterSlug);
      record("user files persist across restart", fs.existsSync(contentDir));
    }
  }

  closeApp();
  await delay(30000);
  let finalLeftovers = breadboardProcesses();
  if (finalLeftovers.length > 0) {
    await delay(30000);
    finalLeftovers = breadboardProcesses();
    if (finalLeftovers.length > 0) forceCloseApp();
  }
  record("final quit leaves no managed processes", finalLeftovers.length === 0);

  let fatalLogLines = [];
  if (fs.existsSync(desktopLog)) {
    fatalLogLines = fs
      .readFileSync(desktopLog, "utf8")
      .split(/\r?\n/)
      .filter((line) => /fatal startup error|installation is incomplete|could not start/i.test(line));
  }
  record(
    "desktop log contains no fatal startup errors",
    fatalLogLines.length === 0,
    fatalLogLines.slice(-3).join(" | "),
  );

  console.log(`\n[smoke] ${results.length - failures}/${results.length} checks passed`);
  const exitCode = failures === 0 ? 0 : 1;
  writeResults(exitCode);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error("[smoke] fatal:", error);
  record("smoke test completed without an uncaught error", false, error instanceof Error ? error.message : String(error));
  forceCloseApp();
  writeResults(1);
  process.exit(1);
});
