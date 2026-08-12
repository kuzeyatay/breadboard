// The Plan page's server/client boundary.
//
// This suite exists because of a real break: `page.tsx` imported `isPlanView`
// from `plan-client.tsx`, which carries "use client". A Server Component that
// imports a *value* from a client module gets a client reference, not the
// function, so calling it throws "Attempted to call isPlanView() from the
// server" and the whole page 500s — while tsc, eslint and a headless render of
// the client tree all stay green, because none of them model the boundary.
//
// The rule these tests encode: a Server Component may import components from a
// client module, and nothing else. Anything the server needs to *call* lives in
// lib, which is where the calendar already keeps `isCalendarView`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isPlanView } from "../src/lib/plan/view.ts";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "app");

const read = (relative) => fs.readFileSync(path.join(appDir, relative), "utf8");

/** Every import statement in a source file, as { names, from }. */
function imports(source) {
  return [...source.matchAll(/import\s+([^;]*?)\s+from\s+["']([^"']+)["']/g)].map((match) => ({
    clause: match[1].trim(),
    from: match[2],
  }));
}

function isClientModule(specifier, fromDir) {
  if (!specifier.startsWith(".")) return false;
  for (const extension of [".tsx", ".ts"]) {
    const candidate = path.join(fromDir, `${specifier}${extension}`);
    if (fs.existsSync(candidate)) {
      return /^\s*["']use client["']/.test(fs.readFileSync(candidate, "utf8"));
    }
  }
  return false;
}

test("the view type the server parses lives in lib, not in the client component", () => {
  assert.equal(isPlanView("board"), true);
  assert.equal(isPlanView("calendar"), true);
  assert.equal(isPlanView("agenda"), false);
  assert.equal(isPlanView(undefined), false);

  const client = read("plan/plan-client.tsx");
  assert.match(client, /^\s*"use client"/, "plan-client is a client module");
  assert.doesNotMatch(
    client,
    /export function isPlanView/,
    "isPlanView must not be defined in a client module — the server calls it",
  );
});

test("the Plan page imports only components from client modules", () => {
  const page = read("plan/page.tsx");
  const pageDir = path.join(appDir, "plan");

  for (const entry of imports(page)) {
    if (!isClientModule(entry.from, pageDir)) continue;
    // A default import is the component itself, which is exactly what a client
    // reference is for. Named value imports are the trap.
    assert.match(
      entry.clause,
      /^[A-Z][A-Za-z0-9]*$/,
      `page.tsx imports { ${entry.clause} } from the client module "${entry.from}" — ` +
        "a Server Component can only import components from a client module; " +
        "move anything it calls into src/lib",
    );
  }
});

test("the page calls isPlanView from lib and renders the client component", () => {
  const page = read("plan/page.tsx");
  assert.match(page, /from "@\/lib\/plan\/view\.ts"/);
  assert.match(page, /isPlanView\(rawView\)/);
  assert.match(page, /import PlanClient from "\.\/plan-client"/);
});

test("the /calendar stub is a server redirect with no client import at all", () => {
  const stub = read("calendar/page.tsx");
  assert.doesNotMatch(stub, /"use client"/);
  assert.match(stub, /redirect\(`\/plan\?/);
  for (const entry of imports(stub)) {
    assert.ok(
      !entry.from.startsWith("."),
      `the redirect stub should import nothing local; it imports "${entry.from}"`,
    );
  }
});
