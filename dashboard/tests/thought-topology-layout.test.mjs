import test from "node:test";
import assert from "node:assert/strict";

const layout =
  await import("../../quartz/quartz/components/scripts/thoughtTopologyLayout.ts");
const {
  planThoughtTopology,
  fitTransform,
  placeLabels,
  displayFolderTitle,
  readableSummary,
  gardenOverview,
  truncateLabel,
  pageLabelBudget,
  paddedHull,
  analysisStatus,
} = layout;

function folder(
  id,
  path,
  title,
  depth,
  nodeCount,
  parentId = depth === 1 ? "folder:$root" : null,
) {
  return {
    id,
    path,
    parentId,
    title,
    depth,
    nodeCount,
    summary: { state: "degraded", text: `Contains ${nodeCount} pages.` },
  };
}

function page(id, folderId, title, wordCount = 1000) {
  return {
    id,
    slug: `physics/${id.slice(5)}`,
    relPath: `${id.slice(5)}.md`,
    folderId,
    title,
    knowledgeType: "textbook-page",
    summary: {
      state: "degraded",
      text: `${title} $x=0$ | $x>0$ | The page explains ${title.toLowerCase()} in detail. It also derives the core relation.`,
    },
    primaryConcepts: [],
    supportingConcepts: [],
    wordCount,
  };
}

function fixture(edges = []) {
  const nodes = [];
  const waves = [];
  const light = [];
  const quantum = [];
  for (let index = 1; index <= 11; index += 1)
    waves.push(
      page(`page:w${index}`, "folder:waves", `${index}) Waves topic ${index}`),
    );
  for (let index = 1; index <= 13; index += 1)
    light.push(
      page(`page:l${index}`, "folder:light", `${index}) Light topic ${index}`),
    );
  for (let index = 1; index <= 14; index += 1)
    quantum.push(
      page(
        `page:q${index}`,
        "folder:quantum",
        `${index}) Quantum topic ${index}`,
      ),
    );
  nodes.push(...waves, ...light, ...quantum);
  return {
    garden: {
      id: 1,
      slug: "physics",
      title: "Physics for EE",
      summary: {
        state: "degraded",
        text: "Folders: A, Generated. Pages: 1) Waves…",
      },
    },
    folders: [
      folder("folder:$root", "", "Garden root", 0, 0, null),
      folder("folder:a", "a", "A", 1, 0),
      folder("folder:generated", "generated", "Generated", 1, 0),
      folder(
        "folder:waves",
        "module-v-waves-and-oscilations",
        "Module V Waves And Oscilations",
        1,
        11,
      ),
      folder(
        "folder:light",
        "module-vi-propagation-of-light",
        "Module Vi Propagation Of Light",
        1,
        13,
      ),
      folder(
        "folder:quantum",
        "module-vii-quantum-mechanics",
        "Module Vii Quantum Mechanics",
        1,
        14,
      ),
      folder("folder:sources", "sources", "Sources", 1, 0),
    ],
    nodes,
    edges,
    build: {
      state: "degraded",
      threshold: 0.62,
      retrievalMode: "concept-lexical",
      embeddingModel: "unavailable",
    },
  };
}

function edge(id, source, target, score, origin = "inferred") {
  return {
    id,
    source,
    target,
    origin,
    score,
    threshold: 0.62,
    relationType: "related",
    direction: "undirected",
    explanation: { state: "ready", text: "They share a mechanism." },
    evidence: [],
    components: { embedding: 0, concept: 0.5, lexical: 0.4 },
  };
}

test("empty and source folders are hidden; the three module folders become stable radial sectors", () => {
  const plan = planThoughtTopology(fixture());
  assert.deepEqual(plan.meaningfulFolderIds, [
    "folder:waves",
    "folder:light",
    "folder:quantum",
  ]);
  assert.deepEqual(
    plan.hiddenFolders.map((item) => [item.id, item.reason]).sort(),
    [
      ["folder:a", "empty"],
      ["folder:generated", "empty"],
      ["folder:sources", "sources"],
    ],
  );
  assert.equal(plan.nodes.filter((node) => node.kind === "folder").length, 3);
  assert.equal(plan.visiblePageCount, 38);
  assert.equal(plan.totalPageCount, 38);
  assert.deepEqual([plan.garden.x, plan.garden.y], [0, 0]);
  const again = planThoughtTopology(fixture());
  assert.deepEqual(
    plan.nodes.map((node) => [node.id, Math.round(node.x), Math.round(node.y)]),
    again.nodes.map((node) => [
      node.id,
      Math.round(node.x),
      Math.round(node.y),
    ]),
    "layout is deterministic across reloads",
  );
});

