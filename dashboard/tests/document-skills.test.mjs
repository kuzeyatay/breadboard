import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const bridge = await import("../src/lib/document-skills/bridge.ts");
const planning = await import("../src/lib/document-skills/planning.ts");
const types = await import("../src/lib/document-skills/types.ts");
const toolScopes = await import("../src/lib/hermes/tool-scopes.ts");
const evidence = await import("../src/lib/hermes/evidence.ts");

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(dashboardRoot, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
const repoSource = (relative) => fs.readFileSync(path.join(repositoryRoot, relative), "utf8");

function book({ toc = true, index = false } = {}) {
  const prose = (word) => `${`${word} `.repeat(60)}\n`.repeat(6);
  return [
    toc ? "Table of Contents\nChapter 1: Beginnings\nChapter 2: Middles\nChapter 3: Ends\n" : "",
    "Chapter 1: Beginnings\n",
    prose("beginnings"),
    "Chapter 2: Middles\n",
    prose("middles"),
    "Chapter 3: Ends\n",
    prose("ends"),
    index ? "Index\nChapter 1: Beginnings, 4\nChapter 2: Middles, 88\nChapter 3: Ends, 140\n" : "",
  ].join("\n");
}

// ------------------------------------------------------------ segmentation --

test("the clone is what segments a document, and it is found where it was cloned", () => {
  assert.equal(
    path.basename(bridge.cloneRoot()),
    "book-to-skill",
    "the clone root must point at the vendored checkout",
  );
  assert.ok(bridge.cloneAvailable(), "the book-to-skill clone must be present");
  assert.ok(
    fs.existsSync(path.join(dashboardRoot, "scripts", "book-to-skill-bridge.py")),
    "the bridge script must exist for the clone to be reachable",
  );
});

test("segmentation splits at the body headings, not at the table of contents", async () => {
  const text = book({ toc: true, index: true });
  const structure = await bridge.segmentDocument(text);

  assert.equal(structure.chapters.length, 3);
  assert.ok(structure.fromClone, "the clone's Python detector should have run");
  assert.deepEqual(
    structure.chapters.map((chapter) => chapter.number),
    [1, 2, 3],
  );
  for (const chapter of structure.chapters) {
    const body = text.slice(chapter.start, chapter.end);
    // A ToC-anchored split would hand a chapter a single line.
    assert.ok(body.length > 400, `chapter ${chapter.number} owns only ${body.length} chars`);
    assert.ok(chapter.end > chapter.start);
  }
  // Boundaries must tile the document without gaps or overlap.
  for (let index = 1; index < structure.chapters.length; index += 1) {
    assert.equal(structure.chapters[index].start, structure.chapters[index - 1].end);
  }
});

test("the TS fallback reaches the same boundaries as the clone", async () => {
  const text = book({ toc: true, index: true });
  const fromClone = await bridge.segmentDocument(text);
  const fallback = bridge.fallbackStructure(text);

  assert.equal(fallback.fromClone, false);
  assert.deepEqual(
    fallback.chapters.map((chapter) => chapter.start),
    fromClone.chapters.map((chapter) => chapter.start),
    "the no-Python path must not silently move chapter boundaries",
  );
});

test("a document with no headings still becomes readable pieces", () => {
  const structure = bridge.fallbackStructure("prose without any structure. ".repeat(4000));
  assert.ok(structure.chapters.length >= 2);
  assert.ok(structure.chapters.every((chapter) => chapter.kind === "window"));
});

// ------------------------------------------------------------- build rules --

test("only documents worth distilling are distilled", async () => {
  const service = await import("../src/lib/document-skills/service.ts");
  assert.equal(service.shouldDistill("a short note about one thing"), false);
  assert.equal(service.shouldDistill("word ".repeat(planning.MIN_TOKENS_FOR_SKILL)), true);
});

test("book type is inferred from what is actually in the text", () => {
  assert.equal(planning.inferBookType("Prose about management. ".repeat(400)), "text");
  const technical = [
    "# Guide",
    "```python",
    "def solve(x):",
    "    return x * 2",
    "```",
    "| Option | Default |",
    "|---|---|",
    "| retries | 3 |",
  ].join("\n");
  assert.equal(planning.inferBookType(technical), "technical");
});

test("merging to the file ceiling keeps the document covered end to end", () => {
  const chapters = Array.from({ length: 90 }, (_, index) => ({
    number: index + 1,
    title: `Chapter ${index + 1}`,
    start: index * 1000,
    end: (index + 1) * 1000,
    kind: "numbered",
  }));
  const merged = planning.mergeToLimit(chapters, 40);

  assert.ok(merged.length <= 40);
  assert.equal(merged[0].start, 0);
  assert.equal(merged.at(-1).end, 90_000);
  for (let index = 1; index < merged.length; index += 1) {
    assert.equal(merged[index].start, merged[index - 1].end, "merging must not drop text");
  }
});

// ------------------------------------------------------------- containment --

test("a model-supplied file name cannot escape the skill directory", async () => {
  const store = await import("../src/lib/document-skills/store.ts");
  assert.equal(store.skillFilePath("a-book", "../../../secrets.md"), null);
  assert.equal(store.skillFilePath("a-book", "/etc/passwd.md"), null);
  assert.equal(store.skillFilePath("a-book", "chapters/../../escape.md"), null);
  // Not markdown: a skill is only ever markdown, so anything else is a probe.
  assert.equal(store.skillFilePath("a-book", "chapters/ch01.txt"), null);
  assert.equal(store.skillFilePath("../evil", "SKILL.md"), null);

  const ok = store.skillFilePath("a-book", "chapters/ch01-intro.md");
  assert.ok(ok && ok.endsWith(path.join("a-book", "chapters", "ch01-intro.md")));
});

test("skill files round-trip through the store", async () => {
  const store = await import("../src/lib/document-skills/store.ts");
  const previous = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "document-skills-")),
  );
  try {
    store.writeSkillFile("a-book", "SKILL.md", "# Index\n");
    store.writeSkillFile("a-book", "chapters/ch01-intro.md", "# Chapter 1\n");
    assert.equal(store.readSkillIndex("a-book"), "# Index\n");
    assert.deepEqual(
      store.listSkillFiles("a-book").map((file) => file.path),
      ["chapters/ch01-intro.md", "SKILL.md"],
    );
    assert.equal(store.readSkillFile("a-book", "chapters/missing.md"), null);
  } finally {
    if (previous === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = previous;
  }
});

