import assert from "node:assert/strict";
import fs from "node:fs";
import test, { describe } from "node:test";
import Database from "better-sqlite3";

import {
  compareFolderPaths,
  createFolder,
  deleteFolder,
  expandFolderPaths,
  folderPathChain,
  isInSubtree,
  joinFolderPath,
  listFolders,
  moveFolder,
  normalizeFolderPath,
  renameFolder,
  visibleFolderRows,
} from "../src/lib/cluster-folders.ts";

const USER = 1;
const OTHER_USER = 2;

/** Mirrors the two columns in src/lib/db.ts that carry the cluster tree. */
function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE clusters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      folder TEXT
    );
    CREATE TABLE cluster_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      UNIQUE(user_id, name)
    );
  `);
  return db;
}

function addGarden(db, slug, folder, userId = USER) {
  db.prepare(
    "INSERT INTO clusters (user_id, name, slug, folder) VALUES (?, ?, ?, ?)",
  ).run(userId, slug, slug, folder);
}

function gardenFolder(db, slug) {
  return db.prepare("SELECT folder FROM clusters WHERE slug = ?").get(slug)
    .folder;
}

describe("cluster path helpers", () => {
  test("a path normalizes segment by segment", () => {
    assert.equal(normalizeFolderPath("  EE  Year 1 / Sem 2 "), "EE Year 1/Sem 2");
    assert.equal(normalizeFolderPath("a//b///c"), "a/b/c");
    assert.equal(normalizeFolderPath("///"), "");
    assert.equal(normalizeFolderPath(null), "");
  });

  test("depth is capped so a pasted path cannot nest forever", () => {
    const deep = Array.from({ length: 20 }, (_, i) => `L${i}`).join("/");
    assert.equal(normalizeFolderPath(deep).split("/").length, 8);
  });

  test("a separator typed into a single name is not a nesting escape hatch", () => {
    assert.equal(joinFolderPath("Parent", "a/b"), "Parent/a b");
  });

  test("a path expands into its ancestor chain", () => {
    assert.deepEqual(folderPathChain("A/B/C"), ["A", "A/B", "A/B/C"]);
    assert.deepEqual(folderPathChain(""), []);
  });

  test("subtree membership does not match a sibling with a shared prefix", () => {
    assert.ok(isInSubtree("A/B", "A"));
    assert.ok(isInSubtree("A", "A"));
    assert.ok(!isInSubtree("AB", "A"));
    assert.ok(!isInSubtree("A", "A/B"));
  });

  test("paths sort depth-first, not lexicographically", () => {
    const sorted = ["A B", "A/B", "A", "B"].sort(compareFolderPaths);
    assert.deepEqual(sorted, ["A", "A/B", "A B", "B"]);
  });
});

describe("nesting clusters", () => {
  test("creating a nested cluster registers its ancestors", () => {
    const db = makeDb();
    createFolder(db, USER, "Semester 2", "EE Year 1");
    assert.deepEqual(listFolders(db, USER), ["EE Year 1", "EE Year 1/Semester 2"]);
  });

  test("an intermediate cluster is derived even if only a leaf was stored", () => {
    const db = makeDb();
    addGarden(db, "circuits", "A/B/C");
    assert.deepEqual(listFolders(db, USER), ["A", "A/B", "A/B/C"]);
  });

  test("two clusters with the same name can live under different parents", () => {
    const db = makeDb();
    createFolder(db, USER, "Notes", "Physics");
    createFolder(db, USER, "Notes", "Maths");
    assert.deepEqual(listFolders(db, USER), [
      "Maths",
      "Maths/Notes",
      "Physics",
      "Physics/Notes",
    ]);
  });

  test("a duplicate sibling is rejected", () => {
    const db = makeDb();
    createFolder(db, USER, "Notes", "Physics");
    assert.throws(
      () => createFolder(db, USER, "Notes", "Physics"),
      /already exists/,
    );
  });

  test("creating past the depth cap is rejected", () => {
    const db = makeDb();
    const parent = Array.from({ length: 8 }, (_, i) => `L${i}`).join("/");
    createFolder(db, USER, "L7", parent.split("/").slice(0, 7).join("/"));
    assert.throws(() => createFolder(db, USER, "tooDeep", parent), /8 levels/);
  });
});

describe("moving a cluster", () => {
  test("a move carries nested clusters and their gardens", () => {
    const db = makeDb();
    createFolder(db, USER, "Circuits", "Physics/Notes");
    addGarden(db, "rlc", "Physics/Notes/Circuits");
    addGarden(db, "optics", "Physics/Notes");

    moveFolder(db, USER, "Physics/Notes", "Maths");

    assert.deepEqual(listFolders(db, USER), [
      "Maths",
      "Maths/Notes",
      "Maths/Notes/Circuits",
      "Physics",
    ]);
    assert.equal(gardenFolder(db, "rlc"), "Maths/Notes/Circuits");
    assert.equal(gardenFolder(db, "optics"), "Maths/Notes");
  });

  test("a null target moves a cluster back to the top level", () => {
    const db = makeDb();
    createFolder(db, USER, "Notes", "Physics");
    addGarden(db, "optics", "Physics/Notes");

    moveFolder(db, USER, "Physics/Notes", null);

    assert.equal(gardenFolder(db, "optics"), "Notes");
    assert.ok(listFolders(db, USER).includes("Notes"));
  });

  test("a cluster cannot be moved inside itself or its own descendant", () => {
    const db = makeDb();
    createFolder(db, USER, "Deep", "A/B");
    assert.throws(() => moveFolder(db, USER, "A", "A"), /inside itself/);
    assert.throws(() => moveFolder(db, USER, "A", "A/B"), /inside itself/);
    assert.throws(() => moveFolder(db, USER, "A", "A/B/Deep"), /inside itself/);
  });

  test("a sibling whose name merely shares a prefix is left alone", () => {
    const db = makeDb();
    addGarden(db, "kept", "Alpha");
    addGarden(db, "moved", "Al/inner");

    moveFolder(db, USER, "Al", "Home");

    assert.equal(gardenFolder(db, "kept"), "Alpha");
    assert.equal(gardenFolder(db, "moved"), "Home/Al/inner");
  });

  test("a name containing LIKE wildcards is matched literally", () => {
    const db = makeDb();
    addGarden(db, "target", "100%/deep");
    addGarden(db, "decoy", "1000/deep");

    moveFolder(db, USER, "100%", "Archive");

    assert.equal(gardenFolder(db, "target"), "Archive/100%/deep");
    assert.equal(gardenFolder(db, "decoy"), "1000/deep");
  });

  test("a move that would exceed the depth cap is rejected", () => {
    const db = makeDb();
    addGarden(db, "deep", "Src/a/b/c/d/e");
    createFolder(db, USER, "L2", "Dst/L1");
    assert.throws(() => moveFolder(db, USER, "Src", "Dst/L1/L2"), /8 levels/);
  });

  test("a move onto an occupied name is rejected", () => {
    const db = makeDb();
    createFolder(db, USER, "Notes", null);
    createFolder(db, USER, "Notes", "Physics");
    assert.throws(() => moveFolder(db, USER, "Notes", "Physics"), /already exists/);
  });

  test("another user's identically named cluster is untouched", () => {
    const db = makeDb();
    addGarden(db, "mine", "Shared/inner");
    addGarden(db, "theirs", "Shared/inner", OTHER_USER);

    moveFolder(db, USER, "Shared", "Archive");

    assert.equal(gardenFolder(db, "mine"), "Archive/Shared/inner");
    assert.equal(gardenFolder(db, "theirs"), "Shared/inner");
  });
});

describe("renaming a cluster", () => {
  test("a rename keeps the parent and rewrites the subtree", () => {
    const db = makeDb();
    createFolder(db, USER, "Circuits", "Physics/Notes");
    addGarden(db, "rlc", "Physics/Notes/Circuits");

    renameFolder(db, USER, "Physics/Notes", "Lectures");

    assert.equal(gardenFolder(db, "rlc"), "Physics/Lectures/Circuits");
    assert.ok(listFolders(db, USER).includes("Physics/Lectures/Circuits"));
  });

  test("a separator typed into the new name does not re-parent the cluster", () => {
    const db = makeDb();
    addGarden(db, "rlc", "Physics/Notes");

    renameFolder(db, USER, "Physics/Notes", "a/b");

    assert.equal(gardenFolder(db, "rlc"), "Physics/a b");
  });
});

describe("deleting a cluster", () => {
  test("nested clusters go with it and gardens survive unfiled", () => {
    const db = makeDb();
    createFolder(db, USER, "Circuits", "Physics/Notes");
    addGarden(db, "rlc", "Physics/Notes/Circuits");
    addGarden(db, "optics", "Physics");
    addGarden(db, "algebra", "Maths");

    deleteFolder(db, USER, "Physics/Notes");

    assert.equal(gardenFolder(db, "rlc"), null);
    assert.equal(gardenFolder(db, "optics"), "Physics");
    assert.equal(gardenFolder(db, "algebra"), "Maths");
    assert.deepEqual(listFolders(db, USER), ["Maths", "Physics"]);
  });

  test("deleting does not reach another user's tree", () => {
    const db = makeDb();
    addGarden(db, "mine", "Shared/inner");
    addGarden(db, "theirs", "Shared/inner", OTHER_USER);

    deleteFolder(db, USER, "Shared");

    assert.equal(gardenFolder(db, "mine"), null);
    assert.equal(gardenFolder(db, "theirs"), "Shared/inner");
  });
});

describe("tree rendering order", () => {
  const ALL = ["A", "A/B", "A/B/C", "A B", "Z"];

  test("a collapsed root hides its whole subtree", () => {
    assert.deepEqual(
      visibleFolderRows(ALL, () => false),
      [
        { folder: "A", depth: 0 },
        { folder: "A B", depth: 0 },
        { folder: "Z", depth: 0 },
      ],
    );
  });

  test("expanding a root reveals only its direct children", () => {
    assert.deepEqual(
      visibleFolderRows(ALL, (folder) => folder === "A"),
      [
        { folder: "A", depth: 0 },
        { folder: "A/B", depth: 1 },
        { folder: "A B", depth: 0 },
        { folder: "Z", depth: 0 },
      ],
    );
  });

  test("a grandchild needs every ancestor open, and sorts before a prefix sibling", () => {
    assert.deepEqual(
      visibleFolderRows(ALL, (folder) => folder === "A" || folder === "A/B"),
      [
        { folder: "A", depth: 0 },
        { folder: "A/B", depth: 1 },
        { folder: "A/B/C", depth: 2 },
        { folder: "A B", depth: 0 },
        { folder: "Z", depth: 0 },
      ],
    );
    // "A/B/C" stays open but is hidden while its parent "A/B" is collapsed.
    assert.deepEqual(
      visibleFolderRows(ALL, (folder) => folder === "A" || folder === "A/B/C"),
      [
        { folder: "A", depth: 0 },
        { folder: "A/B", depth: 1 },
        { folder: "A B", depth: 0 },
        { folder: "Z", depth: 0 },
      ],
    );
  });

  test("paths from gardens and the registry merge into one ancestor-complete list", () => {
    assert.deepEqual(expandFolderPaths(["A/B/C", null, "A", "", "Z"]), [
      "A",
      "A/B",
      "A/B/C",
      "Z",
    ]);
  });
});

describe("dashboard renders the tree", () => {
  const client = fs.readFileSync(
    new URL("../src/app/dashboard/dashboard-client.tsx", import.meta.url),
    "utf8",
  );

  test("headers come from the shared tree order and are indented by depth", () => {
    assert.match(client, /visibleFolderRows\(folderPaths,/);
    assert.match(client, /marginLeft: depth \* FOLDER_INDENT_PX/);
  });

  test("a cluster header is draggable so it can be re-parented", () => {
    assert.match(client, /setDraggingFolderPath\(folder\)/);
    assert.match(client, /handleMoveClusterFolder\(draggingFolderPath, folder\)/);
  });

  test("a top-level drop zone can un-nest a cluster or a garden", () => {
    assert.match(client, /handleMoveClusterFolder\(draggingFolderPath, null\)/);
    assert.match(client, /handleMoveClusterToFolder\(id, null\)/);
  });

  test("each header can create a cluster nested inside it", () => {
    assert.match(client, /openClusterFolderModal\(folder\)/);
  });
});
