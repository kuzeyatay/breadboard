// Renders the two new profile panels for real (esbuild -> CJS -> react-dom/server)
// rather than reasoning about what they would produce.
//
// The states worth pinning down are the ones that carry a claim: a contact the
// app filed on its own has to say so, and a calendar that syncs both ways has
// to distinguish "spoke to the server, all well" from "tried, and could not".

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

// The stamps the panel reads are the ones the calendar writes: local wall clock,
// no zone. Building the fixture any other way (an ISO string, say) is off by the
// machine's offset and the freshness badge reads hours stale.
import { nowStamp } from "../src/lib/calendar/wallclock.ts";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-profile-panels-"),
);

after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as ContactsPanel } from "@/app/profile/contacts-panel";\n` +
    `export { default as CalendarSyncPanel } from "@/app/profile/calendar-sync-panel";\n`,
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
const { ContactsPanel, CalendarSyncPanel } = require(bundle);

const contact = (overrides = {}) => ({
  id: 1,
  name: "Sarah Chen",
  organization: null,
  phone: null,
  notes: null,
  favorite: false,
  source: "manual",
  emails: [{ email: "sarah@example.com", label: null, primary: true }],
  lastSeenAt: null,
  createdAt: "2026-08-01 10:00:00",
  updatedAt: "2026-08-01 10:00:00",
  ...overrides,
});

const calendar = (overrides = {}) => ({
  id: 3,
  name: "Work",
  color: "#4f6f68",
  visible: true,
  sortOrder: 0,
  sourceUrl: null,
  readOnly: false,
  lastSyncedAt: null,
  syncError: null,
  caldavUrl: "https://cloud.example.com/remote.php/dav/calendars/sarah/work/",
  caldavUsername: "sarah",
  createdAt: "2026-08-01 10:00:00",
  ...overrides,
});

// -------------------------------------------------------------- address book

test("an empty address book says how it fills itself", () => {
  const html = renderToStaticMarkup(
    React.createElement(ContactsPanel, { initial: [], initialTotal: 0 }),
  );
  assert.match(html, /Invite someone to an event and they will appear/);
});

test("a contact filed automatically is labelled, a typed one is not", () => {
  const html = renderToStaticMarkup(
    React.createElement(ContactsPanel, {
      initial: [
        contact({ id: 1, name: "Sarah Chen" }),
        contact({
          id: 2,
          name: "Tom Reed",
          source: "auto",
          emails: [{ email: "tom@example.com", label: null, primary: true }],
        }),
      ],
      initialTotal: 2,
    }),
  );

  assert.match(html, /Sarah Chen/);
  assert.match(html, /Tom Reed/);
  assert.equal(html.match(/Learned/g)?.length, 1, "only the automatic row is labelled");
  assert.match(html, /2 people, 1 of them filed for you/);
});

test("a person with several addresses shows the count, and the primary one", () => {
  const html = renderToStaticMarkup(
    React.createElement(ContactsPanel, {
      initial: [
        contact({
          emails: [
            { email: "sarah@work.example", label: "work", primary: true },
            { email: "sarah@home.example", label: "home", primary: false },
          ],
        }),
      ],
      initialTotal: 1,
    }),
  );

  assert.match(html, /2 addresses/);
  assert.match(html, /sarah@work\.example/);
});

// -------------------------------------------------------------- calendar sync

test("with nothing connected the panel offers the form and no status", () => {
  const html = renderToStaticMarkup(
    React.createElement(CalendarSyncPanel, { initial: [], vaultConfigured: true }),
  );

  assert.match(html, /No calendar syncs yet/);
  assert.match(html, /Find calendars/);
  assert.doesNotMatch(html, /Two-way/);
});

test("a healthy calendar reads as two-way and dates its last exchange", () => {
  const html = renderToStaticMarkup(
    React.createElement(CalendarSyncPanel, {
      initial: [calendar({ lastSyncedAt: nowStamp() })],
      vaultConfigured: true,
    }),
  );

  assert.match(html, /Two-way/);
  assert.match(html, /just now|[0-9]+m ago/);
  assert.match(html, /cloud\.example\.com/);
  assert.doesNotMatch(html, /Needs attention/);
});

test("a failing calendar says so, and says why, in place of the freshness", () => {
  const html = renderToStaticMarkup(
    React.createElement(CalendarSyncPanel, {
      initial: [
        calendar({
          lastSyncedAt: "2026-08-19T09:00",
          syncError: "The server did not accept that username and password.",
        }),
      ],
      vaultConfigured: true,
    }),
  );

  assert.match(html, /Needs attention/);
  assert.match(html, /did not accept that username and password/);
});

test("without a vault key the panel explains before a password is typed", () => {
  const html = renderToStaticMarkup(
    React.createElement(CalendarSyncPanel, { initial: [], vaultConfigured: false }),
  );

  assert.match(html, /NEXTAUTH_SECRET/);
  assert.match(html, /nowhere safe to keep the password/);
  assert.match(html, /disabled=""/, "connecting is refused, not merely discouraged");
});
