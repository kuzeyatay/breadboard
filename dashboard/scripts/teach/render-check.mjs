// Render the teaching screens headlessly, to prove they are real components.
//
// The dashboard has no browser or DOM test infrastructure, so the way to check
// that a client component actually renders -- rather than string-grepping its
// source -- is to bundle it with the repo's own esbuild and run it through
// react-dom/server. That catches the failures a grep cannot: a bad import, a
// hook used outside a component, a branch that throws before it paints.
//
//   node scripts/teach/render-check.mjs

import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import Module from "node:module";

const DASHBOARD_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

const ENTRY = `
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TeachWorkflow, { RecordingControls } from "@/app/workflows/teach/teach-workflow";
import DemonstratedWorkflow from "@/app/workflows/teach/demonstrated-workflow";
import TeachControllerClient from "@/app/workflows/teach-controller/teach-controller-client";
import WorkflowsClient from "@/app/workflows/workflows-client";

globalThis.__render = () => ({
  setup: renderToStaticMarkup(
    React.createElement(TeachWorkflow, { onSaved: () => {}, onClose: () => {} }),
  ),
  recording: renderToStaticMarkup(
    React.createElement(RecordingControls, {
      elapsedMs: 65_000,
      level: 0.42,
      paused: false,
      busy: false,
      onPause: () => {},
      onResume: () => {},
      onFinish: () => {},
      onCancel: () => {},
    }),
  ),
  detail: renderToStaticMarkup(
    React.createElement(DemonstratedWorkflow, {
      workflowId: "w1",
      onBack: () => {},
      onReteach: () => {},
      onDelete: () => {},
    }),
  ),
  controller: renderToStaticMarkup(
    React.createElement(TeachControllerClient, { sessionId: "s1" }),
  ),
  workflows: renderToStaticMarkup(React.createElement(WorkflowsClient, { workflowId: null })),
});
`;

const bundle = await build({
  stdin: { contents: ENTRY, resolveDir: DASHBOARD_ROOT, loader: "tsx", sourcefile: "render-check.tsx" },
  bundle: true,
  write: false,
  // react-dom/server is CommonJS and requires node builtins; the ESM interop
  // shim cannot satisfy that, so the bundle has to be CJS.
  format: "cjs",
  platform: "node",
  target: "node20",
  jsx: "automatic",
  logLevel: "silent",
  alias: { "@": path.join(DASHBOARD_ROOT, "src") },
  plugins: [
    {
      // `useRouter` needs an app-router context that only exists inside a real
      // Next render. The pages under test never navigate during their first
      // paint, so a stub is enough to reach the markup.
      name: "stub-next-navigation",
      setup(build) {
        build.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: "next-navigation-stub",
          namespace: "teach-render-stub",
        }));
        // Stylesheets are Next's job, not this check's. Server-rendered markup
        // is the same either way.
        build.onResolve({ filter: /\.css$/ }, (args) => ({
          path: args.path,
          namespace: "teach-render-css",
        }));
        build.onLoad({ filter: /.*/, namespace: "teach-render-css" }, () => ({
          contents: "export default {};",
          loader: "js",
        }));
        build.onLoad({ filter: /.*/, namespace: "teach-render-stub" }, () => ({
          contents: [
            "export const useRouter = () => ({ replace() {}, push() {}, refresh() {}, back() {} });",
            "export const useSearchParams = () => new URLSearchParams();",
            'export const usePathname = () => "/workflows";',
            "export const redirect = () => {};",
          ].join("\n"),
          loader: "js",
        }));
      },
    },
  ],
});

const code = bundle.outputFiles[0].text;
const sandboxModule = { exports: {} };
const requireFromDashboard = Module.createRequire(path.join(DASHBOARD_ROOT, "package.json"));

const context = vm.createContext({
  module: sandboxModule,
  exports: sandboxModule.exports,
  require: requireFromDashboard,
  process,
  console,
  globalThis: undefined,
  Buffer,
  URL,
  TextEncoder,
  TextDecoder,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  queueMicrotask,
  fetch: () => Promise.reject(new Error("no network during a render check")),
  __dirname: DASHBOARD_ROOT,
  __filename: path.join(DASHBOARD_ROOT, "render-check.cjs"),
});
context.globalThis = context;
vm.runInContext(code, context, { filename: "render-check.cjs" });

const rendered = context.__render();

const checks = [
  ["setup", /Perform the task once while describing important decisions aloud/],
  ["setup", /Start teaching/],
  ["setup", /Choose a microphone/],
  ["setup", /your microphone, so it can hear why you are doing each thing/],
  ["setup", /deleted once the workflow has been built from it/],
  ["recording", /01:05/],
  ["recording", /Microphone level/],
  ["recording", /Finish/],
  ["recording", /Pause/],
  ["detail", /Opening this workflow/],
  ["controller", /Recording your demonstration/],
  ["controller", /Finish/],
  // The one entry point the whole feature hangs off: Intelligence -> Workflows.
  ["workflows", /Teach Workflow/],
  ["workflows", /New workflow/],
  ["workflows", /show Breadboard the task once/],
];

let failed = 0;
for (const [screen, pattern] of checks) {
  const ok = pattern.test(rendered[screen]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${screen}: ${pattern}`);
  if (!ok) failed += 1;
}

// The recording controller must not leak the demonstration into the markup.
for (const [screen, markup] of Object.entries(rendered)) {
  if (/data:audio|base64/.test(markup)) {
    console.log(`FAIL  ${screen}: markup contains embedded media`);
    failed += 1;
  }
}

console.log(`\n${failed === 0 ? "RENDER CHECK PASSED" : `RENDER CHECK FAILED (${failed})`}`);
process.exit(failed === 0 ? 0 : 1);
