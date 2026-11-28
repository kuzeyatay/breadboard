// Installed-application smoke test.
//
// Usage: node scripts/smoke-test.mjs "<installed Breadboard.exe>" "<isolated user-data dir>" [results.json]
//
// Launches the installed app, discovers the dynamically allocated ports from
// the desktop log, exercises the running stack over HTTP (health, register,
// login, cluster creation, ingestion, Quartz, Hermes surfaces), restarts
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
const runInteractiveVisualizerSmoke =
  process.env.BREADBOARD_SMOKE_INTERACTIVE_VISUALIZER === "true";
const interactiveVisualizerEvidence = [];

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
        `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.ProcessId -ne ${process.ppid} -and $_.ProcessId -ne $PID -and (($_.ExecutablePath -and $_.ExecutablePath.StartsWith($install)) -or ($_.CommandLine -and $_.CommandLine.Contains($data))) } | ` +
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

// Quit like a person clicking X: send WM_CLOSE to the app's visible main
// window. `taskkill /pid` without /f posts it to whichever top-level window of
// the process it enumerates first, usually a hidden helper (dictation, voice,
// visible-region) that rightly ignores it, and Process.CloseMainWindow picks a
// window heuristically, which also missed on a later run. Either way the app
// never heard a quit, and every later check failed with it.
const CLOSE_MAIN_WINDOW_PS = String.raw`
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class BreadboardSmokeWindows {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static int CloseMain(uint target) {
    int closed = 0;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != target || !IsWindowVisible(h)) return true;
      var title = new StringBuilder(256); GetWindowText(h, title, 256);
      if (!string.Equals(title.ToString(), "Breadboard", StringComparison.OrdinalIgnoreCase)) return true;
      PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); closed++; return true;
    }, IntPtr.Zero);
    return closed;
  }
}
"@
`;

function closeApp() {
  if (appPid !== null) {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        CLOSE_MAIN_WINDOW_PS +
          `$n = [BreadboardSmokeWindows]::CloseMain(${appPid}); ` +
          `if ($n -eq 0) { $p = Get-Process -Id ${appPid} -ErrorAction SilentlyContinue; if ($p) { [void]$p.CloseMainWindow() } }; ` +
          `Write-Output "closed $n"`,
      ],
      { encoding: "utf8" },
    );
    console.log(`[smoke] main window close: ${(result.stdout ?? "").trim() || (result.stderr ?? "").trim()}`);
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