test("folder anchors sit on one ring and every page stays inside its folder's cluster", () => {
  const plan = planThoughtTopology(fixture());
  const anchors = plan.nodes.filter((node) => node.kind === "folder");
  const distances = anchors.map((node) => Math.hypot(node.x, node.y));
  assert.ok(
    Math.max(...distances) - Math.min(...distances) < 0.5,
    "anchors share one radius",
  );
  assert.ok(Math.min(...distances) >= 149.5);
  for (const sector of plan.sectors) {
    const anchor = anchors.find((node) => node.id === sector.folderId);
    const pages = plan.nodes.filter(
      (node) => node.kind === "page" && node.sectorId === sector.folderId,
    );
    for (const item of pages) {
      const distance = Math.hypot(item.x - anchor.x, item.y - anchor.y);
      assert.ok(
        distance <= sector.clusterRadius + 1,
        `${item.id} stays within its cluster`,
      );
      assert.ok(
        Math.hypot(item.x, item.y) > Math.hypot(anchor.x, anchor.y) - 40,
        `${item.id} sits outward from the Garden`,
      );
    }
  }
  // Neighbouring clusters do not overlap: whitespace separates neighbourhoods.
  for (let index = 0; index < plan.sectors.length; index += 1) {
    const left = plan.sectors[index];
    const right = plan.sectors[(index + 1) % plan.sectors.length];
    const a = anchors.find((node) => node.id === left.folderId);
    const b = anchors.find((node) => node.id === right.folderId);
    assert.ok(
      Math.hypot(a.x - b.x, a.y - b.y) >=
        left.clusterRadius + right.clusterRadius + 30,
    );
  }
});

test("the visible hierarchy connects Garden to folders to pages, while affinity weight controls line width", () => {
  const plan = planThoughtTopology(
    fixture([
      edge("edge:bridge", "page:l11", "page:l12", 0.9),
      edge("edge:cross", "page:w7", "page:q12", 0.7),
      {
        id: "structural:x",
        source: "folder:waves",
        target: "page:w1",
        structural: true,
      },
      edge("edge:authored", "page:q2", "page:l13", 0.8, "authored"),
    ]),
  );
  assert.deepEqual(
    plan.edges.map((item) => item.id),
    ["edge:bridge", "edge:authored", "edge:cross"],
  );
  assert.equal(plan.hierarchyEdges.length, plan.nodes.length - 1);
  for (const folderId of ["folder:waves", "folder:light", "folder:quantum"]) {
    assert.ok(
      plan.hierarchyEdges.some(
        (item) => item.source === plan.garden.id && item.target === folderId,
      ),
    );
  }
  assert.ok(
    plan.hierarchyEdges.some(
      (item) => item.source === "folder:waves" && item.target === "page:w1",
    ),
  );
  assert.equal(
    plan.hierarchyEdges.some((item) => item.id === "structural:x"),
    false,
  );
  for (const item of plan.edges) {
    assert.ok(
      item.width >= 0.7 && item.width <= 7,
      `${item.id} width ${item.width} is bounded`,
    );
    assert.ok(item.opacity <= 0.92);
  }
  assert.ok(
    plan.edges.find((item) => item.id === "edge:bridge").width >
      plan.edges.find((item) => item.id === "edge:cross").width,
  );
  assert.ok(
    plan.edges.find((item) => item.id === "edge:bridge").width -
      plan.edges.find((item) => item.id === "edge:cross").width >
      2.5,
    "strong and weak affinities should have visibly different widths",
  );
  assert.equal(
    plan.edges.find((item) => item.id === "edge:cross").crossFolder,
    true,
  );
  assert.equal(
    plan.edges.find((item) => item.id === "edge:bridge").crossFolder,
    false,
  );
  const bridged = plan.nodes.find((node) => node.id === "page:w7");
  assert.equal(bridged.bridgeDegree, 1);
  assert.ok(
    bridged.importance >
      plan.nodes.find((node) => node.id === "page:w8").importance,
  );
});

