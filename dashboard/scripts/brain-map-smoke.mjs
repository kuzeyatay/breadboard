// Local authenticated Knowledge Map smoke test. It mints a short-lived NextAuth
// JWT from the development secret without logging it, drives the already
// running dashboard, and records only counts/runtime state plus a screenshot.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import playwright from "../../node_modules/playwright/index.js";
import nextAuthJwt from "../node_modules/next-auth/jwt/index.js";

const { chromium } = playwright;
const { encode } = nextAuthJwt;

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(dashboardRoot, "..");
const envPath = path.join(dashboardRoot, ".env.local");
const desktopConfigPath = path.join(
  repoRoot,
  ".runtime",
  "desktop-config",
  "desktop-config.json",
);
const baseUrl = process.env.BRAIN_SMOKE_BASE_URL?.trim() || "http://127.0.0.1:3000";
const userId = process.env.BRAIN_SMOKE_USER_ID?.trim() || "1";
const viewportWidth = Number(process.env.BRAIN_SMOKE_VIEWPORT_WIDTH) || 1500;
const viewportHeight = Number(process.env.BRAIN_SMOKE_VIEWPORT_HEIGHT) || 980;

function readEnvValue(name) {
  const source = fs.readFileSync(envPath, "utf8");
  const line = source
    .split(/\r?\n/)
    .find((candidate) => candidate.trimStart().startsWith(`${name}=`));
  if (!line) throw new Error(`${name} is not configured in dashboard/.env.local`);
  const value = line.slice(line.indexOf("=") + 1).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function readNextAuthSecret() {
  if (fs.existsSync(desktopConfigPath)) {
    const config = JSON.parse(fs.readFileSync(desktopConfigPath, "utf8"));
    if (typeof config.nextAuthSecret === "string" && config.nextAuthSecret.length > 0) {
      return config.nextAuthSecret;
    }
  }
  return readEnvValue("NEXTAUTH_SECRET");
}

const secret = readNextAuthSecret();
const sessionToken = await encode({
  secret,
  maxAge: 10 * 60,
  token: { id: userId, sub: userId, name: "brain-smoke" },
});

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await chromium.launch({
  executablePath: fs.existsSync(edgePath) ? edgePath : undefined,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-webgl"],
});

try {
  const context = await browser.newContext({
    viewport: { width: viewportWidth, height: viewportHeight },
  });
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: sessionToken,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  let sessionResponse;
  try {
    sessionResponse = await context.request.get(`${baseUrl}/api/auth/session`, {
      timeout: 90_000,
    });
  } catch {
    throw new Error("Knowledge smoke could not reach the dashboard session endpoint.");
  }
  const session = await sessionResponse.json().catch(() => null);
  if (!session?.user?.id) {
    throw new Error(
      `Knowledge smoke session was not accepted (status ${sessionResponse.status()}).`,
    );
  }
  const page = await context.newPage();
  const runtimeErrors = [];
  const rendererLogs = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message.slice(0, 400)));
  page.on("console", (message) => {
    const entry = message.text().slice(0, 400);
    if (message.type() === "error") runtimeErrors.push(entry);
    if (entry.includes("[brain-renderer]")) rendererLogs.push(entry);
  });

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/profile/brain-graph") &&
      !response.url().includes("/expand"),
    { timeout: 90_000 },
  ).catch((error) => {
    runtimeErrors.push(`graph request: ${error.message}`.slice(0, 400));
    return null;
  });
  const navigationResponse = await page.goto(`${baseUrl}/profile?tab=knowledge&scope=personal`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  const graphResponse = await responsePromise;
  const graphPayload = graphResponse ? await graphResponse.json() : null;
  await page.locator('section[aria-label="Private Knowledge Map"]').waitFor({
    state: "visible",
    timeout: 30_000,
  }).catch(() => undefined);
  const canvas = page.locator('section[aria-label="Private Knowledge Map"] canvas').first();
  const listFallback = page.locator('[aria-label="Knowledge Map node list"]').first();
  await Promise.any([
    canvas.waitFor({ state: "visible", timeout: 120_000 }),
    listFallback.waitFor({ state: "visible", timeout: 120_000 }),
  ]).catch((error) => {
    runtimeErrors.push(`renderer readiness: ${error.message}`.slice(0, 400));
  });
  await page.waitForTimeout(2_500);

  let connectionInspectorVisible = false;
  const canvasBox = await canvas.boundingBox().catch(() => null);
  if (canvasBox) {
    const probePoints = [
      [0.62, 0.18], [0.68, 0.22], [0.55, 0.15], [0.48, 0.55],
      [0.55, 0.65], [0.42, 0.45], [0.75, 0.5], [0.25, 0.7],
    ];
    for (const [x, y] of probePoints) {
      await page.mouse.click(canvasBox.x + canvasBox.width * x, canvasBox.y + canvasBox.height * y);
      connectionInspectorVisible = await page
        .getByText("Connection", { exact: true })
        .isVisible()
        .catch(() => false);
      if (connectionInspectorVisible) break;
    }
  }

  const screenshotDir = path.join(dashboardRoot, ".runtime");
  fs.mkdirSync(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, "brain-map-smoke.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const result = {
    url: page.url(),
    navigationStatus: navigationResponse?.status() ?? null,
    status: graphResponse?.status() ?? null,
    graphNodes: Array.isArray(graphPayload?.nodes) ? graphPayload.nodes.length : null,
    graphEdges: Array.isArray(graphPayload?.edges) ? graphPayload.edges.length : null,
    knowledgeSectionCount: await page.locator('section[aria-label="Private Knowledge Map"]').count(),
    canvasCount: await page.locator('section[aria-label="Private Knowledge Map"] canvas').count(),
    listFallbackVisible: await page
      .locator('[aria-label="Knowledge Map node list"]')
      .isVisible()
      .catch(() => false),
    connectionInspectorVisible,
    knowledgeTabCurrent: await page
      .getByRole("button", { name: "Knowledge", exact: true })
      .getAttribute("aria-current"),
    runtimeErrors,
    rendererLogs,
    bodyText: (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 1_000),
    screenshotPath,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!graphResponse?.ok()) process.exitCode = 1;
  if (result.canvasCount === 0 && !result.listFallbackVisible) process.exitCode = 1;
  if (result.canvasCount > 0 && !result.connectionInspectorVisible) process.exitCode = 1;
  if (runtimeErrors.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
}