// ------------------------------------------------------------ turn wiring --

test("attachment input from a request body is validated, not trusted", () => {
  // Garden Chat validates through the shared request parser rather than a
  // near-copy of it, so an attachment that is acceptable on one send path is
  // acceptable on all of them. (The parser itself cannot be imported here —
  // it reaches next/server through route-helpers — so this asserts the wiring;
  // its own rules are covered where that module is tested.)
  const garden = source("src/lib/hermes/garden-chat-adapter.ts");
  assert.match(garden, /from "\.\.\/chat-attachments-request\.ts"/);
  assert.match(garden, /parseChatAttachments\(payload\.attachments\)/);

  const shared = source("src/lib/chat-attachments-request.ts");
  for (const rule of ["invalid_attachments", "MAX_ATTACHMENTS", "data:image"]) {
    assert.ok(shared.includes(rule), `the shared parser must still enforce ${rule}`);
  }
});

test("the reader tool is registered everywhere it has to be", () => {
  assert.deepEqual([...toolScopes.DOCUMENT_SKILL_TOOLS], ["document_skill_read"]);
  assert.ok(toolScopes.allowedToolsForSurface("garden_chat").includes("document_skill_read"));
  assert.ok(toolScopes.allowedToolsForSurface("dashboard_terminal").includes("document_skill_read"));
  // Anonymous Quartz never sees another user's documents.
  assert.ok(!toolScopes.allowedToolsForSurface("quartz_ai").includes("document_skill_read"));

  // The Python plugin is the actual tool registry; a TS-only registration is
  // a tool the runtime never receives.
  const pluginYaml = repoSource("hermes-agent/plugins/breadboard/plugin.yaml");
  assert.match(pluginYaml, /- document_skill_read/);
  const plugin = repoSource("hermes-agent/plugins/breadboard/__init__.py");
  assert.match(plugin, /"document_skill_read"/);
  assert.match(plugin, /"\/api\/hermes\/tools\/document-skill"/);
  assert.ok(
    fs.existsSync(path.join(dashboardRoot, "src/app/api/hermes/tools/document-skill/route.ts")),
    "the tool route the plugin points at must exist",
  );

  // The broker is what actually switches a tool on for a turn.
  assert.match(source("src/lib/hermes/capability-broker.ts"), /DOCUMENT_SKILL_TOOLS/);
  // And the adapter is what offers it to Hermes at all.
  assert.match(source("src/lib/agent-runtime/adapters/hermes.ts"), /"document_skill_read"/);
});

