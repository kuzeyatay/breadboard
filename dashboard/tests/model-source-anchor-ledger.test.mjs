import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ModelSourceAnchorLedgerValidationError,
  modelSourcePageAnchors,
  normalizeSourceAnchorQuoteWhitespace,
  persistModelAuthoredSourceAnchors,
  selectedStructuralSourcePageHints,
  verifyModelAuthoredSourceAnchors,
} from "../src/lib/model-source-anchor-ledger.ts";

function source(slug, body, overrides = {}) {
  return {
    id: `database-${slug}`,
    slug,
    title: `Title for ${slug}`,
    relPath: `sources/${slug}.md`,
    ...(body === undefined ? {} : { body }),
    ...overrides,
  };
}

function authoredAnchor(overrides = {}) {
  return {
    id: "S1.P2.ElectricField",
    sourceId: "electromagnetics",
    title: "Electric field",
    summary: "Charge produces an electric field.",
    exactText: "Charge produces an electric field.",
    ...overrides,
  };
}

test("exact quote verification collapses whitespace only and preserves model-authored fields", () => {
  const selectedSources = [source(
    "electromagnetics",
    "Opening text.\n\nCharge   produces\n an electric field.\n\nClosing text.",
  )];
  const candidate = authoredAnchor({
    title: "  Model spacing is retained  ",
    summary: "  Model summary is retained exactly.  ",
    exactText: "Charge produces an   electric\nfield.",
  });

  assert.equal(
    normalizeSourceAnchorQuoteWhitespace(candidate.exactText),
    "Charge produces an electric field.",
  );
  const records = verifyModelAuthoredSourceAnchors({
    sourceMap: { sourceAnchors: [candidate] },
    selectedSources,
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].id, candidate.id);
  assert.equal(records[0].sourceId, candidate.sourceId);
  assert.equal(records[0].title, candidate.title);
  assert.equal(records[0].semanticSummary, candidate.summary);
  assert.equal(records[0].exactText, candidate.exactText);
  assert.equal(records[0].kind, "text_concept");
  assert.equal(records[0].evidence.method, "exact_whitespace_normalized_substring");
  assert.equal(records[0].provenance.sourceRelPath, selectedSources[0].relPath);
  assert.equal("page" in records[0], false);
  assert.equal("conceptKeywords" in records[0], false);
});

test("verification rejects malformed identity, duplicate identity, and non-selected ownership", () => {
  const selectedSources = [source(
    "electromagnetics",
    "Charge produces an electric field.",
  )];
  assert.throws(
    () => verifyModelAuthoredSourceAnchors({
      sourceMap: {
        sourceAnchors: [
          authoredAnchor({ id: "not plausible" }),
          authoredAnchor({ id: "S1.P2.Duplicate" }),
          authoredAnchor({ id: "s1.p2.duplicate" }),
          authoredAnchor({ id: "S1.P2.WrongSource", sourceId: "database-electromagnetics" }),
        ],
      },
      selectedSources,
    }),
    (error) => {
      assert.ok(error instanceof ModelSourceAnchorLedgerValidationError);
      assert.match(error.problems.join("\n"), /plausible canonical source-anchor id/);
      assert.match(error.problems.join("\n"), /duplicates source-anchor id/i);
      assert.match(error.problems.join("\n"), /sourceId must exactly equal a selected source id/);
      return true;
    },
  );
});

test("verification never fuzzy-matches or borrows a quote from another selected source", () => {
  const selectedSources = [
    source("declared", "Electric fields change when charges move."),
    source("other", "Electric field changes when charge moves."),
  ];
  assert.throws(
    () => verifyModelAuthoredSourceAnchors({
      sourceMap: {
        sourceAnchors: [authoredAnchor({
          id: "S1.P1.FieldChange",
          sourceId: "declared",
          exactText: "Electric field changes when charge moves.",
        })],
      },
      selectedSources,
    }),
    (error) => {
      assert.ok(error instanceof ModelSourceAnchorLedgerValidationError);
      assert.match(error.message, /not an exact whitespace-normalized quote from selected source "declared"/);
      return true;
    },
  );

  assert.throws(
    () => verifyModelAuthoredSourceAnchors({
      sourceMap: { sourceAnchors: [authoredAnchor()] },
      selectedSources: [source("electromagnetics", undefined)],
    }),
    /has no body for exact quote verification/,
  );
});