async function exerciseInteractiveVisualizer({
  base,
  cookie,
  title,
  prompt,
  expectedMode,
}) {
  const headers = {
    "Content-Type": "application/json",
    Cookie: cookie,
  };
  const create = await fetchOk(`${base}/api/hermes/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ surface: "dashboard_terminal", title }),
  }, 30_000);
  const created = create?.ok ? await create.json().catch(() => null) : null;
  const conversationId = created?.session?.id ?? null;
  record(
    `${title}: authenticated Terminal conversation is created`,
    typeof conversationId === "string" && conversationId.length > 0,
    `status ${create?.status}`,
  );
  if (!conversationId) return null;

  const clientMessageId = `smoke-visualizer-${Date.now()}-${expectedMode}`;
  const turn = await fetchOk(
    `${base}/api/hermes/sessions/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        text: prompt,
        clientMessageId,
        surface: "dashboard_terminal",
        surfaceContext: {},
      }),
    },
    90_000,
  );
  const turnBody = turn?.ok ? await turn.json().catch(() => null) : null;
  record(
    `${title}: visualization prompt is accepted`,
    turn?.ok === true && turnBody?.accepted === true,
    `status ${turn?.status}; run ${typeof turnBody?.runId === "string" ? "created" : "missing"}`,
  );
  if (!turn?.ok || turnBody?.accepted !== true) return null;

  // The real UI opens this stream immediately. Draining it here starts the
  // server-owned detached pump, so Hermes events are normalized/persisted and
  // the assistant message reaches a terminal state even though this harness
  // polls the artifact archive separately.
  const streamController = new AbortController();
  const eventDrain = fetch(
    `${base}/api/hermes/sessions/${encodeURIComponent(conversationId)}/events?surface=dashboard_terminal`,
    {
      headers: { Accept: "text/event-stream", Cookie: cookie },
      signal: streamController.signal,
    },
  ).then(async (response) => {
    if (!response.ok || !response.body) {
      throw new Error(`event stream failed (${response.status})`);
    }
    const reader = response.body.getReader();
    while (true) {
      const next = await reader.read();
      if (next.done) return;
    }
  }).catch((error) => {
    if (!streamController.signal.aborted) throw error;
  });
  const stopEventDrain = async () => {
    streamController.abort();
    await eventDrain.catch(() => undefined);
  };

  const deadline = Date.now() + 12 * 60_000;
  let artifact = null;
  while (Date.now() < deadline) {
    const listing = await fetchOk(
      `${base}/api/hermes/artifacts?conversationId=${encodeURIComponent(conversationId)}&sourceSurface=dashboard_terminal`,
      { headers: { Cookie: cookie } },
      15_000,
    );
    const body = listing?.ok ? await listing.json().catch(() => null) : null;
    artifact = Array.isArray(body?.artifacts)
      ? body.artifacts.find((item) => item?.renderer === "interactive-visualizer") ?? null
      : null;
    if (artifact?.status === "ready" || artifact?.status === "failed") break;
    await delay(2_000);
  }

  const manifestMode = artifact?.metadata?.interactiveVisualizer?.manifest?.mode;
  record(
    `${title}: validated artifact reaches Ready`,
    artifact?.status === "ready",
    artifact ? `status ${artifact.status}; version ${artifact.version}` : "no artifact published",
  );
  record(
    `${title}: automatic mode selection is ${expectedMode}`,
    manifestMode === expectedMode && artifact?.sourceSkill === "interactive-visualizer",
    `mode ${manifestMode ?? "missing"}; skill ${artifact?.sourceSkill ?? "missing"}`,
  );
  if (artifact?.status !== "ready") {
    await stopEventDrain();
    return null;
  }

  const preview = await fetchOk(
    `${base}/api/hermes/artifacts/${encodeURIComponent(artifact.id)}/preview?conversationId=${encodeURIComponent(conversationId)}`,
    { headers: { Cookie: cookie } },
    30_000,
  );
  const previewHtml = preview?.ok ? await preview.text() : "";
  const csp = preview?.headers.get("content-security-policy") ?? "";
  const runtimePresent =
    previewHtml.includes("breadboard:interactive-visualizer:v1") &&
    previewHtml.includes("breadboardRuntimeTests");
  const modeRuntimePresent = expectedMode === "3d"
    ? /WebGLRenderer|breadboardWebgl/.test(previewHtml)
    : !previewHtml.includes('from "three"');
  record(
    `${title}: packaged preview is served by the Breadboard artifact route`,
    preview?.ok === true && runtimePresent && modeRuntimePresent,
    `status ${preview?.status}; ${previewHtml.length} bytes`,
  );
  record(
    `${title}: packaged preview retains the network-denying CSP`,
    /connect-src 'none'/.test(csp) && /default-src 'none'/.test(csp),
    csp ? "CSP present" : "CSP missing",
  );

  const evidence = {
    conversationId,
    artifactId: artifact.id,
    version: artifact.version,
    mode: manifestMode,
    contentHash: artifact.contentHash,
  };
  interactiveVisualizerEvidence.push(evidence);
  await stopEventDrain();
  return evidence;
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

  // The selected agent runtime is intentionally server-only. Its loopback
  // endpoint and credential must never be published in endpoints.json.
  record(
    "agent runtime endpoint is not published to the renderer",
    urls.hermes === undefined,
    `published keys ${Object.keys(urls).sort().join(",")}`,
  );


  // Auth: a fresh install sets up its one account from the sign-in page, with
  // a name and a password or PIN. After that there is no second account.
  const firstLogin = await fetchOk(`${base}/auth/login`);
  record("sign-in page shows first-time setup", firstLogin?.status === 200, `status ${firstLogin?.status}`);
  const password = "Smoke-test-1234";
  const register = await fetchOk(`${base}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Smoke Test", password }),
  });
  record("first-time setup creates the account", register !== null && register.ok, `status ${register?.status}`);
  const second = await fetchOk(`${base}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Someone Else", password }),
  });
  record("a second account is refused", second?.status === 409, `status ${second?.status}`);

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
      body: new URLSearchParams({ csrfToken: csrf, password, json: "true" }).toString(),
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
  let runtimeHealth = null;
  let runtimeHealthBody = null;
  for (const deadline = Date.now() + 5 * 60 * 1000; sessionUser && Date.now() < deadline; await delay(3000)) {
    // GET only reports an on-demand Hermes as "available-but-stopped"; POST is
    // the Terminal's connect path, which asks the supervisor to start it.
    runtimeHealth = await fetchOk(`${base}/api/hermes/health`, {
      method: "POST",
      headers: { Cookie: cookieHeader(), Origin: base },
    }, 120_000);
    runtimeHealthBody = runtimeHealth?.ok ? await runtimeHealth.json().catch(() => null) : null;
    if (runtimeHealthBody?.healthy === true) break;
  }
  record(
    "Hermes is healthy through the existing authenticated runtime API",
    runtimeHealthBody?.healthy === true && runtimeHealthBody?.runtime === "hermes",
    runtimeHealthBody
      ? `runtime ${runtimeHealthBody.runtime}; version ${runtimeHealthBody.version}`
      : `status ${runtimeHealth?.status}`,
  );

  if (runInteractiveVisualizerSmoke && sessionUser) {
    await exerciseInteractiveVisualizer({
      base,
      cookie: cookieHeader(),
      title: "2D double pendulum",
      expectedMode: "2d",
      prompt:
        "Show me how a double pendulum works. Let me change gravity, both arm lengths, both masses and animation speed.",
    });
    await exerciseInteractiveVisualizer({
      base,
      cookie: cookieHeader(),
      title: "3D Moon orbit",
      expectedMode: "3d",
      prompt:
        "Create an interactive 3D model showing how the Moon orbits Earth. Let me rotate the camera and change initial velocity and gravity.",
    });
  } else if (runInteractiveVisualizerSmoke) {
    record(
      "interactive visualizer packaged scenarios can authenticate",
      false,
      "credentials session unavailable",
    );
  }

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

  // GBrain was removed: nothing may publish or start it.
  record("GBrain is not running (removed)", !urls.gbrain, urls.gbrain ?? "no gbrain endpoint");

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
        body: new URLSearchParams({ csrfToken: csrf2, password, json: "true" }).toString(),
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
    for (const evidence of interactiveVisualizerEvidence) {
      const restored = await fetchOk(
        `${base2}/api/hermes/artifacts/${encodeURIComponent(evidence.artifactId)}?conversationId=${encodeURIComponent(evidence.conversationId)}`,
        {
          headers: {
            Cookie: [...jar2.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
          },
        },
        30_000,
      );
      const restoredBody = restored?.ok ? await restored.json().catch(() => null) : null;
      record(
        `${String(evidence.mode ?? "unknown").toUpperCase()} visualizer persists after packaged-app restart`,
        restoredBody?.artifact?.status === "ready" &&
          restoredBody?.artifact?.contentHash === evidence.contentHash,
        `status ${restored?.status}; version ${restoredBody?.artifact?.version ?? "missing"}`,
      );
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
