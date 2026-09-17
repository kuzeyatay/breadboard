import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root = path.resolve(import.meta.dirname, "..");

test(
  "model boundaries survive streaming and chat restoration without becoming messages",
  { timeout: 60_000 },
  async () => {
    const bundle = await build({
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      alias: { "@": path.join(root, "src") },
      stdin: {
        resolveDir: root,
        loader: "tsx",
        contents: `
      import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {useChatModelChanges} from '@/app/components/use-chat-model-changes';
      import {ChatModelChangeSeparators} from '@/app/components/chat-model-change-separator';
      const pair = [{role:'user',content:'Hello',clientMessageId:'turn-001'}, {role:'assistant',content:'Hello back',clientMessageId:'turn-001'}];
      function App() {
        const temporary = location.search.includes('temporary');
        const [model,setModel] = useState('gpt-5.6-sol');
        const [state,setState] = useState({id:null,created:null,messages:[],busy:false});
        window.fixture = {set:patch=>setState(s=>({...s,...patch})), pair};
        const {changeModel,labelsFor} = useChatModelChanges({scope:temporary?'temporary':'fixture', sessionId:state.id,createdSessionId:state.created,messages:state.messages,model,onModelChange:setModel,persist:!temporary});
        return <main style={{maxWidth:700,margin:'auto',padding:20}}>
          <select aria-label="Model" value={model} onChange={e=>changeModel(e.target.value)}>
            {['gpt-5.6-sol','gpt-6-astra','cliproxy/claude-opus-5'].map(id=><option key={id}>{id}</option>)}
          </select>
          <div id="transcript">{state.messages.map((message,index)=><div key={index}>
            <p>{message.content}</p>
            <ChatModelChangeSeparators labels={labelsFor(message,index)} visible={!(state.busy && index===state.messages.length-1)}/>
          </div>)}</div>
          <output aria-label="Raw messages">{JSON.stringify(state.messages)}</output>
        </main>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `,
      },
    });
    const stylesheet = path.join(root, "src/app/globals.css");
    const cssInput = fs
      .readFileSync(stylesheet, "utf8")
      .replace(
        '@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";',
        '@source "./components/chat-model-change-separator.tsx";',
      );
    const css = (
      await postcss([tailwind({ base: root })]).process(cssInput, {
        from: stylesheet,
      })
    ).css;
    const browser = await chromium.launch({
      headless: true,
      ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 650 },
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("http://model-boundaries.test/**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body:
            "<!doctype html><style>" +
            css +
            '</style><div id="root"></div><script>' +
            bundle.outputFiles[0].text +
            "</script>",
        }),
      );
      await page.goto("http://model-boundaries.test/");
      const select = page.getByLabel("Model", { exact: true });
      const separators = page.getByRole("separator");
      await select.selectOption("gpt-6-astra");
      await expect(separators).toHaveCount(0);
      await page.evaluate(() =>
        window.fixture.set({ messages: window.fixture.pair }),
      );
      await expect(page.getByText("Hello back", { exact: true })).toBeVisible();
      await select.selectOption("gpt-5.6-sol");
      await expect(
        page.getByRole("separator", { name: "Switched to GPT 5.6 Sol" }),
      ).toBeVisible();
      await select.selectOption("gpt-5.6-sol");
      await expect(separators).toHaveCount(1);
      await page.evaluate(() =>
        window.fixture.set({ id: 42, created: 42, busy: true }),
      );
      await select.selectOption("cliproxy/claude-opus-5");
      await expect(separators).toHaveCount(0);
      await page.evaluate(() =>
        window.fixture.set({
          messages: window.fixture.pair.map((m) => ({
            ...m,
            content: m.role === "assistant" ? "Finished answer" : m.content,
          })),
          busy: false,
        }),
      );
      await expect(separators).toHaveCount(2);
      await expect(
        page.getByRole("separator", { name: "Switched to Claude Opus 5" }),
      ).toBeVisible();
      assert.equal(await page.locator("#transcript > div").count(), 2);
      assert.doesNotMatch(
        await page.getByLabel("Raw messages").textContent(),
        /Switched|modelChange/,
      );
      await page.reload();
      await expect(select).toBeVisible();
      await page.evaluate(() =>
        window.fixture.set({ id: 42, messages: window.fixture.pair }),
      );
      await expect(separators).toHaveCount(2);
      // A server read confirms the same two boundaries; it must not double them.
      await page.evaluate(() =>
        window.fixture.set({
          messages: window.fixture.pair.map((m) =>
            m.role === "assistant"
              ? { ...m, modelChangesAfter: ["GPT 5.6 Sol", "Claude Opus 5"] }
              : m,
          ),
        }),
      );
      await expect(separators).toHaveCount(2);
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        const bounds = await separators.first().boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
        assert.equal(await separators.first().locator("svg path").count(), 2);
        if (process.env.MODEL_CHANGE_SCREENSHOTS) {
          fs.mkdirSync(process.env.MODEL_CHANGE_SCREENSHOTS, {
            recursive: true,
          });
          await page
            .locator("#transcript")
            .screenshot({
              path: path.join(
                process.env.MODEL_CHANGE_SCREENSHOTS,
                `separator-${theme}.png`,
              ),
            });
        }
      }
      await page.evaluate(() =>
        window.fixture.set({ id: 43, messages: window.fixture.pair }),
      );
      await expect(separators).toHaveCount(0);
      await page.evaluate(() =>
        window.fixture.set({ id: null, created: null, messages: [] }),
      );
      await select.selectOption("gpt-6-astra");
      await expect(separators).toHaveCount(0);
      await page.goto("http://model-boundaries.test/?temporary");
      await expect(select).toBeVisible();
      await page.evaluate(() =>
        window.fixture.set({ id: 99, messages: window.fixture.pair }),
      );
      await select.selectOption("gpt-6-astra");
      await expect(separators).toHaveCount(1);
      assert.equal(
        await page.evaluate(() =>
          Object.keys(localStorage).some((key) => key.includes(":temporary:")),
        ),
        false,
      );
      await page.reload();
      await expect(select).toBeVisible();
      await page.evaluate(() =>
        window.fixture.set({ id: 99, messages: window.fixture.pair }),
      );
      await expect(separators).toHaveCount(0);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);

