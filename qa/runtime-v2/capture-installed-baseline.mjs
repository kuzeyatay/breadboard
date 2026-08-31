#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(qaDir, "..", "..");
const dashboardRequire = createRequire(path.join(repoRoot, "dashboard", "package.json"));
const args = new Map(
  process.argv.slice(2).map((value) => {
    const [key, ...rest] = value.split("=");
    return [key, rest.join("=") || "true"];
  }),
);

const installedExecutable = path.resolve(
  args.get("--executable") ??
    "C:/Users/20252082/AppData/Local/Programs/Breadboard/Breadboard.exe",
);
const installedUserData = path.resolve(
  args.get("--user-data") ??
    "C:/Users/20252082/AppData/Roaming/breadboard-desktop",
);
const gardenSlug = boundedSlug(args.get("--garden") ?? "computer-architecture-2", "garden");
const learnMode = args.get("--learn") ?? "setup";
if (!new Set(["none", "setup", "start"]).has(learnMode)) {
  throw new Error("--learn must be none, setup, or start");
}
const settleMs = boundedInteger(args.get("--settle-ms"), 30_000, 0, 10 * 60_000, "settle-ms");
const runId = `baseline-installed-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const evidenceDir = path.join(qaDir, "evidence", runId);
const samplesPath = path.join(evidenceDir, "memory-samples.ndjson");
const receiptPath = path.join(evidenceDir, "receipt.json");
fs.mkdirSync(evidenceDir, { recursive: true });

if (process.platform !== "win32") throw new Error("The installed baseline currently requires Windows.");
if (!fs.existsSync(installedExecutable)) {
  throw new Error(`Installed Breadboard executable is missing: ${installedExecutable}`);
}

class Sampler {
  constructor() {
    this.child = null;
    this.pending = [];
    this.stdout = "";
  }

  start() {
    this.child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        path.join(repoRoot, "qa", "memory", "windows-sampler.ps1"),
      ],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.consume(chunk));
    this.child.stderr.resume();
    this.child.once("exit", () => {
      for (const pending of this.pending.splice(0)) {
        pending.reject(new Error("memory sampler exited"));
      }
    });
  }

  consume(chunk) {
    this.stdout += chunk;
    for (;;) {
      const newline = this.stdout.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdout.slice(0, newline).trim();
      this.stdout = this.stdout.slice(newline + 1);
      if (!line) continue;
      const pending = this.pending.shift();
      if (!pending) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.error) throw new Error(parsed.error);
        pending.resolve(parsed);
      } catch (error) {
        pending.reject(error);
      }
    }
  }

  sample() {
    if (!this.child) this.start();
    return new Promise((resolve, reject) => {
      const pending = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        const index = this.pending.indexOf(pending);
        if (index >= 0) this.pending.splice(index, 1);
        reject(new Error("memory sample timed out"));
      }, 20_000);
      this.pending.push(pending);
      this.child.stdin.write("sample\n");
    });
  }

  stop() {
    this.child?.stdin.end();
    this.child = null;
  }
}

function boundedInteger(raw, fallback, minimum, maximum, name) {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`--${name} must be a whole number`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`--${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function boundedSlug(raw, name) {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(raw)) {
    throw new Error(`--${name} is not a bounded slug`);
  }
  return raw;
}

function descendants(rootPid, processes) {
  const result = new Set(rootPid ? [rootPid] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const processInfo of processes) {
      if (!result.has(processInfo.pid) && result.has(processInfo.parentPid)) {
        result.add(processInfo.pid);
        changed = true;
      }
    }
  }
  return result;
}