test("structural page catalog projects only exact Page blocks in selected-source order", () => {
  const selectedSources = [
    source(
      "first",
      [
        "Document preface is not a page block.",
        "## Page 2",
        "Exact page two line.  ",
        "Second line.",
        "## Page 4",
        "Exact page four text.",
        "## page 9",
        "Wrong-case heading stays inside page four.",
      ].join("\n"),
    ),
    source("second", "## Page 1\r\nSecond source text.\r\n"),
  ];

  assert.deepEqual(modelSourcePageAnchors(selectedSources), [
    {
      id: "text-first-page-2",
      kind: "guidance",
      sourceId: "first",
      page: 2,
      title: "Page 2",
      exactText: "Exact page two line.  \nSecond line.",
      provenance: {
        origin: "selected_source_markdown_page",
        sourceRelPath: "sources/first.md",
        extraction: "exact_markdown_page_block",
      },
    },
    {
      id: "text-first-page-4",
      kind: "guidance",
      sourceId: "first",
      page: 4,
      title: "Page 4",
      exactText: "Exact page four text.\n## page 9\nWrong-case heading stays inside page four.",
      provenance: {
        origin: "selected_source_markdown_page",
        sourceRelPath: "sources/first.md",
        extraction: "exact_markdown_page_block",
      },
    },
    {
      id: "text-second-page-1",
      kind: "guidance",
      sourceId: "second",
      page: 1,
      title: "Page 1",
      exactText: "Second source text.",
      provenance: {
        origin: "selected_source_markdown_page",
        sourceRelPath: "sources/second.md",
        extraction: "exact_markdown_page_block",
      },
    },
  ]);
  assert.throws(
    () => modelSourcePageAnchors([
      source("duplicate", "## Page 3\nFirst.\n## Page 3\nSecond."),
    ]),
    /duplicate exact Markdown heading "## Page 3"/,
  );
});

test("structural page catalog excludes repeated AnyDoc cross-check page headings", () => {
  assert.deepEqual(modelSourcePageAnchors([
    source("dual-parser", [
      "## Page 1",
      "Canonical VLM page one.",
      "## Page 2",
      "Canonical VLM page two.",
      "## AnyDoc cross-check",
      "## Page 1",
      "Supplemental AnyDoc page one.",
    ].join("\n")),
  ]).map(({ id, page, exactText }) => ({ id, page, exactText })), [
    {
      id: "text-dual-parser-page-1",
      page: 1,
      exactText: "Canonical VLM page one.",
    },
    {
      id: "text-dual-parser-page-2",
      page: 2,
      exactText: "Canonical VLM page two.",
    },
  ]);
});

test("Source Map structural selection requests only its exact late PDF page", () => {
  const selectedSources = [source(
    "electromagnetics",
    [
      "## Page 197",
      "Figure 8-12. Ordinary magnetic-field caption with no canonical artifact token.",
      "## Page 210",
      "Figure 8-31. Another ordinary caption on an unselected page.",
    ].join("\n"),
    { sourcePdf: "/electromagnetism/assets/electromagnetics.pdf" },
  )];
  const catalog = modelSourcePageAnchors(selectedSources);

  assert.deepEqual(selectedStructuralSourcePageHints({
    sourceMap: {
      sourceAnchors: [{
        id: "text-electromagnetics-page-197",
        sourceId: "electromagnetics",
        title: "Late selected page",
        summary: "The model selected this page's evidence.",
      }],
    },
    catalog,
    selectedSources,
  }), [{
    anchorId: "text-electromagnetics-page-197",
    sourceId: "electromagnetics",
    sourceIndex: 1,
    pageNumber: 197,
  }]);
});

