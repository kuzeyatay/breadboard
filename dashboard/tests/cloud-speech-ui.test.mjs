import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { chromium } from "playwright";

test("Voice settings switch providers, use subscription sign-in, preview cloud speech, and roll back failed saves", { timeout: 45_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await esbuild.build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import SettingsSpeech from './src/app/components/settings-speech';
        createRoot(document.getElementById('root')).render(React.createElement(SettingsSpeech));`,
      resolveDir: root, loader: "tsx",
    },
    bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "silent-preview", setup(build) {
      build.onResolve({ filter: /speech\/request-client$/ }, () => ({ path: "request", namespace: "request-stub" }));
      build.onLoad({ filter: /.*/, namespace: "request-stub" }, () => ({ contents: "export const speechRequest = (...args) => fetch(...args);", loader: "js" }));
      build.onResolve({ filter: /(?:speech\/|^\.\/)subscription-live$/ }, () => ({ path: "subscription", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
        contents: `export async function subscriptionSelected() {
          const {settings} = await (await fetch('/api/speech/settings')).json(); return settings.speechProvider === 'chatgpt';
        }
        export async function connectSubscriptionVoice() {
          return {close:async()=>{},speak:async text=>{
            (window.spokenPreviews??=[]).push(text); await new Promise(resolve=>setTimeout(resolve,20));
          }};
        }`,
        loader: "js",
      }));
    } }],
  });
  const server = http.createServer((request, response) => {
    if (request.url === "/app.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(bundle.outputFiles[0].text);
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>');
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const executablePath = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
  ].find((candidate) => fs.existsSync(candidate));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    let settings = {
      speechProvider: "chatgpt", openaiVoice: "cove", enabled: true, profileId: "local-retained",
      language: "en", engine: "auto", modelSize: "1.7B", transcriptionLanguage: null, transcriptionModel: "base",
    };
    let cloud = { configured: false, source: null, canStore: true, hasStoredKey: false };
    let prepareCalls = 0;
    let failSave = false;
    let failPrepare = false;
    let previewCalls = 0;
    await page.route("**/api/speech/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (pathname.endsWith('/clap-controls')) return json({ userId: '1',
        preferences: { version: 1, enabled: false, resumeOnStartup: false, deviceId: '', sensitivity: .55, pattern: 'double' },
        action: { prompt: 'Start dictation', action: { kind: 'dictation' } },
      });
      if (pathname.endsWith("/status")) {
        const local = settings.speechProvider === "local";
        return json({ settings, cloud, available: local || cloud.configured, health: null, startup: null,
          profiles: local ? [{ id: "local-retained", name: "Local retained voice", language: "en", voice_type: "preset", sample_count: 0 }] : [],
          models: [], presets: { kokoro: [], qwen_custom_voice: [] } });
      }
      if (pathname.endsWith("/prepare")) {
        prepareCalls++;
        if (failPrepare) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return json({ error: "Stale local startup failure" }, 503);
        }
        return json({ ready: true });
      }
      assert.ok(!pathname.endsWith("/credentials"), "Subscription voice never requests API credentials");
      if (pathname.endsWith("/settings")) {
        if (failSave) { failSave = false; return json({ error: "Preferences could not be saved" }, 500); }
        settings = { ...settings, ...request.postDataJSON() };
        return json({ settings });
      }
      if (pathname.endsWith("/synthesize")) {
        previewCalls++;
        assert.ok(request.postDataJSON().text);
        return route.fulfill({ contentType: "audio/mpeg", body: "mock-audio" });
      }
      throw new Error(`Unexpected speech endpoint ${pathname}`);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("heading", { name: "ChatGPT subscription speech" }).waitFor();
    assert.equal(prepareCalls, 0, "Opening cloud settings must not start Voicebox");
    assert.equal(await page.getByRole("button", { name: "Preview voice", exact: true }).isEnabled(), false);
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    assert.equal(await page.getByText("Sign in under Accounts.", { exact: false }).count(), 0);
    cloud = { configured: false, source: "subscription", signedIn: true, reason: "runtime_missing", error: "Your ChatGPT account is connected. Install the native voice runtime." };
    await page.getByRole("button", { name: "Re-check connection" }).click();
    await page.getByText(cloud.error, { exact: true }).waitFor();
    assert.equal(await page.getByText("Sign in under Accounts.", { exact: false }).count(), 0);
    cloud = { configured: false, source: "subscription", reason: "service_unavailable", error: "Restart Breadboard to load the subscription voice service." };
    await page.getByRole("button", { name: "Re-check connection" }).click();
    await page.getByText(cloud.error, { exact: true }).waitFor();
    await page.getByText("An unavailable voice service does not mean you are signed out.", { exact: false }).waitFor();
    cloud = { configured: true, source: "subscription" };
    await page.getByRole("button", { name: "Re-check connection" }).click();
    await page.getByText("ChatGPT account connected.", { exact: false }).waitFor();
    await page.getByLabel("Cloud voice", { exact: true }).selectOption("maple");
    const previewText = 'Can you hear the rain? Read "these words" exactly.';
    await page.getByLabel("Preview text", { exact: true }).fill(previewText);
    await page.getByRole("button", { name: "Preview voice", exact: true }).click();
    await page.waitForFunction(() => window.spokenPreviews?.length === 1);
    assert.deepEqual(await page.evaluate(() => window.spokenPreviews), [previewText]);
    assert.equal(previewCalls, 0, "Subscription previews use streamed playback, not local synthesis");
    assert.equal(settings.openaiVoice, "maple");
    await page.getByRole("button", { name: "Local", exact: true }).click();
    await page.getByRole("heading", { name: "Local speech service" }).waitFor();
    await page.getByText("Local retained voice", { exact: true }).first().waitFor();
    assert.equal(prepareCalls, 1);
    await page.getByRole("button", { name: "ChatGPT subscription", exact: true }).click();
    await page.getByRole("heading", { name: "ChatGPT subscription speech" }).waitFor();
    assert.equal(await page.getByLabel("Cloud voice", { exact: true }).inputValue(), "maple");
    assert.equal(prepareCalls, 1);
    failSave = true;
    await page.getByRole("button", { name: "Local", exact: true }).click();
    await page.getByText("Preferences could not be saved", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "ChatGPT subscription", exact: true }).getAttribute("aria-pressed"), "true");
    failPrepare = true;
    await page.getByRole("button", { name: "Local", exact: true }).click();
    await page.getByRole("heading", { name: "Local speech service" }).waitFor();
    await page.getByRole("button", { name: "ChatGPT subscription", exact: true }).click();
    await page.getByRole("heading", { name: "ChatGPT subscription speech" }).waitFor();
    cloud = { configured: false, source: "subscription", signedIn: false, reason: "sign_in_required", error: "No connected ChatGPT account was found." };
    await page.getByRole("button", { name: "Re-check connection" }).click();
    await page.getByText(cloud.error, { exact: true }).waitFor();
    assert.equal(await page.getByText("An unavailable voice service does not mean you are signed out.", { exact: false }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Preview voice", exact: true }).isEnabled(), false);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