function summarizeSample(sample, rootPid, phase) {
  const ownedPids = descendants(rootPid, sample.processes);
  const owned = sample.processes.filter((processInfo) => ownedPids.has(processInfo.pid));
  return {
    phase,
    sampledAt: sample.sampledAt,
    commitTotalMb: round(sample.commitTotalMb),
    commitLimitMb: round(sample.commitLimitMb),
    freeCommitMb: round(sample.commitLimitMb - sample.commitTotalMb),
    physicalAvailableMb: round(sample.physicalAvailableMb),
    systemProcessCount: sample.processCount,
    rootPid: rootPid || null,
    ownedProcessCount: owned.length,
    ownedPrivateMb: round(owned.reduce((sum, row) => sum + row.privateBytes, 0) / 1048576),
    ownedWorkingSetMb: round(owned.reduce((sum, row) => sum + row.workingSetBytes, 0) / 1048576),
    ownedProcesses: owned.map((row) => ({
      pid: row.pid,
      parentPid: row.parentPid,
      name: row.name,
      privateMb: round(row.privateBytes / 1048576),
      workingSetMb: round(row.workingSetBytes / 1048576),
    })),
  };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDashboard(application, timeoutMs = 10 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = application
      .windows()
      .find((candidate) => !candidate.isClosed() && /^http:\/\/127\.0\.0\.1:\d+\//.test(candidate.url()));
    if (page) {
      await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
      return page;
    }
    await delay(100);
  }
  throw new Error(
    `Dashboard did not open; windows=${application.windows().map((page) => page.url()).join(",")}`,
  );
}

async function authenticateIfNeeded(page) {
  if (!/\/(?:login|register)(?:[/?#]|$)/.test(page.url())) return false;
  const configPath = path.join(installedUserData, "Data", "config", "desktop-config.json");
  const databasePath = path.join(installedUserData, "Data", "database", "brain.db");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (typeof config.nextAuthSecret !== "string" || config.nextAuthSecret.length < 16) {
    throw new Error("Installed NextAuth secret is missing");
  }
  const Database = dashboardRequire("better-sqlite3");
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  let user;
  try {
    user = database
      .prepare("SELECT id, username, email FROM users ORDER BY id DESC LIMIT 1")
      .get();
  } finally {
    database.close();
  }
  if (!user) throw new Error("Installed Breadboard data has no user");
  const { encode } = dashboardRequire("next-auth/jwt");
  const maxAge = 30 * 24 * 60 * 60;
  const value = await encode({
    token: {
      sub: String(user.id),
      id: user.id,
      username: user.username,
      name: user.username,
      email: user.email,
    },
    secret: config.nextAuthSecret,
    maxAge,
  });
  const origin = new URL(page.url()).origin;
  await page.context().addCookies([
    {
      name: "next-auth.session-token",
      value,
      url: origin,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + maxAge,
    },
  ]);
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  return true;
}

async function clickVisibleGarden(page) {
  const exact = page.locator(`a[href="/gardens/${gardenSlug}"]`).first();
  const partial = page.locator(`a[href*="/gardens/${gardenSlug}"]`).first();
  const target = (await exact.count()) > 0 ? exact : partial;
  if ((await target.count()) === 0) {
    throw new Error(`Visible dashboard has no link for ordinary garden ${gardenSlug}`);
  }
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await page.waitForURL(new RegExp(`/gardens/${gardenSlug}(?:[/?#]|$)`), { timeout: 60_000 });
}

async function openLearnPanel(page) {
  const button = page.getByRole("button", { name: "Open Learn panel" });
  await button.waitFor({ state: "visible", timeout: 60_000 });
  await button.click();
}

async function startLearnFromVisibleControl(page) {
  const candidates = [
    page.getByRole("button", { name: "Generate", exact: true }),
    page.getByRole("button", { name: "Retry Learn", exact: true }),
    page.getByRole("button", { name: "Restart planning", exact: true }),
    page.getByRole("button", { name: "Start Learn", exact: true }),
  ];
  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.first().isVisible())) {
      await candidate.first().click();
      return (await candidate.first().getAttribute("aria-label")) ?? (await candidate.first().textContent());
    }
  }
  throw new Error("Learn panel exposed no supported visible start control");
}

const sampler = new Sampler();
const samples = [];
const screenshots = [];
let application = null;
let rootPid = 0;
let periodic = null;
let sampleInFlight = false;
let primaryError = null;
const startedAt = new Date().toISOString();

async function capture(phase) {
  const sample = summarizeSample(await sampler.sample(), rootPid, phase);
  samples.push(sample);
  fs.appendFileSync(samplesPath, `${JSON.stringify(sample)}\n`, { encoding: "utf8", mode: 0o600 });
  return sample;
}

async function screenshot(page, name) {
  const target = path.join(evidenceDir, `${name}.png`);
  await page.screenshot({ path: target, fullPage: false });
  screenshots.push(target);
}

try {
  await capture("pre-launch");
  application = await electron.launch({
    executablePath: installedExecutable,
    args: ["--disable-gpu"],
    cwd: path.dirname(installedExecutable),
    env: Object.fromEntries(
      Object.entries(process.env).filter((entry) => typeof entry[1] === "string"),
    ),
    timeout: 60_000,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
  });
  rootPid = application.process().pid ?? (await application.evaluate(() => process.pid));
  periodic = setInterval(() => {
    if (sampleInFlight) return;
    sampleInFlight = true;
    void capture("periodic").finally(() => {
      sampleInFlight = false;
    });
  }, 2_000);
  periodic.unref?.();

  const startup = await application.firstWindow({ timeout: 60_000 });
  await startup.setViewportSize({ width: 1440, height: 1000 });
  await startup.waitForLoadState("domcontentloaded");
  await screenshot(startup, "01-startup");
  await capture("startup-visible");

  const welcome = startup.getByRole("button", {
    name: "Welcome to Breadboard. Press space to continue.",
  });
  if ((await welcome.count()) > 0) {
    await welcome.waitFor({ state: "visible", timeout: 10 * 60_000 });
    await welcome.click();
  }

  const dashboard = await waitForDashboard(application);
  await dashboard.setViewportSize({ width: 1440, height: 1000 });
  await authenticateIfNeeded(dashboard);
  await dashboard.waitForLoadState("domcontentloaded");
  await screenshot(dashboard, "02-dashboard");
  await capture("dashboard-idle");

  await clickVisibleGarden(dashboard);
  await screenshot(dashboard, "03-garden");
  await capture("garden-visible");

  if (learnMode !== "none") {
    await openLearnPanel(dashboard);
    await screenshot(dashboard, "04-learn-setup");
    await capture("learn-setup");
  }
  let learnControl = null;
  if (learnMode === "start") {
    learnControl = await startLearnFromVisibleControl(dashboard);
    await delay(2_000);
    await screenshot(dashboard, "05-learn-started");
    await capture("learn-started");
  }

  if (settleMs > 0) {
    await delay(settleMs);
    await capture("settled-before-close");
  }

  const semantic = await dashboard.locator("body").evaluate((body) => ({
    title: document.title,
    url: location.href,
    buttons: [...body.querySelectorAll("button")]
      .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
      .slice(0, 100)
      .map((element) => element.getAttribute("aria-label") || element.textContent?.trim() || ""),
    headings: [...body.querySelectorAll("h1,h2,h3")]
      .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
      .slice(0, 100)
      .map((element) => element.textContent?.trim() || ""),
  }));

  fs.writeFileSync(
    receiptPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        classification: "BASELINE_CAPTURED",
        runId,
        startedAt,
        completedAt: new Date().toISOString(),
        installedExecutable,
        installedExecutableBytes: fs.statSync(installedExecutable).size,
        installedExecutableModifiedAt: fs.statSync(installedExecutable).mtime.toISOString(),
        installedUserData,
        gardenSlug,
        learnMode,
        learnControl,
        rootPid,
        screenshots: screenshots.map((value) => path.relative(repoRoot, value).replaceAll("\\", "/")),
        semantic,
        samples,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
} catch (error) {
  primaryError = error;
} finally {
  if (periodic) clearInterval(periodic);
  if (sampleInFlight) await delay(250);
  if (application) {
    await application.close().catch((error) => {
      primaryError ??= error;
    });
  }
  await capture("after-close").catch(() => {});
  sampler.stop();
}

if (primaryError) {
  fs.writeFileSync(
    receiptPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        classification: "FAILED",
        runId,
        startedAt,
        completedAt: new Date().toISOString(),
        gardenSlug,
        learnMode,
        rootPid: rootPid || null,
        error: primaryError instanceof Error ? primaryError.message : String(primaryError),
        screenshots: screenshots.map((value) => path.relative(repoRoot, value).replaceAll("\\", "/")),
        samples,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  throw primaryError;
}

process.stdout.write(`[runtime-v2] installed baseline receipt: ${receiptPath}\n`);
