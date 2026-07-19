import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createFilesystemGrantStore,
  FILESYSTEM_GRANT_DDL,
  GrantError,
} from "../src/lib/openharness/filesystem-grants.ts";
import {
  canonicalizePath,
  isWithinRoot,
  describePermissions,
  permissionsForCapabilities,
  candidatePathsForAlias,
  resolveAliasToGrant,
} from "../src/lib/openharness/filesystem-paths.ts";

const WINDOWS = process.platform === "win32";

function newStore() {
  const db = new Database(":memory:");
  db.exec(FILESYSTEM_GRANT_DDL);
  return createFilesystemGrantStore(db);
}

/** Build a throwaway directory tree and clean it up after the test. */
function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-grant-"));
  t.after(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort on Windows file locks */
    }
  });
  return fs.realpathSync.native(root);
}

const ALL = {
  read: true,
  create: true,
  modify: true,
  move: true,
  delete: true,
  execute: true,
};

/* ------------------------------------------------------------------ */
/* Canonicalization                                                    */
/* ------------------------------------------------------------------ */

test("relative paths are never canonicalized into grants", () => {
  assert.equal(canonicalizePath("some/relative/path"), null);
  assert.equal(canonicalizePath(""), null);
  assert.equal(canonicalizePath("   "), null);
});

test("paths containing control characters are rejected", () => {
  assert.equal(canonicalizePath(`C:\\Users\\me\\${String.fromCharCode(0)}evil`), null);
  assert.equal(canonicalizePath(`/home/me/${String.fromCharCode(10)}evil`), null);
});

test("traversal segments are collapsed during canonicalization", () => {
  // Three ascents from C:\Users\me\Documents reach the drive root.
  const base = WINDOWS
    ? "C:\\Users\\me\\Documents\\..\\..\\..\\Windows"
    : "/home/me/docs/../../../etc";
  const expected = WINDOWS ? "C:\\Windows" : "/etc";
  assert.equal(canonicalizePath(base), expected);

  // A partial ascent stays where the arithmetic actually lands.
  const partial = WINDOWS
    ? "C:\\Users\\me\\Documents\\..\\..\\Windows"
    : "/home/me/docs/../../etc";
  assert.equal(canonicalizePath(partial), WINDOWS ? "C:\\Users\\Windows" : "/home/etc");
});

test("containment is segment-aware, not prefix-based", () => {
  const a = WINDOWS ? "C:\\Data\\Docs" : "/data/docs";
  const sibling = WINDOWS ? "C:\\Data\\Docs2" : "/data/docs2";
  const child = WINDOWS ? "C:\\Data\\Docs\\sub" : "/data/docs/sub";
  assert.equal(isWithinRoot(a, child), true);
  assert.equal(isWithinRoot(a, a), true);
  assert.equal(isWithinRoot(a, sibling), false);
});

test("Windows path comparison is case-insensitive on Windows only", () => {
  if (!WINDOWS) return;
  assert.equal(isWithinRoot("C:\\Data\\Docs", "c:\\data\\docs\\file.txt"), true);
});

/* ------------------------------------------------------------------ */
/* Grant lifecycle                                                     */
/* ------------------------------------------------------------------ */

test("an approved folder can be listed and read", (t) => {
  const root = sandbox(t);
  const store = newStore();
  fs.writeFileSync(path.join(root, "note.txt"), "hi");

  store.grant({ userId: 1, requestedPath: root, permissions: { read: true } });
  const decision = store.authorize(1, path.join(root, "note.txt"), "read");
  assert.equal(decision.allowed, true);
});

test("a missing approval produces a permission request, not a refusal", (t) => {
  const root = sandbox(t);
  const store = newStore();
  const decision = store.authorize(1, path.join(root, "note.txt"), "read");
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "no_grant");
  // The message must name the folder so the UI can offer to approve it.
  assert.ok(decision.message.includes(root) || decision.canonicalPath?.includes(root));
});

test("granting a non-existent folder is refused", () => {
  const store = newStore();
  assert.throws(
    () =>
      store.grant({
        userId: 1,
        requestedPath: path.join(os.tmpdir(), "bb-does-not-exist-xyz"),
        permissions: ALL,
      }),
    (error) => error instanceof GrantError && error.code === "path_not_found",
  );
});

test("granting a file rather than a folder is refused", (t) => {
  const root = sandbox(t);
  const file = path.join(root, "a.txt");
  fs.writeFileSync(file, "x");
  const store = newStore();
  assert.throws(
    () => store.grant({ userId: 1, requestedPath: file, permissions: ALL }),
    (error) => error instanceof GrantError && error.code === "not_a_directory",
  );
});

/* ------------------------------------------------------------------ */
/* Per-operation separation                                            */
/* ------------------------------------------------------------------ */