test("Source Map page hints do not normalize ids or scan unselected PDF pages", () => {
  const selectedSources = [
    source("first", "## Page 197\nSelected page.", {
      sourcePdf: "/garden/assets/first.pdf",
    }),
    source("second", "## Page 197\nSame page number, different source.\n## Page 210\nUnselected.", {
      sourcePdf: "/garden/assets/second.pdf",
    }),
  ];
  const catalog = modelSourcePageAnchors(selectedSources);

  assert.deepEqual(selectedStructuralSourcePageHints({
    sourceMap: {
      sourceAnchors: [
        { id: "text-second-page-197", sourceId: "second" },
        { id: " text-first-page-197 ", sourceId: "first" },
        { id: "text-second-page-210", sourceId: "first" },
      ],
    },
    catalog,
    selectedSources,
  }), [{
    anchorId: "text-second-page-197",
    sourceId: "second",
    sourceIndex: 2,
    pageNumber: 197,
  }]);
});

test("persistence replaces only selected-source text records and preserves the rest of the ledger", (t) => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-model-anchor-ledger-"));
  t.after(() => fs.rmSync(gardenDir, { recursive: true, force: true }));
  const ledgerPath = path.join(gardenDir, ".breadboard", "source-anchors.json");
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const retained = {
    id: "S2.P9.Retained",
    kind: "text_concept",
    sourceId: "unselected",
    title: "Retained verbatim",
    semanticSummary: "Retained summary",
    exactText: "Retained quote.",
  };
  const structural = [{
    id: "S9.P1.Intro",
    kind: "intro",
    sourceId: "unselected",
    title: "Existing structural anchor",
    exactText: "Existing structural text.",
  }];
  const existing = {
    schemaVersion: 7,
    customMetadata: { preserve: ["exactly", true] },
    sourceTextConceptAnchors: [
      retained,
      { ...retained, id: "S1.P1.Old", sourceId: "selected" },
    ],
    sourceStructuralAnchors: structural,
  };
  fs.writeFileSync(ledgerPath, `${JSON.stringify(existing, null, 2)}\n`);
  const selectedSources = [source("selected", "New selected exact quote.")];
  const sourceMap = { sourceAnchors: [authoredAnchor({
    id: "S1.P1.New",
    sourceId: "selected",
    title: "New authored title",
    summary: "New authored summary",
    exactText: "New selected exact quote.",
  })] };

  const first = persistModelAuthoredSourceAnchors({ gardenDir, sourceMap, selectedSources });
  assert.equal(first.changed, true);
  assert.equal(first.ledgerPath, ledgerPath);
  assert.deepEqual(first.ledger.customMetadata, existing.customMetadata);
  assert.deepEqual(first.ledger.sourceStructuralAnchors, structural);
  assert.deepEqual(first.ledger.sourceTextConceptAnchors[0], retained);
  assert.deepEqual(
    first.ledger.sourceTextConceptAnchors.map((record) => record.id),
    ["S2.P9.Retained", "S1.P1.New"],
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(ledgerPath, "utf8")), first.ledger);

  const second = persistModelAuthoredSourceAnchors({ gardenDir, sourceMap, selectedSources });
  assert.equal(second.changed, false);
  assert.deepEqual(second.ledger, first.ledger);
});

test("persistence refuses an incoming ID collision owned by an unselected source without writing", (t) => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-model-anchor-collision-"));
  t.after(() => fs.rmSync(gardenDir, { recursive: true, force: true }));
  const ledgerPath = path.join(gardenDir, ".breadboard", "source-anchors.json");
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const existing = {
    sourceTextConceptAnchors: [{
      id: "S1.P1.Collision",
      sourceId: "unselected",
      title: "Existing",
      semanticSummary: "Existing",
      exactText: "Existing.",
    }],
    sourceStructuralAnchors: [],
  };
  const before = `${JSON.stringify(existing, null, 2)}\n`;
  fs.writeFileSync(ledgerPath, before);

  assert.throws(
    () => persistModelAuthoredSourceAnchors({
      gardenDir,
      selectedSources: [source("selected", "Incoming exact quote.")],
      sourceMap: { sourceAnchors: [authoredAnchor({
        id: "S1.P1.Collision",
        sourceId: "selected",
        exactText: "Incoming exact quote.",
      })] },
    }),
    /collides with a record owned by an unselected source/,
  );
  assert.equal(fs.readFileSync(ledgerPath, "utf8"), before);
});
