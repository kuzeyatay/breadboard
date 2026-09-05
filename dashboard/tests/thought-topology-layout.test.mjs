import test from "node:test";
import assert from "node:assert/strict";

const layout =
  await import("../../quartz/quartz/components/scripts/thoughtTopologyLayout.ts");
const {
  aggregateThoughtTopologies,
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
  topologySourceKind,
  labelClearanceRadius,
  labelAwareLinkDistance,
  shouldShowTopologyNodeLabel,
  connectionStrength,
  connectionOpacity,
  topologyNavigationSlug,
  CONNECTION_STROKE_WIDTH,
  AUTHORED_CONNECTION_STRENGTH,
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

function sourcePage(id, title, sourceType) {
  return {
    ...page(id, "folder:sources", title),
    relPath: `sources/${id.slice(5)}.md`,
    kind: "source",
    knowledgeType: "source-document",
    sourceType,
  };
}

test("persistent topology labels omit Markdown node names without hiding other names", () => {
  assert.equal(
    shouldShowTopologyNodeLabel({ kind: "page", contentKind: "markdown" }),
    false,
  );
  assert.equal(
    shouldShowTopologyNodeLabel({ kind: "page", contentKind: "source" }),
    true,
  );
  assert.equal(
    shouldShowTopologyNodeLabel({
      kind: "page",
      contentKind: "internal-concept",
    }),
    true,
  );
  assert.equal(
    shouldShowTopologyNodeLabel({ kind: "folder", contentKind: null }),
    true,
  );
});

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

test("durable worker coordinates keep existing nodes fixed across incremental inserts", () => {
  const payload = fixture();
  Object.assign(payload.folders.find((item) => item.id === "folder:waves"), { x: 410, y: -90 });
  Object.assign(payload.nodes.find((item) => item.id === "page:w1"), { x: 455, y: -40 });
  const plan = planThoughtTopology(payload);
  const folderNode = plan.nodes.find((node) => node.id === "folder:waves");
  const pageNode = plan.nodes.find((node) => node.id === "page:w1");
  assert.deepEqual({ x: folderNode.x, y: folderNode.y }, { x: 410, y: -90 });
  assert.deepEqual({ x: pageNode.x, y: pageNode.y }, { x: 455, y: -40 });
});

test("library topology namespaces Gardens beneath one root without losing their routes or affinities", () => {
  const physics = fixture([edge("edge:inside", "page:w1", "page:w2", 0.91)]);
  const signals = fixture([edge("edge:inside", "page:w1", "page:w2", 0.82)]);
  signals.garden = {
    ...signals.garden,
    id: 2,
    slug: "signals-and-systems",
    title: "Signals and systems",
  };
  signals.nodes = signals.nodes.map((node) => ({
    ...node,
    slug: node.slug.replace(/^physics\//, "signals-and-systems/"),
  }));

  const merged = aggregateThoughtTopologies(
    "private-library/user-1",
    "My garden",
    2,
    [
      { clusterSlug: "physics", topology: physics },
      { clusterSlug: "signals-and-systems", topology: signals },
    ],
  );
  assert.equal(merged.garden.slug, "private-library/user-1");
  assert.equal(
    merged.nodes.length,
    physics.nodes.length + signals.nodes.length,
  );
  assert.equal(
    new Set(merged.nodes.map((node) => node.id)).size,
    merged.nodes.length,
  );
  assert.deepEqual(
    merged.folders
      .filter((folder) => folder.depth === 1)
      .map((folder) => [folder.title, folder.pageSlug]),
    [
      ["Physics for EE", "physics"],
      ["Signals and systems", "signals-and-systems"],
    ],
  );
  assert.ok(
    merged.edges.every(
      (item) =>
        item.source.startsWith("aggregate:") &&
        item.target.startsWith("aggregate:"),
    ),
  );

  const plan = planThoughtTopology(merged);
  assert.deepEqual(
    plan.nodes
      .filter(
        (node) => node.kind === "folder" && node.folderId === "aggregate:root",
      )
      .map((node) => node.label),
    ["Physics for EE", "Signals and systems"],
  );
  assert.ok(
    plan.hierarchyEdges.some(
      (item) =>
        item.source === "garden:private-library/user-1" &&
        item.target === "aggregate:physics:garden",
    ),
  );
  assert.ok(
    plan.edges.some((item) => item.id === "aggregate:physics:edge:inside"),
  );
});

test("every folder becomes a stable radial sector, including empty and source folders", () => {
  const plan = planThoughtTopology(fixture());
  assert.deepEqual(plan.meaningfulFolderIds, [
    "folder:a",
    "folder:generated",
    "folder:waves",
    "folder:light",
    "folder:quantum",
    "folder:sources",
  ]);
  assert.deepEqual(plan.hiddenFolders, []);
  assert.equal(plan.nodes.filter((node) => node.kind === "folder").length, 6);
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

test("source pages retain distinct Quartz node kinds for PDFs, links, video, audio, and documents", () => {
  const payload = fixture();
  payload.nodes.push(
    sourcePage("page:pdf", "Field theory.pdf", "pdf"),
    sourcePage("page:link", "Field theory online", "url"),
    sourcePage("page:video", "Field theory lecture", "youtube"),
    sourcePage("page:audio", "Field theory recording", "audio_upload"),
    sourcePage("page:document", "Field theory notes", "docx"),
  );
  const plan = planThoughtTopology(payload);
  assert.deepEqual(
    Object.fromEntries(
      plan.nodes
        .filter((node) => node.folderId === "folder:sources")
        .map((node) => [node.id, node.sourceKind]),
    ),
    {
      "page:audio": "audio",
      "page:document": "document",
      "page:link": "link",
      "page:pdf": "pdf",
      "page:video": "video",
    },
  );
  assert.equal(
    topologySourceKind(
      sourcePage("page:legacy-pdf", "Legacy reference.pdf", ""),
      "sources",
    ),
    "pdf",
  );
  assert.equal(
    topologySourceKind(
      sourcePage("page:legacy-video", "Legacy lecture.mp4", ""),
      "sources",
    ),
    "video",
  );
  assert.equal(
    topologySourceKind(
      page("page:ordinary", "folder:waves", "Ordinary.pdf"),
      "module-v",
    ),
    null,
    "a filename outside Sources is still an ordinary page",
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

test("the visible hierarchy connects Garden to folders to pages, while affinity weight controls colour weight, not width", () => {
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
    assert.equal(
      item.width,
      CONNECTION_STROKE_WIDTH,
      `${item.id} is drawn as the shared hairline`,
    );
    assert.ok(item.opacity > 0 && item.opacity <= 0.9);
  }
  const bridge = plan.edges.find((item) => item.id === "edge:bridge");
  const cross = plan.edges.find((item) => item.id === "edge:cross");
  assert.ok(
    bridge.opacity - cross.opacity > 0.3,
    "strong and weak affinities should differ visibly in colour weight",
  );
  assert.ok(bridge.strength > 0.7 && cross.strength < 0.3);
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
  assert.equal(plan.nodes.filter((node) => node.kind === "folder").length, 6);
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

test("default node proximity grows with the rendered label footprint", () => {
  const short = labelClearanceRadius(3, 42, 14);
  const long = labelClearanceRadius(3, 128, 42);

  assert.ok(short > 3, "even short names keep breathing room around the dot");
  assert.ok(
    long > short * 2,
    "wrapped long names reserve substantially more room",
  );
  assert.equal(
    labelAwareLinkDistance(44, short, long),
    short + long + 12,
    "a close link expands to fit both endpoint names",
  );
  assert.equal(
    labelAwareLinkDistance(240, short, long),
    240,
    "an already-roomy authored relationship is preserved",
  );
  assert.ok(
    labelClearanceRadius(3, 128, 42, 1.8) < long,
    "the label-budgeted preview remains more compact than the full map",
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
    /organized into 6 folders — Module VII Quantum Mechanics, Module VI Propagation of Light, Module V Waves and Oscilations, A, Generated, and Sources — holding 38 pages/,
  );
  assert.match(overview, /No semantic connections have been confirmed/);
  assert.doesNotMatch(overview, /Folders: A/);
  assert.equal(analysisStatus(fixture()).notice, "");
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

test("sub-folders carrying their own page rings get room on the parent ring instead of page spacing", () => {
  const folders = [
    folder("folder:$root", "", "Garden root", 0, 0, null),
    folder("folder:concepts", "Concepts", "Concepts", 1, 0),
    folder("folder:sources", "sources", "Sources", 1, 4),
  ];
  const nodes = [];
  for (let section = 1; section <= 12; section += 1) {
    const id = `folder:concepts/${section}`;
    folders.push(folder(id, `Concepts/${section}. section-${section}`, `${section}. Section ${section}`, 2, 6, "folder:concepts"));
    for (let item = 1; item <= 6; item += 1)
      nodes.push(page(`page:c${section}-${item}`, id, `${section}.${item} Concept ${item}`));
  }
  // One empty sub-folder still takes a slot of its own.
  folders.push(folder("folder:concepts/13", "Concepts/13. empty", "13. Empty", 2, 0, "folder:concepts"));
  for (let item = 1; item <= 4; item += 1) nodes.push(page(`page:s${item}`, "folder:sources", `Source ${item}`));
  const plan = planThoughtTopology({
    schemaVersion: 1,
    garden: { slug: "g", title: "G", summary: { state: "ready", text: "" } },
    folders,
    nodes,
    edges: [],
    build: { state: "ready", retrievalMode: "semantic-vector", threshold: 0.4 },
  });
  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  const subFolders = plan.nodes.filter((node) => node.kind === "folder" && node.sectorId === "folder:concepts" && node.id !== "folder:concepts");
  assert.equal(subFolders.length, 13);
  // Every page sits nearer to its own sub-folder than to any other one, and
  // pages of different sub-folders never crowd each other.
  const pages = plan.nodes.filter((node) => node.kind === "page" && node.folderId.startsWith("folder:concepts/"));
  for (const item of pages) {
    const own = byId.get(item.folderId);
    const ownDistance = Math.hypot(item.x - own.x, item.y - own.y);
    for (const other of subFolders) {
      if (other.id === item.folderId) continue;
      assert.ok(Math.hypot(item.x - other.x, item.y - other.y) > ownDistance, `${item.id} stays with ${own.id}`);
    }
  }
  for (const left of pages)
    for (const right of pages) {
      if (left.id >= right.id || left.folderId === right.folderId) continue;
      assert.ok(Math.hypot(left.x - right.x, left.y - right.y) >= 20, `${left.id} and ${right.id} keep apart`);
    }
  // Neighbouring sub-folder anchors are further apart than two page slots.
  for (const left of subFolders)
    for (const right of subFolders) {
      if (left.id >= right.id) continue;
      assert.ok(Math.hypot(left.x - right.x, left.y - right.y) >= 60);
    }
  // The sector's measured radius covers its furthest page.
  const sector = plan.sectors.find((entry) => entry.folderId === "folder:concepts");
  const anchor = byId.get("folder:concepts");
  for (const item of pages)
    assert.ok(Math.hypot(item.x - anchor.x, item.y - anchor.y) <= sector.clusterRadius + 1);
  // A neighbouring sector keeps clear of the whole fan.
  const sources = byId.get("folder:sources");
  assert.ok(Math.hypot(sources.x - anchor.x, sources.y - anchor.y) >= sector.clusterRadius * 0.5);
});

test("fit keeps the Garden centred on a balanced map but frames the whole map when one sector dwarfs the rest", () => {
  const viewport = { width: 1600, height: 1000 };
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const limits = { minScale: 0.3, maxScale: 1.35 };
  const balanced = fitTransform({ minX: -500, minY: -300, maxX: 500, maxY: 300 }, viewport, insets, limits, { x: 0, y: 0 });
  // World (0,0) is drawn at (width/2, height/2) before the transform.
  assert.ok(Math.abs(balanced.x + balanced.k * (viewport.width / 2) - viewport.width / 2) < 1e-6, "garden at the centre");
  const lopsided = fitTransform({ minX: -200, minY: -300, maxX: 2000, maxY: 300 }, viewport, insets, limits, { x: 0, y: 0 });
  assert.ok(lopsided.k > 0.7, `the frame uses the viewport for the map, not for empty space (${lopsided.k})`);
  const screenX = (wx) => lopsided.x + lopsided.k * (wx + viewport.width / 2);
  assert.ok(screenX(-200) >= -1e-6 && screenX(2000) <= viewport.width + 1e-6, "both map edges are on screen");
});

test("connection strength ramps over a fixed span above the threshold", () => {
  // Centred-cosine Gardens sit around 0.4; the strongest real pairs top out
  // about 0.35 above that, so that span is where the full colour range goes.
  assert.equal(connectionStrength(0.4, 0.4), 0);
  assert.ok(Math.abs(connectionStrength(0.575, 0.4) - 0.5) < 1e-9);
  assert.equal(connectionStrength(0.9, 0.4), 1);
  // Raw-cosine Gardens near the 0.82 clamp keep a narrower span.
  assert.equal(connectionStrength(1, 0.82), 1);
  assert.ok(connectionStrength(0.91, 0.82) > 0.49);
  assert.equal(connectionStrength(0.3, 0.4), 0);
  assert.ok(connectionOpacity(0) < connectionOpacity(0.5));
  assert.ok(connectionOpacity(1) <= 0.9);
});

test("navigation slugs match what Quartz publishes", () => {
  assert.equal(
    topologyNavigationSlug("electromagnetism-1/Concepts/6. Static Magnetic Fields"),
    "electromagnetism-1/Concepts/6.-Static-Magnetic-Fields",
  );
  assert.equal(topologyNavigationSlug("/garden/Sources/lecture 1.md"), "garden/Sources/lecture-1");
  assert.equal(topologyNavigationSlug("garden/Q&A 100% done?#"), "garden/Q-and-A-100-percent-done");
  assert.equal(topologyNavigationSlug("garden/folder/_index"), "garden/folder/index");
  assert.equal(topologyNavigationSlug("garden\\Folder Name"), "garden/Folder-Name");
});

test("excluded folders leave the map with their subtree, pages and connections", () => {
  const payload = fixture([
    edge("edge:bridge", "page:l11", "page:l12", 0.9),
    edge("edge:cross", "page:w7", "page:q12", 0.7),
    edge("edge:sub", "page:w1", "page:wsub1", 0.8),
  ]);
  payload.folders.push(
    folder(
      "folder:waves-sub",
      "module-v-waves-and-oscilations/extras",
      "Extras",
      2,
      1,
      "folder:waves",
    ),
  );
  payload.nodes.push(page("page:wsub1", "folder:waves-sub", "Extra waves topic"));

  const full = planThoughtTopology(payload);
  assert.ok(full.nodes.some((node) => node.id === "folder:waves-sub"));
  assert.ok(full.nodes.some((node) => node.id === "page:wsub1"));
  assert.equal(full.edges.length, 3);
  assert.deepEqual(
    full.folderOptions.filter((option) => option.depth === 2).map((option) => option.id),
    ["folder:waves-sub"],
  );
  assert.equal(
    full.folderOptions.find((option) => option.id === "folder:waves").pageCount,
    12,
    "a folder's page count covers its whole subtree",
  );
  assert.ok(full.folderOptions.every((option) => option.excluded === false));
  assert.equal(full.hiddenFolders.length, 0);

  const trimmed = planThoughtTopology(payload, { excludedFolderIds: ["folder:waves"] });
  for (const id of ["folder:waves", "folder:waves-sub", "page:w7", "page:wsub1"]) {
    assert.equal(
      trimmed.nodes.some((node) => node.id === id),
      false,
      `${id} is gone`,
    );
  }
  assert.deepEqual(
    trimmed.edges.map((item) => item.id),
    ["edge:bridge"],
    "connections touching excluded pages disappear",
  );
  assert.ok(
    trimmed.hierarchyEdges.every(
      (item) => item.source !== "folder:waves" && item.target !== "folder:waves",
    ),
  );
  assert.deepEqual(
    trimmed.hiddenFolders.map((item) => [item.id, item.reason]),
    [
      ["folder:waves", "excluded"],
      ["folder:waves-sub", "excluded"],
    ],
  );
  const wavesOption = trimmed.folderOptions.find((option) => option.id === "folder:waves");
  const subOption = trimmed.folderOptions.find((option) => option.id === "folder:waves-sub");
  assert.equal(wavesOption.excluded, true);
  assert.equal(wavesOption.inheritedExclusion, false);
  assert.equal(subOption.excluded, true);
  assert.equal(subOption.inheritedExclusion, true);
  assert.equal(trimmed.visiblePageCount, full.visiblePageCount - 12);
  assert.ok(trimmed.sectors.every((sector) => sector.folderId !== "folder:waves"));

  const subOnly = planThoughtTopology(payload, { excludedFolderIds: ["folder:waves-sub"] });
  assert.ok(subOnly.nodes.some((node) => node.id === "folder:waves"));
  assert.equal(subOnly.nodes.some((node) => node.id === "page:wsub1"), false);
  assert.deepEqual(
    subOnly.edges.map((item) => item.id).sort(),
    ["edge:bridge", "edge:cross"],
  );
});

test("a minimum connection strength hides the weaker links only", () => {
  const payload = fixture([
    edge("edge:bridge", "page:l11", "page:l12", 0.9),
    edge("edge:cross", "page:w7", "page:q12", 0.7),
    edge("edge:authored", "page:q2", "page:l13", 0.8, "authored"),
  ]);
  const all = planThoughtTopology(payload);
  assert.equal(all.edges.length, 3);
  assert.equal(
    all.edges.find((item) => item.id === "edge:authored").strength,
    AUTHORED_CONNECTION_STRENGTH,
    "authored links carry a fixed light weight",
  );
  const strongOnly = planThoughtTopology(payload, { minConnectionStrength: 0.5 });
  assert.deepEqual(
    strongOnly.edges.map((item) => item.id).sort(),
    ["edge:bridge"],
  );
  const strongest = planThoughtTopology(payload, { minConnectionStrength: 0.7 });
  assert.deepEqual(
    strongest.edges.map((item) => item.id),
    ["edge:bridge"],
  );
  assert.equal(strongest.nodes.length, all.nodes.length, "nodes stay; only lines go");
});

test("a per-page connection cap keeps each page's strongest lines", () => {
  const payload = fixture([
    edge("edge:a", "page:l1", "page:l2", 0.95),
    edge("edge:b", "page:l1", "page:l3", 0.9),
    edge("edge:weak", "page:l2", "page:l3", 0.7),
    edge("edge:spoke", "page:l1", "page:l4", 0.85),
    edge("edge:e", "page:w1", "page:w2", 0.66),
  ]);
  const all = planThoughtTopology(payload);
  assert.equal(all.edges.length, 5);
  const single = planThoughtTopology(payload, { maxConnectionsPerNode: 1 });
  assert.deepEqual(
    single.edges.map((item) => item.id).sort(),
    ["edge:a", "edge:b", "edge:e", "edge:spoke"],
    "each page keeps its strongest line, so a spoke's only line survives while the weak triangle side goes",
  );
  const pair = planThoughtTopology(payload, { maxConnectionsPerNode: 2 });
  assert.equal(pair.edges.length, 5, "a cap wider than every degree keeps everything");
  assert.equal(single.nodes.length, all.nodes.length, "nodes stay; only lines go");
});
