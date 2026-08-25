import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";
import playwright from "../../node_modules/playwright/index.js";

const { chromium } = playwright;
const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(dashboardRoot, "..");
const baseUrl = process.env.GENOFFICE_SMOKE_BASE_URL?.trim() || "http://127.0.0.1:3000";
const docxPath = process.env.GENOFFICE_SMOKE_DOCX?.trim();
const originalText = process.env.GENOFFICE_SMOKE_FIND?.trim() || "Cat Species and Their Ancestries";
const replacementText = process.env.GENOFFICE_SMOKE_REPLACE?.trim()
  || "Cat Species and Their Verified Ancestries";

if (!docxPath || !fs.existsSync(docxPath)) {
  throw new Error("GENOFFICE_SMOKE_DOCX must point to a readable .docx file.");
}

const docxBytes = fs.readFileSync(docxPath);
const sourceZip = await JSZip.loadAsync(docxBytes);
const sourceXml = await sourceZip.file("word/document.xml")?.async("string");
if (!sourceXml?.includes(originalText)) {
  throw new Error(`The smoke document does not contain ${JSON.stringify(originalText)}.`);
}

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await chromium.launch({
  executablePath: fs.existsSync(edgePath) ? edgePath : undefined,
  headless: true,
});

let savedBytes = null;
const runtimeErrors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1540, height: 980 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });

  await page.route("**/api/hermes/artifacts/smoke-artifact/genoffice?*", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        body: docxBytes,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "X-Breadboard-Artifact-Filename": encodeURIComponent(path.basename(docxPath)),
          "X-Breadboard-Artifact-Version": "1",
        },
      });
      return;
    }
    if (request.method() === "PUT") {
      savedBytes = request.postDataBuffer();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          artifact: {
            id: "smoke-artifact",
            conversationId: "smoke-conversation",
            title: "GenOffice smoke document",
            filename: path.basename(docxPath),
            version: 2,
          },
        }),
      });
      return;
    }
    await route.abort();
  });

  await page.route("**/api/hermes/artifacts/smoke-artifact/genoffice/ai?*", async (route) => {
    const requestBody = JSON.parse(route.request().postData() || "{}");
    if (!String(requestBody.documentContext || "").includes(originalText)) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "The editor did not send the live document context." }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: "I corrected the document title.",
        actions: [{
          name: "apply_commands",
          input: {
            commands: [{
              replaceAllText: {
                containsText: originalText,
                replaceText: replacementText,
                matchCase: true,
              },
            }],
          },
        }],
      }),
    });
  });

  const editorUrl = `${baseUrl}/genoffice-editor/index.html?${new URLSearchParams({
    artifactId: "smoke-artifact",
    conversationId: "smoke-conversation",
    version: "1",
  })}`;
  await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByText(originalText, { exact: true }).first().waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: "Proofread" }).waitFor();
  await page.getByLabel("Message Bread about this document").fill("Correct the document title.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByText("The changes are applied and saved in this document.", { exact: false })
    .waitFor({ timeout: 90_000 });
  await page.getByText(replacementText, { exact: true }).first().waitFor({ timeout: 30_000 });

  if (!savedBytes) throw new Error("The contained AI edit did not save a DOCX artifact version.");
  const savedZip = await JSZip.loadAsync(savedBytes);
  const savedXml = await savedZip.file("word/document.xml")?.async("string");
  if (!savedXml?.includes(replacementText) || savedXml.includes(originalText)) {
    throw new Error("The saved DOCX bytes do not contain the in-editor AI edit.");
  }
  const panelColor = await page.locator(".ai-panel").evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  if (panelColor !== "rgb(250, 247, 239)") {
    throw new Error(`The AI pane is not using the warm Quartz paper surface (${panelColor}).`);
  }
  if (!page.url().includes("/genoffice-editor/index.html")) {
    throw new Error("The AI request navigated away from the Office editor.");
  }
  if (runtimeErrors.length > 0) {
    throw new Error(`GenOffice emitted browser errors:\n${runtimeErrors.join("\n")}`);
  }

  const screenshotDir = path.join(repoRoot, ".qa-results");
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDir, "genoffice-ai-contained.png"),
    fullPage: true,
  });
  console.log(JSON.stringify({
    ok: true,
    remainedInEditor: true,
    savedDocxVersion: true,
    warmPaper: panelColor,
    screenshot: path.join(screenshotDir, "genoffice-ai-contained.png"),
  }));
} finally {
  await browser.close();
}

