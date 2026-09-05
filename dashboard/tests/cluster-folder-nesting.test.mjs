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
  folderRankFromOrder,
  isInSubtree,
  joinFolderPath,
  listFolders,
  moveFolder,
  normalizeFolderPath,
  renameFolder,
  reorderFolder,
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
      position INTEGER,
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

  // The dashboard has no positions of its own: it ranks by where each path sits
  // in the array the server handed it, which is the stored order.
  test("a list's own order becomes the sibling ranking", () => {
    const rank = folderRankFromOrder(["Z", "Z/late", "Z/early", "A"]);
    assert.deepEqual(
      ["A", "Z", "Z/early", "Z/late"].sort((a, b) =>
        compareFolderPaths(a, b, rank),
      ),
      ["Z", "Z/late", "Z/early", "A"],
    );
  });

  test("a cluster absent from the ranking falls back to the alphabet", () => {
    const rank = folderRankFromOrder(["Z"]);
    // "Z" is ranked and therefore leads; the rest are unranked and tie, so they
    // sort against each other by name.
    assert.deepEqual(
      ["Maths", "Art", "Z"].sort((a, b) => compareFolderPaths(a, b, rank)),
      ["Z", "Art", "Maths"],
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

describe("reordering clusters", () => {
  /** Creates top-level clusters in the given order and returns the db. */
  function withTopLevel(...names) {
    const db = makeDb();
    for (const name of names) createFolder(db, USER, name, null);
    return db;
  }

  function positionOf(db, name) {
    return db
      .prepare("SELECT position FROM cluster_folders WHERE user_id = ? AND name = ?")
      .get(USER, name).position;
  }

  test("an untouched tree is alphabetical and stores no positions", () => {
    const db = withTopLevel("Physics", "Maths", "Art");
    assert.deepEqual(listFolders(db, USER), ["Art", "Maths", "Physics"]);
    assert.equal(positionOf(db, "Physics"), null);
  });

  test("dropping on a sibling's top edge places it before that sibling", () => {
    const db = withTopLevel("Art", "Maths", "Physics");
    reorderFolder(db, USER, "Physics", "Maths", "before");
    assert.deepEqual(listFolders(db, USER), ["Art", "Physics", "Maths"]);
  });

  test("dropping on a sibling's bottom edge places it after", () => {
    const db = withTopLevel("Art", "Maths", "Physics");
    reorderFolder(db, USER, "Art", "Maths", "after");
    assert.deepEqual(listFolders(db, USER), ["Maths", "Art", "Physics"]);
  });

  test("the first reorder numbers the whole sibling list, not just the two", () => {
    const db = withTopLevel("Art", "Maths", "Physics");
    reorderFolder(db, USER, "Physics", "Art", "before");
    assert.deepEqual(
      ["Physics", "Art", "Maths"].map((name) => positionOf(db, name)),
      [0, 1, 2],
    );
  });

  test("a cluster reordered from another parent is re-parented on the way", () => {
    const db = makeDb();
    createFolder(db, USER, "Maths", null);
    createFolder(db, USER, "Physics", null);
    createFolder(db, USER, "Optics", "Physics");
    createFolder(db, USER, "Algebra", "Maths");
    addGarden(db, "lenses", "Physics/Optics");

    reorderFolder(db, USER, "Physics/Optics", "Maths/Algebra", "before");

    assert.deepEqual(listFolders(db, USER), [
      "Maths",
      "Maths/Optics",
      "Maths/Algebra",
      "Physics",
    ]);
    // The subtree's gardens come along, as with any other move.
    assert.equal(gardenFolder(db, "lenses"), "Maths/Optics");
  });

  test("nested clusters travel with the cluster being reordered", () => {
    const db = makeDb();
    createFolder(db, USER, "Maths", null);
    createFolder(db, USER, "Physics", null);
    createFolder(db, USER, "Optics", "Physics");
    createFolder(db, USER, "Lenses", "Physics/Optics");

    reorderFolder(db, USER, "Physics/Optics", "Maths", "after");

    assert.deepEqual(listFolders(db, USER), [
      "Maths",
      "Optics",
      "Optics/Lenses",
      "Physics",
    ]);
  });

  test("ordering one parent leaves every other parent alphabetical", () => {
    const db = makeDb();
    createFolder(db, USER, "Maths", null);
    createFolder(db, USER, "Zebra", "Maths");
    createFolder(db, USER, "Apple", "Maths");
    createFolder(db, USER, "Physics", null);
    createFolder(db, USER, "Waves", "Physics");
    createFolder(db, USER, "Atoms", "Physics");

    reorderFolder(db, USER, "Maths/Zebra", "Maths/Apple", "before");

    assert.deepEqual(listFolders(db, USER), [
      "Maths",
      "Maths/Zebra",
      "Maths/Apple",
      "Physics",
      "Physics/Atoms",
      "Physics/Waves",
    ]);
  });

  test("a cluster created under an ordered parent lands at the end", () => {
    const db = makeDb();
    createFolder(db, USER, "Maths", null);
    createFolder(db, USER, "Zebra", "Maths");
    createFolder(db, USER, "Apple", "Maths");
    reorderFolder(db, USER, "Maths/Zebra", "Maths/Apple", "before");

    createFolder(db, USER, "Aardvark", "Maths");

    assert.deepEqual(listFolders(db, USER), [
      "Maths",
      "Maths/Zebra",
      "Maths/Apple",
      "Maths/Aardvark",
    ]);
  });

  test("a cluster cannot be reordered against its own descendant", () => {
    const db = makeDb();
    createFolder(db, USER, "Physics", null);
    createFolder(db, USER, "Optics", "Physics");
    assert.throws(
      () => reorderFolder(db, USER, "Physics", "Physics/Optics", "before"),
      /inside itself/,
    );
  });

  test("reordering a cluster against itself is a no-op", () => {
    const db = withTopLevel("Art", "Maths");
    reorderFolder(db, USER, "Art", "Art", "after");
    assert.deepEqual(listFolders(db, USER), ["Art", "Maths"]);
  });

  test("a reorder onto an occupied name is rejected", () => {
    const db = makeDb();
    createFolder(db, USER, "Maths", null);
    createFolder(db, USER, "Physics", null);
    createFolder(db, USER, "Optics", "Physics");
    createFolder(db, USER, "Optics", "Maths");
    createFolder(db, USER, "Algebra", "Maths");
    assert.throws(
      () => reorderFolder(db, USER, "Physics/Optics", "Maths/Algebra", "before"),
      /already exists/,
    );
  });

  test("another user's clusters keep their own order", () => {
    const db = makeDb();
    createFolder(db, USER, "Art", null);
    createFolder(db, USER, "Maths", null);
    createFolder(db, OTHER_USER, "Art", null);
    createFolder(db, OTHER_USER, "Maths", null);

    reorderFolder(db, USER, "Maths", "Art", "before");

    assert.deepEqual(listFolders(db, USER), ["Maths", "Art"]);
    assert.deepEqual(listFolders(db, OTHER_USER), ["Art", "Maths"]);
  });
});

describe("dashboard renders the tree", () => {
  const client = fs.readFileSync(
    new URL("../src/app/dashboard/dashboard-client.tsx", import.meta.url),
    "utf8",
  );

  test("headers come from the shared tree order and are indented by depth", () => {
    assert.match(client, /visibleFolderRows\(\s*folderPaths,/);
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

  test("each header can create a garden directly inside its cluster", () => {
    assert.match(client, /openModal\(folder\)/);
    assert.match(client, /title="New garden in this cluster"/);
    assert.match(client, /createCluster\(name\.trim\(\), description\.trim\(\), folder\)/);
  });

  // A header is a thin strip. Aiming a dragged cluster at one is far fiddlier
  // than dropping a garden onto a card grid, so the section is the target.
  test("a whole section takes a nesting drop, not just the header strip", () => {
    assert.match(client, /folderDropProps\(dropFolder, dropKey\)/);
    assert.match(client, /section\.header \? section\.header\.key : "root"/);
  });

  // Dropping in the middle of a header must keep meaning "nest inside", so the
  // header only claims the event on its outer thirds and lets the rest bubble.
  test("a header's edges reorder while its middle still nests", () => {
    assert.match(client, /if \(offset <= 0\.3\) return "before";/);
    assert.match(client, /if \(offset >= 0\.7\) return "after";/);
    const header = client.slice(
      client.indexOf("function renderFolderHeader("),
      client.indexOf("function openModal("),
    );
    // The middle band returns before preventDefault, so the section handler
    // underneath still sees the drag.
    assert.match(header, /const place = edgePlaceAt\(e\);\s*if \(!place\)/);
    assert.match(
      header,
      /handleReorderClusterFolder\(draggingFolderPath, folder, place\)/,
    );
  });

  test("grabbing a header button does not drag the cluster away", () => {
    assert.match(
      client,
      /\(e\.target as HTMLElement\)\.closest\('\[data-card-action="true"\]'\)/,
    );
  });

  // Headers used to vanish behind the "No gardens yet" state, which left an
  // empty cluster impossible to see, drag, or fill.
  test("an empty cluster still renders its header", () => {
    assert.match(client, /clusterSections\.length === 0 \?/);
  });

  test("the page keeps scrollable room under the fixed terminal dock", () => {
    assert.match(client, /querySelector\("\[data-terminal-dock\]"\)/);
    assert.match(client, /new ResizeObserver/);
    assert.match(client, /paddingBottom: "calc\(var\(--bb-dock-height, 0px\) \+ 40vh\)"/);
  });

  // The observer fires on every frame of a dock drag. Routed through state it
  // re-rendered every card on the page each time, so the measurement is written
  // straight to the custom property the padding reads.
  test("the dock measurement never goes through React state", () => {
    assert.match(client, /setProperty\(\s*"--bb-dock-height"/);
    assert.doesNotMatch(client, /setDockHeight/);
  });
});

describe("creating a garden inside a cluster", () => {
  const actions = fs.readFileSync(
    new URL("../src/app/actions/clusters.ts", import.meta.url),
    "utf8",
  );
  const createCluster = actions.slice(
    actions.indexOf("export async function createCluster("),
    actions.indexOf("export async function updateClusterDetails("),
  );

  test("the action files the new garden and registers missing ancestors", () => {
    assert.match(createCluster, /folder\?: string \| null/);
    assert.match(createCluster, /normalizeFolderPath\(folder\)/);
    assert.match(createCluster, /ensureFolderPath\(db, userId, cleanFolder\)/);
    assert.match(createCluster, /INSERT INTO clusters \([^)]*folder/);
  });

  test("an empty cluster stores NULL rather than a blank path", () => {
    assert.match(createCluster, /cleanFolder \|\| null/);
  });

  test("creation returns before the full Quartz publication finishes", () => {
    assert.match(actions, /import \{ after \} from "next\/server"/);
    assert.match(
      createCluster,
      /after\(async \(\) => \{[\s\S]*await publishQuartzAfterMutation/,
    );
    assert.doesNotMatch(
      createCluster,
      /refreshPrivateQuartzIndex\(userId\);\s*await publishQuartzAfterMutation/,
    );
  });
});
