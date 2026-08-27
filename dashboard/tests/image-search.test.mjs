// Google image search, wired as an agent tool with its own chat rendering.
//
// Two halves. The wiring half guards the failure this repo has hit before: a
// tool wired on the Breadboard side but never registered with the runtime, so
// the model is never offered it. The render half builds ChatMarkdown for real
// (esbuild -> CJS -> react-dom/server) and proves an ```image-results fenced
// block becomes an image grid — and that a half-streamed block renders as
// nothing rather than as a broken grid or a wall of JSON.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import {
  IMAGE_SEARCH_TOOLS,
  allowedToolsForSurface,
} from "../src/lib/hermes/tool-scopes.ts";
import { BROKERED_TOOLS } from "../src/lib/hermes/capability-broker.ts";
import {
  imageSearchMode,
  searchImages,
} from "../src/lib/hermes/image-search-service.ts";
import { validateImageSearchRequest } from "../scripts/runtime-v2-image-search-worker.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(dashboardRoot, "..");

// ── render harness ──────────────────────────────────────────────────────────
// Built before the first test() registration: node --test begins running
// registered tests at the first top-level await, and the after() cleanup would
// otherwise delete the temp directory out from under the build.

fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-image-results-"),
);

after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as ChatMarkdown } from "@/app/components/chat-markdown";\n`,
  "utf8",
);

const bundle = path.join(outDirectory, "bundle.cjs");
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  outfile: bundle,
  format: "cjs",
  platform: "node",
  target: "node20",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: { "@": path.join(dashboardRoot, "src") },
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  logLevel: "silent",
});

const require = module.createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { ChatMarkdown } = require(bundle);

// ── wiring ──────────────────────────────────────────────────────────────────

test("the family exposes exactly the one read tool", () => {
  assert.deepEqual([...IMAGE_SEARCH_TOOLS], ["image_search"]);
});

test("Quartz AI never receives it; the authenticated surfaces do", () => {
  assert.ok(!allowedToolsForSurface("quartz_ai").includes("image_search"));
  for (const surface of ["garden_chat", "dashboard_terminal"]) {
    assert.ok(
      allowedToolsForSurface(surface).includes("image_search"),
      `${surface} should receive image_search`,
    );
  }
});

test("the tool is brokered, so it cannot be inherited by default", () => {
  assert.ok(BROKERED_TOOLS.includes("image_search"));
});

test("the tool is registered with the runtime, in all three places", () => {
  const manifest = fs.readFileSync(
    path.join(repoRoot, "hermes-agent", "plugins", "breadboard", "plugin.yaml"),
    "utf8",
  );
  const plugin = fs.readFileSync(
    path.join(repoRoot, "hermes-agent", "plugins", "breadboard", "__init__.py"),
    "utf8",
  );
  assert.match(manifest, /^\s+- image_search$/m, "missing from plugin.yaml provides_tools");
  assert.match(
    plugin,
    /"image_search",\s*\n\s*"\/api\/hermes\/tools\/image-search",/,
    "the _TOOLS entry must pair the tool with its route",
  );
  assert.ok(
    fs.existsSync(
      path.join(
        repoRoot,
        "dashboard",
        "src",
        "app",
        "api",
        "hermes",
        "tools",
        "image-search",
        "route.ts",
      ),
    ),
    "the route the plugin posts to must exist",
  );
  // An unrecognized route_kind falls through to a premortem-shaped payload the
  // route does not understand, which would fail only at call time.
  assert.match(
    plugin,
    // Membership, not the exact set: other families join this branch over time,
    // and pinning the whole list makes an unrelated addition fail here.
    /route_kind in \{[^}]*"image_search"[^}]*\}/,
    "image_search must produce the {tool, args} payload its route reads",
  );
});

test("the display contract ships as a system prompt section whenever the tool is on", () => {
  const prompt = fs.readFileSync(
    path.join(repoRoot, "hermes-config", "system", "image-results.md"),
    "utf8",
  );
  assert.match(prompt, /```image-results/);
  assert.match(prompt, /nextPageStartIndex/);
  const composer = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "hermes", "system-prompts.ts"),
    "utf8",
  );
  assert.match(
    composer,
    /allowedTools\.includes\("image_search"\)[\s\S]{0,120}readSystemPrompt\("image-results"\)/,
    "the section must be gated on the tool being on the turn",
  );
});

test("the non-secret Runtime configuration marker selects the Google worker", () => {
  const saved = process.env.BREADBOARD_GOOGLE_IMAGES_CONFIGURED;
  try {
    process.env.BREADBOARD_GOOGLE_IMAGES_CONFIGURED = "";
    assert.equal(imageSearchMode(), "keyless", "no keys must mean zero-setup keyless search");
    process.env.BREADBOARD_GOOGLE_IMAGES_CONFIGURED = "true";
    assert.equal(imageSearchMode(), "google");
  } finally {
    if (saved === undefined) delete process.env.BREADBOARD_GOOGLE_IMAGES_CONFIGURED;
    else process.env.BREADBOARD_GOOGLE_IMAGES_CONFIGURED = saved;
  }
});