test("read access does not grant write access", (t) => {
  const root = sandbox(t);
  const store = newStore();
  store.grant({ userId: 1, requestedPath: root, permissions: { read: true } });

  assert.equal(store.authorize(1, path.join(root, "f.txt"), "read").allowed, true);
  const write = store.authorize(1, path.join(root, "f.txt"), "create");
  assert.equal(write.allowed, false);
  assert.equal(write.reason, "operation_not_permitted");
});

test("write access does not grant deletion", (t) => {
  const root = sandbox(t);
  const store = newStore();
  store.grant({
    userId: 1,
    requestedPath: root,
    permissions: { read: true, create: true, modify: true, move: true },
  });

  assert.equal(store.authorize(1, path.join(root, "f.txt"), "move").allowed, true);
  const remove = store.authorize(1, path.join(root, "f.txt"), "delete");
  assert.equal(remove.allowed, false);
  assert.equal(remove.reason, "operation_not_permitted");
});

test("nothing implies execute", (t) => {
  const root = sandbox(t);
  const store = newStore();
  store.grant({
    userId: 1,
    requestedPath: root,
    permissions: { read: true, create: true, modify: true, move: true, delete: true },
  });
  assert.equal(store.authorize(1, path.join(root, "run.exe"), "execute").allowed, false);
});

/* ------------------------------------------------------------------ */
/* Escape prevention                                                   */
/* ------------------------------------------------------------------ */

test("traversal outside a granted root is rejected", (t) => {
  const root = sandbox(t);
  const inside = path.join(root, "granted");
  const outside = path.join(root, "secret");
  fs.mkdirSync(inside);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "keys.txt"), "s3cret");

  const store = newStore();
  store.grant({ userId: 1, requestedPath: inside, permissions: ALL });

  const decision = store.authorize(1, path.join(inside, "..", "secret", "keys.txt"), "read");
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "no_grant");
});

test("a junction or symlink cannot escape a granted root", (t) => {
  const root = sandbox(t);
  const inside = path.join(root, "granted");
  const outside = path.join(root, "secret");
  fs.mkdirSync(inside);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "keys.txt"), "s3cret");

  const linkPath = path.join(inside, "escape");
  try {
    // 'junction' works on Windows without elevation; it is ignored elsewhere.
    fs.symlinkSync(outside, linkPath, WINDOWS ? "junction" : "dir");
  } catch {
    t.skip("symlink/junction creation not permitted in this environment");
    return;
  }

  const store = newStore();
  store.grant({ userId: 1, requestedPath: inside, permissions: ALL });

  // Lexically this path is inside the grant; really it is not.
  const decision = store.authorize(1, path.join(linkPath, "keys.txt"), "read");
  assert.equal(decision.allowed, false, "link traversal must not be authorized");
  assert.equal(decision.reason, "escapes_root");
});

test("a similarly named unapproved folder is not substituted", (t) => {
  const root = sandbox(t);
  const approved = path.join(root, "Documents");
  const lookalike = path.join(root, "Documents Backup");
  fs.mkdirSync(approved);
  fs.mkdirSync(lookalike);

  const store = newStore();
  store.grant({ userId: 1, requestedPath: approved, permissions: ALL });

  assert.equal(store.authorize(1, path.join(approved, "a.txt"), "read").allowed, true);
  assert.equal(store.authorize(1, path.join(lookalike, "a.txt"), "read").allowed, false);
});

/* ------------------------------------------------------------------ */
/* Isolation, revocation, scope                                        */
/* ------------------------------------------------------------------ */

test("one user's grant is invisible and unusable to another", (t) => {
  const root = sandbox(t);
  const store = newStore();
  store.grant({ userId: 1, requestedPath: root, permissions: ALL });

  assert.equal(store.list(2).length, 0);
  assert.equal(store.authorize(2, path.join(root, "f.txt"), "read").allowed, false);
});

test("a revoked grant stops working", (t) => {
  const root = sandbox(t);
  const store = newStore();
  const granted = store.grant({ userId: 1, requestedPath: root, permissions: ALL });
  assert.equal(store.authorize(1, path.join(root, "f.txt"), "read").allowed, true);

  assert.equal(store.revoke(1, granted.id), true);
  assert.equal(store.authorize(1, path.join(root, "f.txt"), "read").allowed, false);
  assert.equal(store.list(1).length, 0);
  assert.equal(store.list(1, true).length, 1);
});

test("another user cannot revoke a grant they do not own", (t) => {
  const root = sandbox(t);
  const store = newStore();
  const granted = store.grant({ userId: 1, requestedPath: root, permissions: ALL });
  assert.equal(store.revoke(2, granted.id), false);
  assert.equal(store.authorize(1, path.join(root, "f.txt"), "read").allowed, true);
});

test("one-time grants are consumed when the turn ends", (t) => {
  const root = sandbox(t);
  const store = newStore();
  store.grant({ userId: 1, requestedPath: root, permissions: ALL, scope: "one_time" });
  assert.equal(store.authorize(1, path.join(root, "f.txt"), "read").allowed, true);

  assert.equal(store.expireOneTime(1), 1);
  assert.equal(store.authorize(1, path.join(root, "f.txt"), "read").allowed, false);
});