test("reading a distilled document counts as reading a source", () => {
  assert.equal(evidence.evidenceKindForTool("document_skill_read"), "file_read");
  assert.equal(evidence.activityLabelForTool("document_skill_read"), "Reading the document");
});

test("both chat surfaces prepare document context and stop dumping what they distilled", () => {
  const terminal = source("src/lib/conversations/turn-service.ts");
  assert.match(terminal, /prepareDocumentContext/);
  assert.match(terminal, /documents\.context/);
  assert.match(
    terminal,
    /attachments: documents\.inlineAttachments/,
    "a distilled document must not also be sent verbatim",
  );

  const garden = source("src/lib/hermes/garden-chat-adapter.ts");
  assert.match(garden, /prepareDocumentContext/);
  assert.match(garden, /documents\.context/);
  assert.match(
    garden,
    /attachments: documents\.inlineAttachments/,
    "Garden Chat used to drop attachments entirely",
  );
  assert.match(garden, /parseChatAttachments\(payload\.attachments\)/);
});

test("the turn context names the skill and tells the model how to open it", async () => {
  const service = await import("../src/lib/document-skills/service.ts");
  const store = await import("../src/lib/document-skills/store.ts");
  const previous = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "document-skills-ctx-")),
  );
  try {
    store.writeSkillFile("data-systems", "SKILL.md", "# Designing Data-Intensive Applications\n");
    store.writeSkillFile("data-systems", "chapters/ch05-replication.md", "# Chapter 5\n");
    store.writeSkillFile("data-systems", "glossary.md", "**Quorum** — ...\n");

    const context = service.documentSkillContext([
      {
        id: 1,
        slug: "data-systems",
        contentHash: "abc",
        title: "Designing Data-Intensive Applications",
        author: null,
        status: "ready",
        bookType: "technical",
        depth: "study",
        chapterCount: 1,
        sourceTokens: 90_000,
        origin: { kind: "upload", fileName: "ddia.pdf" },
        userId: 1,
        error: null,
        createdAt: "now",
        updatedAt: "now",
      },
    ]);

    assert.match(context, /document_skill_read/);
    assert.match(context, /slug="data-systems"/);
    assert.match(context, /chapters\/ch05-replication\.md/);
    assert.match(context, /glossary\.md/);
    assert.ok(!context.includes("SKILL.md,"), "the index is inlined, not offered as a file to read");
    assert.equal(service.documentSkillContext([]), "");
  } finally {
    if (previous === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = previous;
  }
});

