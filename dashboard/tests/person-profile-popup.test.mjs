// Looking at someone else is a popup, not a screen.
//
// The two places that show another person's handle — a garden card that says
// who shared it, and the member list of an organization — used to navigate
// away, which lost whatever the reader was in the middle of. These assertions
// hold the popup in place: it renders, it wears the shared Breadboard scrim,
// and neither call site sends the page anywhere.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");

fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-person-popup-"),
);

// next/link is stubbed to a plain anchor: routing is not what is under test,
// and the real one drags the whole framework into the bundle.
const linkStub = path.join(outDirectory, "link.jsx");
fs.writeFileSync(
  linkStub,
  `import React from "react";\n` +
    `export default function Link({ href, children, ...rest }) {\n` +
    `  return React.createElement("a", { href, ...rest }, children);\n` +
    `}\n`,
  "utf8",
);

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as PersonProfileDialog } from "@/app/components/person-profile-dialog.tsx";\n`,
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
  alias: { "@": path.join(dashboardRoot, "src"), "next/link": linkStub },
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  logLevel: "silent",
});

const require = module.createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { PersonProfileDialog } = require(bundle);

test("the popup renders over the page with the shared Breadboard scrim", () => {
  const markup = renderToStaticMarkup(
    React.createElement(PersonProfileDialog, { username: "ada", onClose: () => {} }),
  );

  assert.match(markup, /bb-modal-backdrop/);
  assert.match(markup, /bb-modal-panel/);
  assert.doesNotMatch(markup, /backdrop-blur/);
  // The handle is known before the fetch answers, so the popup is never blank.
  assert.match(markup, /ada/);
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /Close profile/);
});

test("the shape crosses into the browser but the database does not", () => {
  assert.match(
    read("src/app/components/person-profile-dialog.tsx"),
    /import type \{ PersonProfile \}/,
  );
  // A value import of the reader would drag the whole SQLite layer in with it.
  assert.doesNotMatch(fs.readFileSync(bundle, "utf8"), /better-sqlite3/);
});

test("naming a person opens the popup instead of navigating", () => {
  for (const relativePath of ["src/app/dashboard/dashboard-client.tsx"]) {
    const source = read(relativePath);
    assert.doesNotMatch(
      source,
      /href=\{`\/profile\/\$\{encodeURIComponent/,
      `${relativePath} still links away to a person's own screen`,
    );
    assert.match(source, /PersonProfileDialog/);
    assert.match(source, /setOpenPerson\(/);
    // Keyed by handle, so a second person is a fresh mount rather than the
    // previous person's answer under a new name.
    assert.match(source, /key=\{openPerson\}/);
  }
});

test("an old link to a person's page lands on the popup, not a dead screen", () => {
  const page = read("src/app/profile/[username]/page.tsx");
  assert.match(page, /redirect\(/);
  assert.match(page, /\/dashboard\?person=/);
  // Nothing is rendered there any more.
  assert.doesNotMatch(page, /Shared gardens/);

  const dashboard = read("src/app/dashboard/dashboard-client.tsx");
  assert.match(dashboard, /query\.get\("person"\)/);
  assert.match(dashboard, /replaceState/);
});

test("the popup reads through a route that only answers signed-in callers", () => {
  const route = read("src/app/api/profile/[username]/route.ts");
  assert.match(route, /requireUserId/);
  assert.match(route, /readPersonProfile\(viewerId/);
  assert.match(route, /status: 404/);
});

test("a viewer only ever sees gardens they are allowed to open", () => {
  const reader = read("src/lib/profile/person-profile.ts");
  assert.match(reader, /visibility = 'public' OR \$\{organizationClusterClause\(viewerId, "c"\)\}/);
});