test("a remembered grant survives one-time expiry", (t) => {
  const root = sandbox(t);
  const store = newStore();
  store.grant({ userId: 1, requestedPath: root, permissions: ALL, scope: "remembered" });
  store.expireOneTime(1);
  assert.equal(store.authorize(1, path.join(root, "f.txt"), "read").allowed, true);
});

test("re-granting narrows or widens permissions without duplicating the row", (t) => {
  const root = sandbox(t);
  const store = newStore();
  store.grant({ userId: 1, requestedPath: root, permissions: ALL });
  store.grant({ userId: 1, requestedPath: root, permissions: { read: true } });

  assert.equal(store.list(1).length, 1);
  assert.equal(store.authorize(1, path.join(root, "f.txt"), "delete").allowed, false);
});

test("a narrower subfolder grant can be selected instead of the parent", (t) => {
  const root = sandbox(t);
  const child = path.join(root, "Invoices");
  fs.mkdirSync(child);
  const store = newStore();
  store.grant({ userId: 1, requestedPath: child, permissions: ALL });

  assert.equal(store.authorize(1, path.join(child, "a.pdf"), "delete").allowed, true);
  // The parent is not covered by a child grant.
  assert.equal(store.authorize(1, path.join(root, "b.pdf"), "read").allowed, false);
});

test("the deepest matching grant supplies the permission", (t) => {
  const root = sandbox(t);
  const child = path.join(root, "Writable");
  fs.mkdirSync(child);
  const store = newStore();
  store.grant({ userId: 1, requestedPath: root, permissions: { read: true } });
  store.grant({ userId: 1, requestedPath: child, permissions: { read: true, create: true } });

  assert.equal(store.authorize(1, path.join(child, "n.txt"), "create").allowed, true);
  assert.equal(store.authorize(1, path.join(root, "n.txt"), "create").allowed, false);
});

/* ------------------------------------------------------------------ */
/* Aliases                                                             */
/* ------------------------------------------------------------------ */

test("a spoken alias never creates authority on its own", (t) => {
  const store = newStore();
  assert.equal(store.resolveAlias(1, "Documents"), null);
});

test("an alias resolves once the covering folder is approved", (t) => {
  const store = newStore();
  const candidates = candidatePathsForAlias("Downloads");
  if (candidates.length === 0) {
    t.skip("no Downloads candidate on this platform");
    return;
  }
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  if (!existing) {
    t.skip("no existing Downloads folder to approve");
    return;
  }
  store.grant({ userId: 1, requestedPath: existing, permissions: { read: true } });
  const resolved = store.resolveAlias(1, "Downloads");
  assert.ok(resolved, "alias should resolve to the approved root");
});

test("alias candidates include OneDrive redirected folders when configured", () => {
  const previous = process.env.OneDrive;
  process.env.OneDrive = WINDOWS ? "C:\\Users\\me\\OneDrive" : "/home/me/OneDrive";
  try {
    const candidates = candidatePathsForAlias("Documents");
    assert.ok(
      candidates.some((candidate) => /OneDrive/i.test(candidate)),
      "OneDrive Documents should be a candidate",
    );
  } finally {
    if (previous === undefined) delete process.env.OneDrive;
    else process.env.OneDrive = previous;
  }
});

test("an unknown alias yields no candidates", () => {
  assert.deepEqual(candidatePathsForAlias("Nonexistent Vault"), []);
});

test("resolveAliasToGrant matches a parent grant above the alias", () => {
  const home = os.homedir();
  const grants = [
    {
      id: "1",
      userId: 1,
      canonicalPath: home,
      displayName: "Home",
      permissions: { ...ALL },
      scope: "remembered",
      createdAt: "now",
      revokedAt: null,
    },
  ];
  const resolved = resolveAliasToGrant("Documents", grants);
  assert.ok(resolved, "a home-folder grant should cover Documents beneath it");
});

/* ------------------------------------------------------------------ */
/* Capability mapping and prompt wording                               */
/* ------------------------------------------------------------------ */

test("capabilities map to the minimum filesystem permissions", () => {
  const readOnly = permissionsForCapabilities(["filesystem_read"]);
  assert.equal(readOnly.read, true);
  assert.equal(readOnly.create, false);
  assert.equal(readOnly.delete, false);
  assert.equal(readOnly.execute, false);

  const organize = permissionsForCapabilities(["filesystem_read", "filesystem_write"]);
  assert.equal(organize.move, true);
  assert.equal(organize.delete, false);

  const destructive = permissionsForCapabilities(["destructive_filesystem"]);
  assert.equal(destructive.delete, true);
});

test("permission prompts are concrete about what will and will not happen", () => {
  const description = describePermissions(permissionsForCapabilities([
    "filesystem_read",
    "filesystem_write",
  ]));
  assert.ok(description.includes("move and rename files"));
  assert.ok(/I will not[^.]*delete files/.test(description));
  assert.ok(!/technical access/i.test(description));
});
