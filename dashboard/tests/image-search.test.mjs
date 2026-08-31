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
import {
  clearGoogleImageCredentials,
  googleImageCredentialsStatus,
  readGoogleImageCredentials,
  storeGoogleImageCredentials,
} from "../src/lib/hermes/image-search-credentials.ts";
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
  [
    `export { default as ChatMarkdown } from "@/app/components/chat-markdown";`,
    `export { wrappedImageIndex } from "@/app/components/chat-image-results";`,
    "",
  ].join("\n"),
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
const { ChatMarkdown, wrappedImageIndex } = require(bundle);

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

test("saved profile credentials select the Google worker", () => {
  assert.equal(imageSearchMode(false), "keyless");
  assert.equal(imageSearchMode(true), "google");
});

test("Google image-search credentials are encrypted and scoped to one profile", () => {
  const credentialsDirectory = path.join(outDirectory, "google-image-credentials");
  const savedDirectory = process.env.BREADBOARD_GOOGLE_IMAGES_CREDENTIALS_DIR;
  const savedSecret = process.env.NEXTAUTH_SECRET;
  process.env.BREADBOARD_GOOGLE_IMAGES_CREDENTIALS_DIR = credentialsDirectory;
  process.env.NEXTAUTH_SECRET = "test-only-google-images-vault-secret";
  try {
    assert.deepEqual(googleImageCredentialsStatus(41), {
      available: true,
      configured: false,
    });
    const credentials = {
      apiKey: "AIzaSyD-example-google-images-key",
      searchEngineId: "012345678901234567890:abcdef-ghij",
    };
    storeGoogleImageCredentials(41, credentials);
    assert.deepEqual(readGoogleImageCredentials(41), credentials);
    assert.equal(readGoogleImageCredentials(42), null, "another profile cannot inherit the key");
    assert.deepEqual(googleImageCredentialsStatus(41), {
      available: true,
      configured: true,
    });
    const stored = fs.readFileSync(path.join(credentialsDirectory, "user-41.json"), "utf8");
    assert.doesNotMatch(stored, /AIzaSyD|abcdef-ghij/u, "the credential file must be sealed");
    clearGoogleImageCredentials(41);
    assert.equal(readGoogleImageCredentials(41), null);
  } finally {
    if (savedDirectory === undefined) {
      delete process.env.BREADBOARD_GOOGLE_IMAGES_CREDENTIALS_DIR;
    } else {
      process.env.BREADBOARD_GOOGLE_IMAGES_CREDENTIALS_DIR = savedDirectory;
    }
    if (savedSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = savedSecret;
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
  assert.match(service, /readGoogleImageCredentials/u);
  assert.match(runtime, /jobType:\s*"image-search-google"/u);
  assert.match(runtime, /inputUploads:\s*\[\{ uploadId: reservation\.uploadId \}\]/u);
  assert.match(runtime, /cancelRuntimeJob\(authority/u);
  assert.match(worker, /StdioClientTransport/u);
  assert.match(worker, /canonicalRuntimeInput\(launch, 0\)/u);
  assert.match(worker, /expectedInputCount:\s*\(\) => 1/u);
  assert.doesNotMatch(
    service + runtime + worker,
    /BREADBOARD_GOOGLE_IMAGES_API_KEY|BREADBOARD_GOOGLE_IMAGES_SEARCH_ENGINE_ID/u,
  );

  const canonical = { query: "red panda", count: 5, safe: null, startIndex: null };
  assert.equal(validateImageSearchRequest(canonical), canonical);
  for (const invalid of [
    { ...canonical, command: "node" },
    { ...canonical, count: 50 },
    { ...canonical, query: " red panda" },
    { ...canonical, startIndex: 92 },
  ]) assert.throws(() => validateImageSearchRequest(invalid), /canonical Google image-search request/);
});

test("the Profile page owns Google image-generation credential setup", () => {
  const page = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "profile", "page.tsx"),
    "utf8",
  );
  const client = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "profile", "profile-client.tsx"),
    "utf8",
  );
  const route = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "profile", "google-images", "route.ts"),
    "utf8",
  );
  assert.match(page, /googleImageGenerationCredentialsStatus\(userId\)/u);
  assert.match(client, /title="Google Image Generation"/u);
  assert.match(client, /Google AI Studio/u);
  assert.doesNotMatch(client, /Programmable Search Engine ID/u);
  assert.match(client, /\/api\/profile\/google-images/u);
  assert.match(route, /requireUserId\(\)/u);
  assert.match(route, /storeGoogleImageGenerationCredentials/u);
  assert.doesNotMatch(
    route,
    /readGoogleImageGenerationCredentials/u,
    "the settings API never returns a key",
  );
});

test("the image viewer keeps both navigation directions available", () => {
  assert.equal(wrappedImageIndex(0, -1, 6), 5, "left from the first image wraps to the last");
  assert.equal(wrappedImageIndex(5, 1, 6), 0, "right from the last image wraps to the first");

  const viewer = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "components", "chat-image-results.tsx"),
    "utf8",
  );
  assert.match(viewer, /aria-label="Previous image"[\s\S]{0,800}stroke="#fff"/u);
  assert.match(viewer, /aria-label="Next image"[\s\S]{0,800}stroke="#fff"/u);
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

test("an image-results block renders as a proportional masonry gallery, not as code", () => {
  const html = renderMessage(
    ["Assuming you mean the **Grumman F-11 Tiger**:", "", "```image-results", JSON.stringify(RESULTS), "```"].join("\n"),
  );
  assert.ok(html.includes('class="chat-image-results"'));
  assert.ok(
    html.includes('class="columns-2 gap-2"'),
    "the gallery keeps at most two large images across",
  );
  assert.ok(
    html.includes('width="1200" height="800"'),
    "known source dimensions preserve the original aspect ratio before loading",
  );
  assert.ok(!html.includes("aspect-square"), "gallery cards must not force square crops");
  assert.ok(
    html.includes("block h-auto w-full cursor-zoom-in rounded-[18px]"),
    "gallery images size their height from their original proportions",
  );
  // The zoom cursor rides both the card and its img — globals.css forces
  // `cursor: default` on markdown imgs, so the img must carry its own.
  assert.equal((html.match(/<button[^>]*cursor-zoom-in/g) ?? []).length, 2, "one card per item");
  assert.equal(
    (html.match(/neu-surface-raised/g) ?? []).length,
    0,
    "image cards have no raised white frame",
  );
  assert.equal(
    (html.match(/<button[^>]*border-0[^>]*bg-transparent[^>]*p-0/g) ?? []).length,
    2,
    "image cards have no border or padding",
  );
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