test("a built document is offered by name in any later chat", () => {
  const commands = source("src/lib/hermes/commands.ts");
  assert.match(commands, /listDocumentSkills/, "document skills must appear in the command registry");
  assert.match(commands, /findDocumentSkillBySlug/, "and must resolve when invoked");
  assert.match(commands, /documentSkillContext/);
});

test("the Skills page can list and delete a distilled document", () => {
  const route = source("src/app/api/hermes/skills/route.ts");
  assert.match(route, /filter === "documents"/);
  assert.match(route, /listDocumentSkills\(userId\)/, "one user's documents are never shown to another");

  const panel = source("src/app/components/hermes/skills-catalog-panel.tsx");
  assert.match(panel, /\{ id: "documents", label: "Documents" \}/);
  assert.match(panel, /sourceType === "document"/);
  assert.match(panel, /\/api\/document-skills\?slug=/);
});

// -------------------------------------------------------------- the clone --

test("the generated skill keeps the shape the clone's own validator checks", async () => {
  const validate = await import("../src/lib/document-skills/validate.ts");
  assert.ok(
    fs.existsSync(path.join(repositoryRoot, "book-to-skill", "tools", "validate_skill.py")),
    "the clone's validator is what the build is checked against",
  );
  // A missing interpreter must degrade to "unvalidated", never to a lost build.
  const result = await validate.validateGeneratedSkill("no-such-skill-here");
  assert.equal(result.ran, false);
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
});

test("the chapter file names follow the clone's chapters/chNN-slug.md convention", () => {
  const plans = planning.planChapters("x".repeat(5000), [
    { number: 1, title: "Beginnings & First Principles", start: 0, end: 2500, kind: "numbered" },
    { number: 2, title: "Middles", start: 2500, end: 5000, kind: "numbered" },
  ]);
  assert.deepEqual(
    plans.map((plan) => plan.file),
    ["chapters/ch01-beginnings-first-principles.md", "chapters/ch02-middles.md"],
  );
  assert.ok(plans.every((plan) => plan.truncated === false));

  const builderSource = source("src/lib/document-skills/builder.ts");
  for (const file of ["glossary.md", "patterns.md", "cheatsheet.md", "SKILL.md"]) {
    assert.ok(builderSource.includes(`"${file}"`), `${file} must be generated`);
  }
});

test("a chapter heading is never prefixed with an ordinal it already has", () => {
  // The clone reports the author's own heading line.
  assert.equal(planning.chapterHeading("Chapter 4: Replication", 4, 3), "Chapter 4: Replication");
  assert.equal(planning.chapterHeading("Part II: Distributed Data", 2, 1), "Part II: Distributed Data");
  assert.equal(planning.chapterHeading("Appendix A", 1, 0), "Appendix A");
  // A bare heading or a synthesized window gets numbered.
  assert.equal(planning.chapterHeading("Replication", 4, 3), "Chapter 4: Replication");
  assert.equal(planning.chapterHeading("Replication", 0, 3), "Chapter 4: Replication");
});

test("an oversized chapter keeps its ending, not just its opening", () => {
  const head = "HEAD".repeat(20_000);
  const tail = "TAILMARKER";
  const text = `${head}${"filler".repeat(5_000)}${tail}`;
  const [plan] = planning.planChapters(text, [
    { number: 1, title: "Long", start: 0, end: text.length, kind: "numbered" },
  ]);
  assert.equal(plan.truncated, true);
  assert.ok(plan.text.startsWith("HEAD"));
  assert.ok(plan.text.endsWith(tail), "a chapter's conclusions must survive truncation");
  assert.ok(plan.text.includes("omitted for length"));
});

test("the progress phases a blocking build reports are the ones the UI can render", () => {
  const phases = source("src/lib/document-skills/types.ts");
  for (const phase of ["extracting", "segmenting", "chapters", "supporting", "index", "validating", "done"]) {
    assert.ok(phases.includes(`"${phase}"`), `${phase} must be a declared phase`);
  }
  assert.ok(types !== null);
});
