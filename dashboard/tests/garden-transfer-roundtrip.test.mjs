// A real round trip: export a garden and a cluster out of a database, then
// import both back into the same one. Both the database and the content root
// are redirected into temp directories, so this runs against the actual
// modules — `db.ts`, the cluster tree, the archive layer — without touching
// the developer's install.
//
// Expect "[transfer] import succeeded but republishing failed" on stderr:
// `knowledge.ts` and `quartz-garden-index.ts` reach the webpack-only `@/`
// alias and cannot be resolved by `node --test`. That the import still
// succeeds is the point — republishing runs after the commit and is reported
// rather than thrown.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-transfer-"));
const contentRoot = path.join(dataRoot, "content");
fs.mkdirSync(contentRoot, { recursive: true });
process.env.BREADBOARD_DATA_DIR = dataRoot;
process.env.QUARTZ_CONTENT_PATH = contentRoot;

const { default: db } = await import("../src/lib/db.ts");
const { exportClusterArchive, exportGardenArchive } = await import(
  "../src/lib/garden-transfer/export.ts"
);
const { importTransferArchive } = await import(
  "../src/lib/garden-transfer/import.ts"
);
const { TransferError } = await import("../src/lib/garden-transfer/format.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

const USER = db
  .prepare(
    "INSERT INTO users (username, email, password_hash) VALUES ('tester', 'tester@example.com', 'x')",
  )
  .run().lastInsertRowid;
const OTHER_USER = db
  .prepare(
    "INSERT INTO users (username, email, password_hash) VALUES ('other', 'other@example.com', 'x')",
  )
  .run().lastInsertRowid;

function writeFile(root, relPath, contents) {
  const target = path.join(root, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

/** A garden row plus a directory with content and some rebuild scratch. */
function seedGarden(slug, name, folder, userId = USER) {
  db.prepare(
    `INSERT INTO clusters (user_id, name, slug, description, visibility, border_color, card_width, card_height, chat_accessible, fork_allowed, folder)
     VALUES (?, ?, ?, ?, 'public', '#facc15', 420, 260, 1, 1, ?)`,
  ).run(userId, name, slug, `${name} description`, folder);

  const dir = path.join(contentRoot, slug);
  writeFile(dir, "_index.md", `---\ntitle: ${name}\n---\n`);
  writeFile(dir, `learning/1. ${slug}.md`, `# ${name}\n`);
  writeFile(dir, "assets/diagram.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFile(dir, ".breadboard/source-anchors.json", '{"anchors":[]}\n');
  writeFile(dir, ".breadboard/backups/old/stale.md", "stale\n");
  return dir;
}

function gardenRow(slug) {
  return db.prepare("SELECT * FROM clusters WHERE slug = ?").get(slug);
}

function relativeFiles(dir) {
  const found = [];
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
      else found.push(rel);
    }
  };
  walk(dir, "");
  return found.sort();
}

describe("exporting and importing a garden", () => {
  seedGarden("signals", "Signals", "EE Year 1/Semester 2");

  const download = exportGardenArchive(USER, "signals");

  test("the download is named and typed after the file format", () => {
    assert.equal(download.kind, "garden");
    assert.equal(download.filename, "signals.garden");
    assert.equal(download.mimeType, "application/vnd.breadboard.garden+zip");
    assert.equal(download.summary.gardens, 1);
    assert.equal(download.summary.files, 4);
  });

  test("only the owner can export it", () => {
    assert.throws(() => exportGardenArchive(OTHER_USER, "signals"), TransferError);
    assert.throws(() => exportGardenArchive(USER, "does-not-exist"), /not found/);
  });

  test("importing it back makes a second, independent garden", async () => {
    const result = await importTransferArchive(USER, download.buffer);

    assert.equal(result.kind, "garden");
    assert.equal(result.gardens.length, 1);
    const [imported] = result.gardens;
    assert.equal(imported.name, "Signals");
    assert.notEqual(imported.slug, "signals");
    // With no target it returns to the cluster path it was exported from.
    assert.equal(imported.folder, "EE Year 1/Semester 2");

    const row = gardenRow(imported.slug);
    assert.equal(row.user_id, Number(USER));
    assert.equal(row.description, "Signals description");
    assert.equal(row.border_color, "#facc15");
    assert.equal(row.card_width, 420);
    // Publishing is never inherited: an import lands private and unshared.
    assert.equal(row.visibility, "private");
    assert.equal(row.chat_accessible, 0);
    assert.equal(row.fork_allowed, 0);

    // The cluster path it names now exists in the tree.
    assert.ok(
      db
        .prepare("SELECT 1 FROM cluster_folders WHERE user_id = ? AND name = ?")
        .get(USER, "EE Year 1/Semester 2"),
    );
  });

  test("the content arrives, without the rebuild scratch", async () => {
    const result = await importTransferArchive(USER, download.buffer);
    const dir = path.join(contentRoot, result.gardens[0].slug);

    assert.deepEqual(relativeFiles(dir), [
      ".breadboard/source-anchors.json",
      "_index.md",
      "assets/diagram.png",
      "learning/1. signals.md",
    ]);
    assert.equal(
      fs.readFileSync(path.join(dir, "learning/1. signals.md"), "utf-8"),
      "# Signals\n",
    );
  });

  test("a target cluster overrides where it lands", async () => {
    const result = await importTransferArchive(USER, download.buffer, {
      targetFolder: "Archive",
    });
    assert.equal(result.gardens[0].folder, "Archive");
    assert.equal(gardenRow(result.gardens[0].slug).folder, "Archive");
  });
});

describe("exporting and importing a cluster", () => {
  seedGarden("circuits", "Circuits", "EE Year 2");
  seedGarden("fields", "Fields", "EE Year 2/Semester 1");
  seedGarden("elsewhere", "Elsewhere", "Other");
  seedGarden("not-mine", "Not Mine", "EE Year 2", OTHER_USER);
  db.prepare(
    "INSERT INTO cluster_folders (user_id, name) VALUES (?, 'EE Year 2/Empty')",
  ).run(USER);

  const download = exportClusterArchive(USER, "EE Year 2");

  test("it carries the whole subtree and nothing outside it", () => {
    assert.equal(download.kind, "cluster");
    assert.equal(download.filename, "ee-year-2.cluster");
    assert.equal(download.mimeType, "application/vnd.breadboard.cluster+zip");
    // Circuits and Fields, but not Elsewhere and not another user's garden.
    assert.equal(download.summary.gardens, 2);
    assert.equal(download.summary.files, 8);
  });

  test("an empty or unknown cluster is a 404, not an empty file", () => {
    assert.throws(() => exportClusterArchive(USER, "No Such Cluster"), /not found/);
    assert.throws(() => exportClusterArchive(USER, ""), /cluster is required/i);
  });

  test("importing it rebuilds the tree under a free name", async () => {
    const result = await importTransferArchive(USER, download.buffer);

    // "EE Year 2" is taken, so the imported copy is suffixed rather than merged.
    assert.equal(result.clusterPath, "EE Year 2 2");
    assert.equal(result.gardens.length, 2);

    const byName = Object.fromEntries(
      result.gardens.map((garden) => [garden.name, garden]),
    );
    assert.equal(byName.Circuits.folder, "EE Year 2 2");
    assert.equal(byName.Fields.folder, "EE Year 2 2/Semester 1");
    assert.notEqual(byName.Circuits.slug, "circuits");

    // The empty cluster came along too.
    assert.ok(
      db
        .prepare("SELECT 1 FROM cluster_folders WHERE user_id = ? AND name = ?")
        .get(USER, "EE Year 2 2/Empty"),
    );
    // The originals are untouched.
    assert.equal(gardenRow("circuits").folder, "EE Year 2");
  });

  test("importing into a target cluster nests the whole subtree under it", async () => {
    const result = await importTransferArchive(USER, download.buffer, {
      targetFolder: "Archive",
    });

    assert.equal(result.clusterPath, "Archive/EE Year 2");
    const folders = result.gardens.map((garden) => garden.folder).sort();
    assert.deepEqual(folders, [
      "Archive/EE Year 2",
      "Archive/EE Year 2/Semester 1",
    ]);
    for (const garden of result.gardens) {
      assert.ok(fs.existsSync(path.join(contentRoot, garden.slug, "_index.md")));
    }
  });

  test("a file that is neither kind is refused before anything is written", async () => {
    const before = db
      .prepare("SELECT COUNT(*) AS count FROM clusters")
      .get().count;
    await assert.rejects(
      () => importTransferArchive(USER, Buffer.from("not an archive")),
      TransferError,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM clusters").get().count,
      before,
    );
  });
});
