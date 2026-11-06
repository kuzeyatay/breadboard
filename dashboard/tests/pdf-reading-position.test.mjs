import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import ts from "typescript";
import * as identity from "../src/lib/pdf-reading-position.ts";
import * as storage from "../src/lib/pdf-reading-position-store.ts";
import { pdfReadingPositionKey, validPdfPage } from "../src/lib/pdf-reading-position.ts";
import { ensurePdfReadingPositionSchema, readPdfReadingPosition, writePdfReadingPosition } from "../src/lib/pdf-reading-position-store.ts";

test("PDF positions survive reopening the database and stay separate by account and document", t => {
  const directory = mkdtempSync(path.join(tmpdir(), "breadboard-pdf-position-"));
  let db = new Database(path.join(directory, "reading.db"));
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1), (2)");
  ensurePdfReadingPositionSchema(db);
  const source = "/api/documents/book/source-pdf?clusterSlug=course";
  writePdfReadingPosition(db, 1, source, 37, 100);
  writePdfReadingPosition(db, 2, source, 9, 101);
  writePdfReadingPosition(db, 1, "/api/attachments/other.pdf", 5, 102);
  db.close();
  db = new Database(path.join(directory, "reading.db"));
  ensurePdfReadingPositionSchema(db);
  assert.equal(readPdfReadingPosition(db, 1, source), 37);
  assert.equal(readPdfReadingPosition(db, 2, source), 9);
  assert.equal(readPdfReadingPosition(db, 1, "/api/attachments/other.pdf"), 5);
  assert.equal(readPdfReadingPosition(db, 1, "/api/attachments/unread.pdf"), null);
  writePdfReadingPosition(db, 1, source, 40, 104);
  writePdfReadingPosition(db, 1, source, 38, 103);
  assert.equal(readPdfReadingPosition(db, 1, source), 40, "a late request cannot undo a newer page");
  for (const page of [0, -1, 1.5, NaN, Infinity, "1"]) {
    assert.throws(() => writePdfReadingPosition(db, 1, source, page, 105));
    assert.equal(readPdfReadingPosition(db, 1, source), 40);
  }
});

test("source identity ignores fragments and query order and rejects non-local sources", () => {
  assert.equal(pdfReadingPositionKey("/api/pdf?z=2&a=1#page=4"), "/api/pdf?a=1&z=2");
  for (const source of [null, "", "https://example.com/a.pdf", "//example.com/a.pdf", "/\\example.com", "/bad\npath"]) {
    assert.equal(pdfReadingPositionKey(source), null);
  }
  assert.equal(validPdfPage(1), true);
  assert.equal(validPdfPage(1.5), false);
});

test("reading position API requires authentication, validates writes and scopes reads to the session", async t => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1), (2)");
  let userId = 1;
  class RouteError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const modules = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/db": { default: db },
    "@/lib/server-auth": {
      RouteError,
      requireUserId: async () => { if (!userId) throw new RouteError(401, "Unauthorized"); return userId; },
      routeErrorResponse: error => Response.json({ error: error.message }, { status: error.status ?? 500 }),
    },
    "@/lib/pdf-reading-position": identity,
    "@/lib/pdf-reading-position-store": storage,
  };
  const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const load = file => {
    const exports = {};
    new Function("require", "exports", compile(file))(name => {
      assert.ok(name in modules, `Unexpected import ${name}`); return modules[name];
    }, exports);
    return exports;
  };
  modules["@/lib/request-origin"] = load("../src/lib/request-origin.ts");
  const route = load("../src/app/api/pdf-reading-position/route.ts");
  const source = "/api/documents/a/source-pdf?clusterSlug=b";
  const get = () => route.GET(new Request(`http://localhost/api/pdf-reading-position?${new URLSearchParams({ source })}`));
  const put = (body, origin = "http://localhost") => route.PUT(new Request("http://localhost/api/pdf-reading-position", {
    method: "PUT", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  assert.equal((await put({ source, page: 12, observedAt: 100, userId: 2 })).status, 200);
  let response = await get();
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { page: 12 });
  userId = 2;
  assert.deepEqual(await (await get()).json(), { page: null });
  for (const body of [null, {}, { source, page: 0, observedAt: 100 }, { source, page: 2 }, { source: "//evil.test/a", page: 2, observedAt: 100 }]) {
    assert.equal((await put(body)).status, 400);
  }
  assert.equal((await put({ source, page: 2, observedAt: 101 }, "https://evil.test")).status, 403);
  userId = null;
  assert.equal((await get()).status, 401);
  assert.equal((await put({ source, page: 2, observedAt: 101 })).status, 401);
});