test("a folder page plans only that folder, its pages, and its internal connections", () => {
  const scopedFixture = fixture([
    edge("edge:waves", "page:w1", "page:w2", 0.91),
    edge("edge:cross", "page:w2", "page:q1", 0.88),
    edge("edge:quantum", "page:q1", "page:q2", 0.86),
    edge("edge:root-cross", "page:root", "page:w1", 0.84),
  ]);
  scopedFixture.nodes.push(
    page("page:root", "folder:$root", "Garden root note"),
  );
  const plan = planThoughtTopology(scopedFixture, {
    scopeFolderPath: "module-v-waves-and-oscilations",
  });

  assert.deepEqual(plan.scopeFolder, {
    id: "folder:waves",
    path: "module-v-waves-and-oscilations",
    title: "Module V Waves And Oscilations",
  });
  assert.deepEqual(plan.meaningfulFolderIds, ["folder:waves"]);
  assert.equal(plan.totalPageCount, 11);
  assert.equal(plan.visiblePageCount, 11);
  assert.deepEqual(
    plan.edges.map((item) => item.id),
    ["edge:waves"],
  );
  assert.ok(
    plan.nodes.every(
      (node) =>
        node.kind === "garden" ||
        node.id === "folder:waves" ||
        node.folderId === "folder:waves",
    ),
  );
  assert.ok(
    plan.hierarchyEdges.some(
      (item) =>
        item.source === plan.garden.id && item.target === "folder:waves",
    ),
  );
  assert.ok(
    plan.hierarchyEdges.some(
      (item) => item.source === "folder:waves" && item.target === "page:w1",
    ),
  );
  assert.equal(
    plan.nodes.some(
      (node) => node.id === "folder:quantum" || node.id === "page:q1",
    ),
    false,
  );
});

test("preview keeps the Garden, folders, a handful of pages, and only the strongest bridges", () => {
  const plan = planThoughtTopology(
    fixture([
      edge("edge:cross-1", "page:w7", "page:q12", 0.72),
      edge("edge:cross-2", "page:l11", "page:q4", 0.9),
      edge("edge:inside", "page:l11", "page:l12", 0.95),
    ]),
    { preview: true },
  );
  assert.equal(plan.nodes.filter((node) => node.kind === "folder").length, 3);
  const pages = plan.nodes.filter((node) => node.kind === "page");
  assert.ok(pages.length <= 10);
  assert.deepEqual(
    plan.edges.map((item) => item.id),
    ["edge:cross-2", "edge:cross-1"],
  );
  assert.equal(plan.hierarchyEdges.length, plan.nodes.length - 1);
  for (const id of ["page:w7", "page:q12", "page:l11", "page:q4"])
    assert.ok(pages.some((node) => node.id === id));
});

test("fit keeps the Garden in the usable viewport when interface chrome reserves the right side", () => {
  const plan = planThoughtTopology(fixture());
  const viewport = { width: 1200, height: 640 };
  const limits = { minScale: 0.3, maxScale: 1.35 };
  const garden = { x: 0, y: 0 };
  const open = fitTransform(
    plan.bounds,
    viewport,
    { top: 14, right: 380 + 14, bottom: 14, left: 14 },
    limits,
    garden,
  );
  const closed = fitTransform(
    plan.bounds,
    viewport,
    { top: 14, right: 14, bottom: 14, left: 14 },
    limits,
    garden,
  );
  const gardenX = (transform) =>
    transform.k * (viewport.width / 2) + transform.x;
  assert.ok(Math.abs(gardenX(closed) - viewport.width / 2) < 1);
  const usableCentre = 14 + (viewport.width - 14 - 394) / 2;
  assert.ok(Math.abs(gardenX(open) - usableCentre) < 1);
  assert.ok(open.k <= closed.k);
  const extents = [plan.bounds.minX, plan.bounds.maxX].map(
    (x) => open.k * (x + viewport.width / 2) + open.x,
  );
  assert.ok(
    extents[0] >= 14 - 0.5 && extents[1] <= viewport.width - 394 + 0.5,
    "nothing sits under the reserved interface area",
  );
});

test("labels never overlap each other, nodes, blocked controls, or the clip edge", () => {
  const candidates = [
    {
      id: "garden",
      priority: 1000,
      x: 300,
      y: 200,
      radius: 11,
      width: 90,
      height: 16,
      sides: ["below", "above", "right", "left"],
    },
    {
      id: "a",
      priority: 500,
      x: 300,
      y: 232,
      radius: 3,
      width: 120,
      height: 14,
      sides: ["below", "right", "left", "above"],
    },
    {
      id: "b",
      priority: 400,
      x: 300,
      y: 236,
      radius: 3,
      width: 120,
      height: 14,
      sides: ["below", "right", "left", "above"],
    },
    {
      id: "edge",
      priority: 300,
      x: 590,
      y: 200,
      radius: 3,
      width: 80,
      height: 14,
      sides: ["right", "left"],
    },
    {
      id: "blocked",
      priority: 200,
      x: 40,
      y: 30,
      radius: 3,
      width: 80,
      height: 14,
      sides: ["below"],
    },
  ];
  const obstacles = candidates.map((item) => ({
    id: item.id,
    x: item.x,
    y: item.y,
    radius: item.radius + 2,
  }));
  obstacles.push({ id: "other", x: 300, y: 260, radius: 6 });
  const placed = placeLabels(
    candidates,
    obstacles,
    { left: 0, top: 0, right: 600, bottom: 400 },
    [{ left: 0, top: 0, right: 160, bottom: 70 }],
  );
  assert.ok(placed.has("garden"));
  const rects = [...placed.values()].map((item) => item.rect);
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      const overlap = !(
        a.right <= b.left ||
        b.right <= a.left ||
        a.bottom <= b.top ||
        b.bottom <= a.top
      );
      assert.equal(overlap, false, "placed labels do not overlap");
    }
    assert.ok(rects[i].right <= 600 && rects[i].left >= 0);
  }
  assert.equal(
    placed.has("blocked"),
    false,
    "a label under the heading is hidden rather than drawn over it",
  );
  assert.equal(
    placed.get("edge")?.side,
    "left",
    "labels that would run offscreen take another side",
  );
});