test("a nonsense query is refused before any process is involved", async () => {
  await assert.rejects(() => searchImages({ query: "   " }), /non-empty query/);
  await assert.rejects(() => searchImages({ query: "cat", count: 40 }), /between 1 and 10/);
});

test("Google image search is a fenced disposable Runtime job with sealed credentials", () => {
  const service = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "hermes", "image-search-service.ts"),
    "utf8",
  );
  const runtime = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "hermes", "image-search-runtime-v2.ts"),
    "utf8",
  );
  const worker = fs.readFileSync(
    path.join(dashboardRoot, "scripts", "runtime-v2-image-search-worker.mjs"),
    "utf8",
  );
  assert.doesNotMatch(service + runtime, /StdioClientTransport|node:child_process|\bspawn\s*\(/u);
  assert.match(runtime, /jobType:\s*"image-search-google"/u);
  assert.match(runtime, /cancelRuntimeJob\(authority/u);
  assert.match(worker, /StdioClientTransport/u);
  assert.match(worker, /BREADBOARD_GOOGLE_IMAGES_API_KEY/u);
  assert.doesNotMatch(service + runtime, /BREADBOARD_GOOGLE_IMAGES_API_KEY|SEARCH_ENGINE_ID/u);

  const canonical = { query: "red panda", count: 5, safe: null, startIndex: null };
  assert.equal(validateImageSearchRequest(canonical), canonical);
  for (const invalid of [
    { ...canonical, command: "node" },
    { ...canonical, count: 50 },
    { ...canonical, query: " red panda" },
    { ...canonical, startIndex: 92 },
  ]) assert.throws(() => validateImageSearchRequest(invalid), /canonical Google image-search request/);
});

// ── rendering ───────────────────────────────────────────────────────────────

const RESULTS = {
  query: "grumman f-11 tiger",
  items: [
    {
      title: "Grumman F11F Tiger in the hangar",
      image: "https://example.com/f11-full.jpg",
      thumb: "https://example.com/f11-thumb.jpg",
      page: "https://example.com/f11",
      site: "flugzeuginfo.net",
      w: 1200,
      h: 800,
    },
    {
      title: "Blue Angels F11F",
      image: "https://example.com/blue-full.jpg",
      thumb: "https://example.com/blue-thumb.jpg",
      page: "https://example.com/blue",
      site: "airhistory.net",
    },
  ],
};

function renderMessage(content) {
  return renderToStaticMarkup(React.createElement(ChatMarkdown, { content }));
}

test("an image-results block renders as a grid of zoomable cards, not as code", () => {
  const html = renderMessage(
    ["Assuming you mean the **Grumman F-11 Tiger**:", "", "```image-results", JSON.stringify(RESULTS), "```"].join("\n"),
  );
  assert.ok(html.includes('class="chat-image-results"'));
  // The zoom cursor rides both the card and its img — globals.css forces
  // `cursor: default` on markdown imgs, so the img must carry its own.
  assert.equal((html.match(/<button[^>]*cursor-zoom-in/g) ?? []).length, 2, "one card per item");
  assert.ok(html.includes("https://example.com/f11-full.jpg"));
  assert.ok(html.includes("https://example.com/blue-full.jpg"));
  // The grid replaces the code block entirely.
  assert.ok(!html.includes("chat-code-block"));
  // Chrome the text-selection feature must not capture.
  assert.ok(html.includes("data-selection-exclude"));
});

test("a half-streamed block renders as nothing rather than a broken grid", () => {
  const truncated = "```image-results\n" + JSON.stringify(RESULTS).slice(0, 40) + "\n```";
  const html = renderMessage(truncated);
  assert.ok(!html.includes("chat-image-results"));
  assert.ok(!html.includes("<img"), "no half-parsed images");
});

test("items without an http image are dropped; an empty payload renders nothing", () => {
  const poisoned = {
    query: "x",
    items: [
      { title: "bad", image: "javascript:alert(1)", thumb: "", page: "", site: "" },
      { title: "good", image: "https://example.com/ok.jpg", thumb: "", page: "", site: "" },
    ],
  };
  const html = renderMessage("```image-results\n" + JSON.stringify(poisoned) + "\n```");
  assert.ok(!html.includes("javascript:alert"), "a non-http scheme must never reach src");
  assert.ok(html.includes("https://example.com/ok.jpg"));

  const empty = renderMessage('```image-results\n{"query":"x","items":[]}\n```');
  assert.ok(!empty.includes("chat-image-results"));
});

test("ordinary fenced code still renders as a code block", () => {
  const html = renderMessage("```js\nconsole.log(1)\n```");
  assert.ok(html.includes("chat-code-block"));
  assert.ok(!html.includes("chat-image-results"));
});