test(
  "standalone Quartz draws and restores the same wavy model boundary",
  { timeout: 60_000 },
  async () => {
    const quartz = path.resolve(root, "../quartz");
    const require = createRequire(path.join(quartz, "package.json"));
    const css = require("sass").compile(
      path.join(quartz, "quartz/components/styles/breadboardAI.scss"),
      { silenceDeprecations: ["legacy-js-api"] },
    ).css;
    const component = await build({
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      jsxImportSource: "preact",
      define: {
        "process.env.BREADBOARD_DASHBOARD_URL": '"http://quartz-model.test"',
      },
      stdin: {
        resolveDir: quartz,
        loader: "tsx",
        contents: `
      import {h,render} from 'preact'; import AI from './quartz/components/BreadboardAI';
      window.addCleanup=()=>{};
      render(h(AI(),{fileData:{slug:'garden/page',frontmatter:{title:'A garden page'}}}),document.getElementById('root'));
    `,
      },
      plugins: [
        {
          name: "separate-assets",
          setup(build) {
            build.onResolve(
              { filter: /breadboardAI\.inline$|\.scss$/ },
              (args) => ({ path: args.path, namespace: "empty" }),
            );
            build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({
              contents: 'export default "";',
            }));
          },
        },
      ],
    });
    const script = await build({
      entryPoints: [
        path.join(quartz, "quartz/components/scripts/breadboardAI.inline.ts"),
      ],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      plugins: [
        {
          name: "isolate-widgets",
          setup(build) {
            build.onResolve({ filter: /^\.\/assistantWidgets$/ }, (args) => ({
              path: args.path,
              namespace: "widgets",
            }));
            build.onLoad({ filter: /.*/, namespace: "widgets" }, () => ({
              contents:
                "export const createAssistantWidgetHost = () => ({render:()=>false,dispose:()=>{}});",
            }));
          },
        },
      ],
    });
    const browser = await chromium.launch({
      headless: true,
      ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 760 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const writes = [];
      await page.route("http://quartz-model.test/**", async (route) => {
        const url = route.request().url();
        if (url.includes("/api/")) {
          let data = {};
          if (url.includes("/models"))
            data = {
              models: ["gpt-5.6-sol", "gpt-6-astra"],
              defaultModel: "gpt-5.6-sol",
              reasoningEfforts: ["high"],
              defaultReasoningEffort: "high",
            };
          else if (url.includes("/assistant-preferences"))
            data = { model: "gpt-5.6-sol", userPreference: true };
          else if (url.includes("/sessions?"))
            data = {
              sessions: [
                {
                  id: "conv_fixture",
                  title: "Page chat",
                  active: false,
                  messages: [
                    {
                      role: "user",
                      content: "Hello",
                      clientMessageId: "turn-001",
                    },
                    {
                      role: "assistant",
                      content: "Hello back",
                      clientMessageId: "turn-001",
                    },
                  ],
                },
              ],
            };
          else if (url.includes("/model-change")) {
            writes.push(route.request().postDataJSON());
            data = { modelChange: "GPT 6 Astra" };
          }
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify(data),
          });
        }
        return route.fulfill({
          contentType: "text/html",
          body:
            "<!doctype html><style>body{margin:0;background:#f8f6ee}" +
            css +
            '</style><div id="root"></div><script>' +
            component.outputFiles[0].text +
            "</script><script>" +
            script.outputFiles[0].text +
            '</script><script>document.dispatchEvent(new Event("nav"))</script>',
        });
      });
      await page.addInitScript(() => {
        const key = "breadboard-ai:garden:garden/page";
        if (!sessionStorage.getItem(key))
          sessionStorage.setItem(
            key,
            JSON.stringify({
              sessionId: "conv_fixture",
              clientToken: null,
              model: "gpt-5.6-sol",
              effort: "high",
            }),
          );
      });
      await page.goto("http://quartz-model.test/");
      await page
        .getByRole("button", { name: "Open Assistant for this page" })
        .click();
      await expect(page.getByText("Hello back", { exact: true })).toBeVisible();
      await page
        .getByLabel("Model", { exact: true })
        .selectOption("gpt-6-astra");
      await expect(
        page.getByRole("separator", { name: "Switched to GPT 6 Astra" }),
      ).toBeVisible();
      assert.equal(await page.locator(".breadboard-ai-message").count(), 2);
      await expect.poll(() => writes.length).toBe(1);
      assert.equal(writes[0].afterClientMessageId, "turn-001");
      await page.reload();
      await page
        .getByRole("button", { name: "Open Assistant for this page" })
        .click();
      await expect(
        page.getByRole("separator", { name: "Switched to GPT 6 Astra" }),
      ).toBeVisible();
      assert.equal(
        await page.getByRole("separator").locator("svg path").count(),
        2,
      );
      const bounds = await page.getByRole("separator").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
      if (process.env.MODEL_CHANGE_SCREENSHOTS) {
        fs.mkdirSync(process.env.MODEL_CHANGE_SCREENSHOTS, { recursive: true });
        await page
          .locator(".breadboard-ai-panel")
          .screenshot({
            path: path.join(
              process.env.MODEL_CHANGE_SCREENSHOTS,
              "separator-quartz.png",
            ),
          });
      }
      await page.getByRole("button", { name: "New chat", exact: true }).click();
      await page
        .getByLabel("Model", { exact: true })
        .selectOption("gpt-6-astra");
      await expect(page.getByRole("separator")).toHaveCount(0);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