test("text helpers produce readable folder names, summaries, and an honest overview", () => {
  assert.equal(
    displayFolderTitle("Module Vi Propagation Of Light"),
    "Module VI Propagation of Light",
  );
  assert.equal(
    displayFolderTitle("Module Vii Quantum Mechanics"),
    "Module VII Quantum Mechanics",
  );
  assert.equal(
    truncateLabel(
      "Wave-particle duality, probability amplitudes, and uncertainty",
      34,
    ),
    "Wave-particle duality…",
  );
  assert.equal(
    truncateLabel("Superconductivity-in-one-very-long-identifier", 20),
    "Superconductivity-i…",
  );
  assert.equal(truncateLabel("Short title", 34), "Short title");
  const summary = readableSummary(
    {
      state: "degraded",
      text: "Interference: superposition made visible $y_1$ | $y_2$ | $$ y = y_1 + y_2. $$ | Two waves that overlap add point by point. The resulting pattern depends on their phase difference. Bright fringes appear where the waves reinforce.",
    },
    {
      title: "Interference: superposition made visible",
      folderTitle: "Module VI",
    },
  );
  assert.doesNotMatch(summary, /\$|\|/);
  assert.match(summary, /^Two waves that overlap add point by point\./);
  assert.ok(summary.split(/(?<=\.)\s/).length <= 3);
  // Inline definitions remain intact now that the callout renders their math;
  // prose is never left behind in a gutted form.
  const formulaSummary = readableSummary(
    {
      state: "degraded",
      text: "Photons and the photoelectric effect $$ E = hf $$ | $h$ is Planck’s constant, $f$ is the light frequency. Light arrives in packets whose energy depends only on frequency.",
    },
    {
      title: "Photons and the photoelectric effect",
      folderTitle: "Module VII",
    },
  );
  assert.equal(
    formulaSummary,
    "$h$ is Planck’s constant, $f$ is the light frequency. Light arrives in packets whose energy depends only on frequency.",
  );
  assert.equal(
    readableSummary(
      {
        state: "ready",
        text: "Gauss law relates electric flux to enclosed charge.",
      },
      { title: "Gauss law", folderTitle: "Root" },
    ),
    "Gauss law relates electric flux to enclosed charge.",
  );
  assert.match(
    readableSummary(
      { state: "degraded", text: "$E=hf$ | $p=h/\\lambda$" },
      { title: "Matter waves", folderTitle: "Module VII" },
    ),
    /^“Matter waves” is a page in Module VII\./,
  );
  const plan = planThoughtTopology(fixture());
  const overview = gardenOverview(plan, "Physics for EE", plan.garden.summary);
  assert.match(
    overview,
    /organized into 3 folders — Module VII Quantum Mechanics, Module VI Propagation of Light, and Module V Waves and Oscilations — holding 38 pages/,
  );
  assert.match(overview, /No semantic connections have been confirmed/);
  assert.doesNotMatch(overview, /Folders: A/);
  assert.equal(
    analysisStatus(fixture()).notice,
    "Concept and lexical mode · Semantic bridges will appear after vector analysis.",
  );
  assert.equal(
    analysisStatus({
      ...fixture(),
      build: {
        state: "ready",
        threshold: 0.7,
        retrievalMode: "semantic-vector",
        embeddingModel: "local/bge",
      },
    }).notice,
    "",
  );
  assert.equal(pageLabelBudget(1), 8);
  assert.equal(pageLabelBudget(2.2), 40);
  const hull = paddedHull(
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ],
    10,
  );
  assert.ok(hull.length >= 8);
});
