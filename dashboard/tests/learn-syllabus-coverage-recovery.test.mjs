import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  mergeSyllabusCoverageRecoveryDecision,
  runSyllabusCoverageEvidenceRecovery,
  SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_CHARS,
  SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTOR_CANDIDATES,
  SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_ENTRIES,
  syllabusCoverageRecoveryReceiptProblems,
} from "../src/lib/learn-syllabus-coverage-recovery.ts";
import { syllabusCoverageDecisionProblems } from "../src/lib/learn-syllabus.ts";
import { modelSourcePageAnchors } from "../src/lib/model-source-anchor-ledger.ts";

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);

function selectorPage(payload, predicate) {
  const tuple = payload.pageCatalog.find((entry) => predicate(entry[2]));
  assert.ok(tuple);
  return {
    anchorId: tuple[0],
    sourceId: payload.sourceIds[tuple[1]],
    pageNumber: tuple[2],
    excerpt: tuple[3],
  };
}

function fixture() {
  const syllabusPlan = {
    courseTitle: "Fields",
    units: [{
      id: "SU1",
      label: "Lecture 1",
      title: "Coulomb fields",
      objectives: ["Derive the field"],
      topics: ["Coulomb law"],
      materialIds: ["R1"],
    }],
    referencedMaterials: [{
      id: "R1",
      citation: "Hayt, Engineering Electromagnetics, section 2.1",
      title: "Engineering Electromagnetics",
      authors: ["Hayt"],
      kind: "textbook",
      locator: "section 2.1",
      required: true,
    }],
  };
  const initialDecision = {
    resolutions: [{
      materialId: "R1",
      citation: syllabusPlan.referencedMaterials[0].citation,
      status: "missing",
      sourceIds: [],
      matchReason: "The fixed prefix contains only contents entries.",
    }],
    units: [{
      unitId: "SU1",
      availableSourceIds: [],
      missingCitations: [syllabusPlan.referencedMaterials[0].citation],
      teachable: false,
      coverageReason: "No substantive page was transported.",
    }],
  };
  const first = "## Page 1\r\nTitle and contents\r\n";
  const nineteenth = "## Page 19\r\nCoulomb law is derived from force and charge.\r\n\r\n";
  const sources = [{
    sourceId: "book",
    relPath: "sources/book.md",
    body: `## Internal planning\r\nnonproof\r\n## Source material\r\n${first}${nineteenth}`,
  }];
  const anchors = modelSourcePageAnchors([{
    id: "book",
    slug: "book",
    title: "Book",
    relPath: "sources/book.md",
    body: sources[0].body,
  }]);
  const finalDecision = {
    resolutions: [{
      materialId: "R1",
      citation: syllabusPlan.referencedMaterials[0].citation,
      status: "available",
      sourceIds: ["book"],
      matchReason: "Recovered canonical Page 19 directly identifies and teaches the assigned section.",
    }],
    units: [{
      unitId: "SU1",
      availableSourceIds: ["book"],
      missingCitations: [],
      teachable: true,
      coverageReason: "Recovered canonical Page 19 contains the substantive derivation.",
    }],
  };
  return { syllabusPlan, initialDecision, sources, anchors, finalDecision, nineteenth };
}

test("model-selected identities hydrate complete raw pages and bind an independent recovered verdict", async () => {
  const f = fixture();
  const requests = [];
  const result = await runSyllabusCoverageEvidenceRecovery({
    syllabusPlan: f.syllabusPlan,
    initialCoverageRaw: JSON.stringify(f.initialDecision),
    initialCoverageDecision: f.initialDecision,
    sources: f.sources,
    anchors: f.anchors,
    sourceSetHash: H1,
    sourceArtifactInventoryHash: H2,
    model: "model-a",
    provider: async (request) => {
      requests.push(request);
      if (request.phase === "page_selection") {
        const payload = JSON.parse(request.user);
        const page = selectorPage(payload, (pageNumber) => pageNumber === 19);
        assert.equal(page.sourceId, "book");
        return {
          rawResponse: JSON.stringify({
            selectedPages: [{
              anchorId: page.anchorId,
              selectionReason: "This is the substantive Coulomb-law page.",
            }],
            selectionReason: "One complete page directly tests the gap.",
          }),
          councilRunId: "selector-run",
          model: "model-a",
        };
      }
      const payload = JSON.parse(request.user);
      assert.equal(payload.recoveredPages[0].exactText, f.nineteenth);
      assert.equal(payload.recoveredPages[0].exactText.includes("\r\n"), true);
      return {
        rawResponse: JSON.stringify(f.finalDecision),
        councilRunId: "review-run",
        model: "model-a",
      };
    },
  });

  assert.equal(requests.length, 2);
  assert.equal(result.recovered, true);
  assert.equal(result.coverage.units[0].teachable, true);
  assert.equal(result.receipt.outcome, "recovered");
  assert.equal(result.receipt.selectedPages[0].exactText, f.nineteenth);
  assert.deepEqual(syllabusCoverageRecoveryReceiptProblems({
    receipt: result.receipt,
    sources: f.sources,
    anchors: f.anchors,
    coverage: result.coverage,
    expectedSourceSetHash: H1,
    expectedSourceArtifactInventoryHash: H2,
  }), []);
});

test("large canonical page catalogs retain every identity by uniformly bounding navigation excerpts", async () => {
  const f = fixture();
  const pageCount = 1_200;
  f.sources[0].body = [
    "## Source material",
    ...Array.from(
      { length: pageCount },
      (_, index) => `## Page ${index + 1}\n${`Navigation text for page ${index + 1}. `.repeat(24)}\n`,
    ),
  ].join("\n");
  f.anchors = modelSourcePageAnchors([{
    id: "book",
    slug: "book",
    title: "Book",
    relPath: "sources/book.md",
    body: f.sources[0].body,
  }]);

  const result = await runSyllabusCoverageEvidenceRecovery({
    syllabusPlan: f.syllabusPlan,
    initialCoverageRaw: JSON.stringify(f.initialDecision),
    initialCoverageDecision: f.initialDecision,
    sources: f.sources,
    anchors: f.anchors,
    sourceSetHash: H1,
    sourceArtifactInventoryHash: H2,
    model: "model-a",
    provider: async (request) => {
      if (request.phase === "page_selection") {
        const catalog = JSON.parse(request.user).pageCatalog;
        assert.equal(catalog.length, pageCount);
        assert.ok(
          JSON.stringify(catalog).length <= SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_CHARS,
        );
        assert.equal(catalog[0][2], 1);
        assert.equal(catalog.at(-1)[2], pageCount);
        assert.ok(catalog.every((entry) => entry[3].length < 320));
        const page = selectorPage(JSON.parse(request.user), () => true);
        page.anchorId = catalog.at(-1)[0];
        page.sourceId = JSON.parse(request.user).sourceIds[catalog.at(-1)[1]];
        page.pageNumber = catalog.at(-1)[2];
        return { rawResponse: JSON.stringify({
          selectedPages: [{
            anchorId: page.anchorId,
            selectionReason: "Use the last canonical page to verify bounded identity retention.",
          }],
          selectionReason: "The catalog retained every canonical identity within its fixed cap.",
        }) };
      }
      return { rawResponse: JSON.stringify(f.finalDecision) };
    },
  });

  assert.equal(result.receipt.selectedPages[0].pageNumber, pageCount);
  assert.match(result.receipt.selectedPages[0].exactText, /Navigation text for page 1200/);
});

test("a valid syllabus unit without its optional label survives receipt persistence and strict replay", async () => {
  const f = fixture();
  delete f.syllabusPlan.units[0].label;
  const result = await runSyllabusCoverageEvidenceRecovery({
    syllabusPlan: f.syllabusPlan,
    initialCoverageRaw: JSON.stringify(f.initialDecision),
    initialCoverageDecision: f.initialDecision,
    sources: f.sources,
    anchors: f.anchors,
    sourceSetHash: H1,
    sourceArtifactInventoryHash: H2,
    model: "model-a",
    provider: async (request) => {
      if (request.phase === "page_selection") {
        const page = selectorPage(JSON.parse(request.user), (pageNumber) => pageNumber === 19);
        return { rawResponse: JSON.stringify({
          selectedPages: [{
            anchorId: page.anchorId,
            selectionReason: "Use the exact substantive page.",
          }],
          selectionReason: "One bounded page is sufficient for rereview.",
        }) };
      }
      return { rawResponse: JSON.stringify(f.finalDecision) };
    },
  });
  const persistedReceipt = JSON.parse(JSON.stringify(result.receipt));
  assert.equal("label" in persistedReceipt.syllabusPlan.units[0], false);
  assert.deepEqual(syllabusCoverageRecoveryReceiptProblems({
    receipt: persistedReceipt,
    sources: f.sources,
    anchors: f.anchors,
    coverage: result.coverage,
    expectedSourceSetHash: H1,
    expectedSourceArtifactInventoryHash: H2,
  }), []);
});

test("valid zero rereview is terminal and never coerced to teachable", async () => {
  const f = fixture();
  let calls = 0;
  const result = await runSyllabusCoverageEvidenceRecovery({
    syllabusPlan: f.syllabusPlan,
    initialCoverageRaw: JSON.stringify(f.initialDecision),
    initialCoverageDecision: f.initialDecision,
    sources: f.sources,
    anchors: f.anchors,
    sourceSetHash: H1,
    sourceArtifactInventoryHash: H2,
    model: "model-a",
    provider: async (request) => {
      calls += 1;
      if (request.phase === "page_selection") {
        const page = selectorPage(JSON.parse(request.user), (pageNumber) => pageNumber === 19);
        return { rawResponse: JSON.stringify({
          selectedPages: [{
            anchorId: page.anchorId,
            selectionReason: "Test the only substantive page.",
          }],
          selectionReason: "Bounded evidence test.",
        }) };
      }
      return { rawResponse: JSON.stringify(f.initialDecision) };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.recovered, false);
  assert.equal(result.receipt.outcome, "zero_teachable");
  assert.equal(result.coverage.units[0].teachable, false);
});

test("a decision that refuses no unit never consumes a recovery provider call", async () => {
  const f = fixture();
  let calls = 0;
  await assert.rejects(
    runSyllabusCoverageEvidenceRecovery({
      syllabusPlan: f.syllabusPlan,
      initialCoverageRaw: JSON.stringify(f.finalDecision),
      initialCoverageDecision: f.finalDecision,
      sources: f.sources,
      anchors: f.anchors,
      sourceSetHash: H1,
      sourceArtifactInventoryHash: H2,
      model: "model-a",
      provider: async () => {
        calls += 1;
        return { rawResponse: "{}" };
      },
    }),
    /may run only after a coverage decision that refuses at least one unit/,
  );
  assert.equal(calls, 0);
});

test("selector re-asks on a schema-invalid answer and fails closed once the budget is spent", async () => {
  const f = fixture();
  let calls = 0;
  await assert.rejects(
    runSyllabusCoverageEvidenceRecovery({
      syllabusPlan: f.syllabusPlan,
      initialCoverageRaw: JSON.stringify(f.initialDecision),
      initialCoverageDecision: f.initialDecision,
      sources: f.sources,
      anchors: f.anchors,
      sourceSetHash: H1,
      sourceArtifactInventoryHash: H2,
      model: "model-a",
      provider: async () => {
        calls += 1;
        return { rawResponse: JSON.stringify({
          selectedPages: [{
            anchorId: "p1",
            sourceId: "wrong-source",
            pageNumber: 19,
            selectionReason: "Wrong binding.",
          }],
          selectionReason: "Wrong binding.",
        }) };
      },
    }),
    /bounded model candidate\(s\).*must contain exactly anchorId and selectionReason/,
  );
  // A malformed answer is re-asked up to the declared budget, then fails closed.
  assert.equal(calls, SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTOR_CANDIDATES);
});

test("receipt/source/page/raw/history tamper and stale replay fail closed", async () => {
  const f = fixture();
  const result = await runSyllabusCoverageEvidenceRecovery({
    syllabusPlan: f.syllabusPlan,
    initialCoverageRaw: JSON.stringify(f.initialDecision),
    initialCoverageDecision: f.initialDecision,
    sources: f.sources,
    anchors: f.anchors,
    sourceSetHash: H1,
    sourceArtifactInventoryHash: H2,
    model: "model-a",
    provider: async (request) => {
      if (request.phase === "page_selection") {
        const page = selectorPage(JSON.parse(request.user), (pageNumber) => pageNumber === 19);
        return { rawResponse: JSON.stringify({
          selectedPages: [{
            anchorId: page.anchorId,
            selectionReason: "Substantive page.",
          }],
          selectionReason: "Substantive page.",
        }) };
      }
      return { rawResponse: JSON.stringify(f.finalDecision) };
    },
  });
  const base = structuredClone(result.receipt);
  for (const mutate of [
    (receipt) => { receipt.selectedPages[0].exactText += "tamper"; },
    (receipt) => { receipt.selectorAttempts[0].rawResponse += " "; },
    (receipt) => { receipt.coverageReviewAttempts[0].validationProblems.push("forged"); },
    (receipt) => { receipt.caps.maximumSelectedPages = 31; },
    (receipt) => { receipt.integritySha256 = "0".repeat(64); },
  ]) {
    const receipt = structuredClone(base);
    mutate(receipt);
    assert.notDeepEqual(syllabusCoverageRecoveryReceiptProblems({
      receipt,
      sources: f.sources,
      anchors: f.anchors,
      expectedSourceSetHash: H1,
      expectedSourceArtifactInventoryHash: H2,
    }), []);
  }
  const changedSources = structuredClone(f.sources);
  changedSources[0].body = changedSources[0].body.replace("Coulomb law", "Changed law");
  const changedAnchors = modelSourcePageAnchors([{
    id: "book", slug: "book", title: "Book", relPath: "sources/book.md", body: changedSources[0].body,
  }]);
  assert.match(
    syllabusCoverageRecoveryReceiptProblems({
      receipt: base,
      sources: changedSources,
      anchors: changedAnchors,
      expectedSourceSetHash: H1,
      expectedSourceArtifactInventoryHash: H2,
    }).join("; "),
    /live source bindings|selected page projection/,
  );
});

test("structural headings outside Source material are not selectable authority", async () => {
  const f = fixture();
  f.sources[0].body = `## Page 999\nInternal planning decoy\n${f.sources[0].body}`;
  const anchors = modelSourcePageAnchors([{
    id: "book", slug: "book", title: "Book", relPath: "sources/book.md", body: f.sources[0].body,
  }]);
  let calls = 0;
  const result = await runSyllabusCoverageEvidenceRecovery({
    syllabusPlan: f.syllabusPlan,
    initialCoverageRaw: JSON.stringify(f.initialDecision),
    initialCoverageDecision: f.initialDecision,
    sources: f.sources,
    anchors,
    sourceSetHash: H1,
    sourceArtifactInventoryHash: H2,
    model: "model-a",
    provider: async (request) => {
      calls += 1;
      if (request.phase === "page_selection") {
        const catalog = JSON.parse(request.user).pageCatalog;
        assert.equal(catalog.some((entry) => entry[2] === 999), false);
        const page = selectorPage(JSON.parse(request.user), (pageNumber) => pageNumber === 19);
        return { rawResponse: JSON.stringify({
          selectedPages: [{
            anchorId: page.anchorId,
            selectionReason: "Use only proven source-material authority.",
          }],
          selectionReason: "The internal decoy was not selectable.",
        }) };
      }
      return { rawResponse: JSON.stringify(f.finalDecision) };
    },
  });
  assert.equal(result.recovered, true);
  assert.equal(calls, 2);
});

test("fence-tainted structural anchors are filtered before selector identity checks", async () => {
  const f = fixture();
  f.sources[0].body += [
    "## Page 20\r\n",
    "Unclosed exported formula begins here.\r\n",
    "```latex\r\n",
    "## Page 21\r\n",
    "This page-looking heading is inside the malformed fence.\r\n",
    "```\r\n",
    "## Page 22\r\n",
    "Clean later source page.\r\n",
  ].join("");
  const anchors = modelSourcePageAnchors([{
    id: "book", slug: "book", title: "Book", relPath: "sources/book.md", body: f.sources[0].body,
  }]);
  const acceptedPage19 = anchors.find((entry) => entry.page === 19);
  const taintedPage20 = anchors.find((entry) => entry.page === 20);
  assert.ok(acceptedPage19);
  assert.ok(taintedPage20);
  // A collision carried only by a withheld navigation anchor cannot poison
  // the accepted raw-page catalog or make that anchor selectable authority.
  taintedPage20.id = acceptedPage19.id;

  const result = await runSyllabusCoverageEvidenceRecovery({
    syllabusPlan: f.syllabusPlan,
    initialCoverageRaw: JSON.stringify(f.initialDecision),
    initialCoverageDecision: f.initialDecision,
    sources: f.sources,
    anchors,
    sourceSetHash: H1,
    sourceArtifactInventoryHash: H2,
    model: "model-a",
    provider: async (request) => {
      if (request.phase === "page_selection") {
        const catalog = JSON.parse(request.user).pageCatalog;
        assert.equal(catalog.some((entry) => entry[2] === 20), false);
        assert.equal(catalog.some((entry) => entry[2] === 21), false);
        assert.equal(catalog.some((entry) => entry[2] === 22), true);
        const page = selectorPage(JSON.parse(request.user), (pageNumber) => pageNumber === 19);
        return { rawResponse: JSON.stringify({
          selectedPages: [{
            anchorId: page.anchorId,
            selectionReason: "Select only the accepted raw source-material page.",
          }],
          selectionReason: "Fence-tainted navigation entries are not evidence.",
        }) };
      }
      return { rawResponse: JSON.stringify(f.finalDecision) };
    },
  });
  assert.equal(result.recovered, true);
});

/**
 * telecom-1, 2026-09-19: the coverage reviewer refused two of nine M2 units
 * because the bounded evidence transport never carried their pages, while the
 * other seven were teachable. Recovery used to require an all-false verdict, so
 * those two were dropped permanently and recorded as uncoverable syllabus items
 * even though the selected Keiser source covered one of them outright.
 */
function partialFixture() {
  const syllabusPlan = {
    courseTitle: "Fields",
    units: [
      {
        id: "SU1",
        label: "Lecture 1",
        title: "Coulomb fields",
        objectives: ["Derive the field"],
        topics: ["Coulomb law"],
        materialIds: ["R1"],
      },
      {
        id: "SU2",
        label: "Lecture 2",
        title: "Network topologies",
        objectives: ["Compare bus, ring and star"],
        topics: ["Topologies"],
        materialIds: ["R2"],
      },
    ],
    referencedMaterials: [
      {
        id: "R1",
        citation: "Hayt, Engineering Electromagnetics, section 2.1",
        title: "Engineering Electromagnetics",
        authors: ["Hayt"],
        kind: "textbook",
        locator: "section 2.1",
        required: true,
      },
      {
        id: "R2",
        citation: "Hayt, Engineering Electromagnetics, section 12.1",
        title: "Engineering Electromagnetics",
        authors: ["Hayt"],
        kind: "textbook",
        locator: "section 12.1",
        required: true,
      },
    ],
  };
  const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
  const page1 = `## Page 1${CRLF}Title and contents${CRLF}`;
  const page19 = `## Page 19${CRLF}Coulomb law is derived from force and charge.${CRLF}${CRLF}`;
  const page41 = `## Page 41${CRLF}Section 12.1 compares bus, ring and star topologies.${CRLF}${CRLF}`;
  const sources = [{
    sourceId: "book",
    relPath: "sources/book.md",
    body: `## Internal planning${CRLF}nonproof${CRLF}## Source material${CRLF}${page1}${page19}${page41}`,
  }];
  const anchors = modelSourcePageAnchors([{
    id: "book",
    slug: "book",
    title: "Book",
    relPath: "sources/book.md",
    body: sources[0].body,
  }]);
  // SU1 already teachable; SU2 refused only because its page was not transported.
  const initialDecision = {
    resolutions: [
      {
        materialId: "R1",
        citation: syllabusPlan.referencedMaterials[0].citation,
        status: "available",
        sourceIds: ["book"],
        matchReason: "Page 19 carries the assigned section.",
      },
      {
        materialId: "R2",
        citation: syllabusPlan.referencedMaterials[1].citation,
        status: "missing",
        sourceIds: [],
        matchReason: "No transported page established section 12.1.",
      },
    ],
    units: [
      {
        unitId: "SU1",
        availableSourceIds: ["book"],
        missingCitations: [],
        teachable: true,
        coverageReason: "Page 19 supports the unit in full.",
      },
      {
        unitId: "SU2",
        availableSourceIds: [],
        missingCitations: [syllabusPlan.referencedMaterials[1].citation],
        teachable: false,
        coverageReason: "No substantive page was transported for section 12.1.",
      },
    ],
  };
  const finalDecision = {
    resolutions: [
      initialDecision.resolutions[0],
      {
        materialId: "R2",
        citation: syllabusPlan.referencedMaterials[1].citation,
        status: "available",
        sourceIds: ["book"],
        matchReason: "Recovered canonical Page 41 identifies and teaches section 12.1.",
      },
    ],
    units: [
      initialDecision.units[0],
      {
        unitId: "SU2",
        availableSourceIds: ["book"],
        missingCitations: [],
        teachable: true,
        coverageReason: "Recovered canonical Page 41 compares the topologies.",
      },
    ],
  };
  return { syllabusPlan, initialDecision, finalDecision, sources, anchors, page41 };
}

for (const outcome of ["unchanged"]) test(`partial recovery reports ${outcome} without claiming success`, async () => {
  const f = partialFixture();
  const terminal = structuredClone(f.initialDecision);
  const result = await runSyllabusCoverageEvidenceRecovery({
    syllabusPlan: f.syllabusPlan, initialCoverageRaw: JSON.stringify(f.initialDecision), initialCoverageDecision: f.initialDecision,
    sources: f.sources, anchors: f.anchors, sourceSetHash: H1, sourceArtifactInventoryHash: H2, model: "model-a",
    provider: async (request) => {
      if (request.phase === "page_selection") {
        const page = selectorPage(JSON.parse(request.user), (number) => number === 41);
        return { rawResponse: JSON.stringify({ selectedPages: [{ anchorId: page.anchorId, selectionReason: "Test refused unit." }], selectionReason: "Retest." }), model: "model-a" };
      }
      return { rawResponse: JSON.stringify(terminal), model: "model-a" };
    },
  });
  assert.equal(result.recovered, false);
  assert.equal(result.receipt.outcome, outcome);
  assert.deepEqual(syllabusCoverageRecoveryReceiptProblems({ receipt: result.receipt, sources: f.sources, anchors: f.anchors, coverage: result.coverage }), []);
  const problems = syllabusCoverageRecoveryReceiptProblems({ receipt: { ...result.receipt, initialCoverageRaw: "null" }, sources: f.sources, anchors: f.anchors });
  assert.ok(problems.length, "tampering yields diagnostics rather than throwing during projection");
});

test("a rereview cannot refuse a unit it was handed no recovered pages for", async () => {
  const f = partialFixture();
  // The rereview sees the fixed source prefix plus only the pages selected for
  // the refused SU2, so a teachable: false on the untargeted SU1 is an artifact
  // of that bounded transport rather than a judgement about SU1. SU1 keeps the
  // verdict its own evidence won, and the run is not killed as a regression.
  const terminal = structuredClone(f.finalDecision);
  terminal.resolutions[0].status = "missing";
  terminal.resolutions[0].sourceIds = [];
  terminal.units[0] = {
    ...terminal.units[0],
    teachable: false,
    availableSourceIds: [],
    missingCitations: [f.syllabusPlan.referencedMaterials[0].citation],
  };
  const result = await runSyllabusCoverageEvidenceRecovery({
    syllabusPlan: f.syllabusPlan, initialCoverageRaw: JSON.stringify(f.initialDecision), initialCoverageDecision: f.initialDecision,
    sources: f.sources, anchors: f.anchors, sourceSetHash: H1, sourceArtifactInventoryHash: H2, model: "model-a",
    provider: async (request) => {
      if (request.phase === "page_selection") {
        const page = selectorPage(JSON.parse(request.user), (number) => number === 41);
        return { rawResponse: JSON.stringify({ selectedPages: [{ anchorId: page.anchorId, selectionReason: "Test refused unit." }], selectionReason: "Retest." }), model: "model-a" };
      }
      return { rawResponse: JSON.stringify(terminal), model: "model-a" };
    },
  });
  assert.equal(result.coverage.units[0].unitId, "SU1");
  assert.equal(result.coverage.units[0].teachable, true, "the untargeted unit keeps its proven verdict");
  assert.equal(result.receipt.outcome, "recovered");
  assert.equal(result.recovered, true);
  assert.equal(result.receipt.unteachableUnitIdsAfter.includes("SU1"), false);
  // The receipt still verifies end to end, merge included.
  assert.deepEqual(
    syllabusCoverageRecoveryReceiptProblems({ receipt: result.receipt, sources: f.sources, anchors: f.anchors, coverage: result.coverage }),
    [],
  );
});

test("a partially refused decision still runs recovery and can recover the refused unit", async () => {
  const f = partialFixture();
  const phases = [];
  const result = await runSyllabusCoverageEvidenceRecovery({
    syllabusPlan: f.syllabusPlan,
    initialCoverageRaw: JSON.stringify(f.initialDecision),
    initialCoverageDecision: f.initialDecision,
    sources: f.sources,
    anchors: f.anchors,
    sourceSetHash: H1,
    sourceArtifactInventoryHash: H2,
    model: "model-a",
    provider: async (request) => {
      phases.push(request.phase);
      if (request.phase === "page_selection") {
        const payload = JSON.parse(request.user);
        const page = selectorPage(payload, (pageNumber) => pageNumber === 41);
        return {
          rawResponse: JSON.stringify({
            selectedPages: [{
              anchorId: page.anchorId,
              selectionReason: "This page carries the refused unit's assigned section.",
            }],
            selectionReason: "The refused unit is the only verdict worth retesting.",
          }),
          councilRunId: "selector-run",
          model: "model-a",
        };
      }
      const payload = JSON.parse(request.user);
      assert.equal(payload.recoveredPages[0].exactText, f.page41);
      return {
        rawResponse: JSON.stringify(f.finalDecision),
        councilRunId: "review-run",
        model: "model-a",
      };
    },
  });

  assert.deepEqual(phases, ["page_selection", "coverage_rereview"]);
  assert.equal(result.receipt.unteachableUnitIdsBefore.length, 1);
  assert.equal(result.receipt.unteachableUnitIdsBefore[0], "SU2");
  assert.deepEqual(result.receipt.unteachableUnitIdsAfter, []);
  assert.equal(result.coverage.units[1].teachable, true);
  // The already-teachable unit is never disturbed by the rereview.
  assert.equal(result.coverage.units[0].teachable, true);
  assert.equal(
    syllabusCoverageRecoveryReceiptProblems({
      receipt: result.receipt,
      sources: f.sources,
      anchors: f.anchors,
      coverage: result.coverage,
      expectedSourceSetHash: H1,
      expectedSourceArtifactInventoryHash: H2,
    }).length,
    0,
  );
});

test("a receipt whose refused-unit list disagrees with its initial decision is rejected", async () => {
  const f = partialFixture();
  const result = await runSyllabusCoverageEvidenceRecovery({
    syllabusPlan: f.syllabusPlan,
    initialCoverageRaw: JSON.stringify(f.initialDecision),
    initialCoverageDecision: f.initialDecision,
    sources: f.sources,
    anchors: f.anchors,
    sourceSetHash: H1,
    sourceArtifactInventoryHash: H2,
    model: "model-a",
    provider: async (request) => {
      if (request.phase === "page_selection") {
        const payload = JSON.parse(request.user);
        const page = selectorPage(payload, (pageNumber) => pageNumber === 41);
        return {
          rawResponse: JSON.stringify({
            selectedPages: [{ anchorId: page.anchorId, selectionReason: "Assigned section page." }],
            selectionReason: "One page tests the refused unit.",
          }),
          model: "model-a",
        };
      }
      return { rawResponse: JSON.stringify(f.finalDecision), model: "model-a" };
    },
  });

  const tampered = { ...result.receipt, unteachableUnitIdsBefore: ["SU1"] };
  const problems = syllabusCoverageRecoveryReceiptProblems({
    receipt: tampered,
    sources: f.sources,
    anchors: f.anchors,
    coverage: result.coverage,
    expectedSourceSetHash: H1,
    expectedSourceArtifactInventoryHash: H2,
  });
  assert.ok(problems.some((problem) => /refused-unit list does not match/.test(problem)));
});

test("a whole-module source set stays selectable within the transport cap", () => {
  // telecom-1 M1 (2026-09-21): 11 course documents plus five textbooks carry
  // ~4300 canonical page identities. The old 2000 ceiling failed recovery
  // closed before the selector saw anything, even though the same catalog at
  // zero excerpt is far inside the character cap that actually bounds the
  // request.
  const identities = 4_300;
  assert.ok(
    SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_ENTRIES >= identities,
    `entry cap ${SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_ENTRIES} must admit a whole-module course`,
  );
  // ["pNNNN", sourceIndex, pageNumber, ""] is ~20 characters with no excerpt.
  const bytesAtZeroExcerpt = SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_ENTRIES * 20;
  assert.ok(
    bytesAtZeroExcerpt < SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_CHARS,
    "the entry cap must stay inside the character cap that bounds the transport",
  );
});

test("catalog sizing measures the transmitted payload, not the canonical entry", async () => {
  // A canonical entry carries a full source slug, title and 64-char digest for
  // validation; none of that is transmitted. Sizing the canonical form against
  // the transport cap failed a whole-module course closed even though its real
  // request was an order of magnitude inside the limit.
  const src = await import("../src/lib/learn-syllabus-coverage-recovery.ts");
  const text = readFileSync(
    new URL("../src/lib/learn-syllabus-coverage-recovery.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    text,
    /const catalogChars[\s\S]{0,400}?JSON\.stringify\(recoveryCatalogTransport\(catalog\)\)\.length/,
    "catalogChars must size the transport projection",
  );
  assert.ok(src.SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_CHARS >= 500_000);
});

test("a recovered unit keeps the assigned work its refused record already named", () => {
  // The telecom-1 shape, 2026-09-21: one textbook (R1) is assigned to several
  // units, so it is not exclusive to the refused unit and keeps its initial
  // resolution. The rereview judged SU2 from recovered lecture-deck pages and
  // named only the deck, leaving the merged decision with a unit that cites no
  // source selected for its available assigned material.
  const COUCH = "couch-digital-and-analog-communication-systems";
  const DECK = "5xta0-m1-sr-digitalmodulationformats-introduction-baseband";
  const syllabusPlan = {
    courseTitle: "5XTA0",
    referencedMaterials: [{ id: "R1", citation: "L. W. Couch, Digital and Analog Communication Systems, 8th ed.", title: "Digital and Analog Communication Systems", authors: ["L. W. Couch"], kind: "textbook", required: true }],
    units: [
      { id: "SU1", label: "M1.a.i.1", title: "Baseband binary modulation", objectives: [], topics: [], questionReferences: [], materialIds: ["R1"] },
      { id: "SU2", label: "M1.a.i.2", title: "Baseband multilevel modulation", objectives: [], topics: [], questionReferences: [], materialIds: ["R1"] },
    ],
  };
  const resolutions = [{ materialId: "R1", citation: syllabusPlan.referencedMaterials[0].citation, status: "available", sourceIds: [COUCH], matchReason: "Canonical pages identify the eighth edition." }];
  const initial = {
    resolutions,
    units: [
      { unitId: "SU1", availableSourceIds: [COUCH, DECK], missingCitations: [], teachable: true, coverageReason: "Couch plus the deck establish binary baseband signalling." },
      // A refused unit may retain partial supporting source ids.
      { unitId: "SU2", availableSourceIds: [COUCH, DECK], missingCitations: [], teachable: false, coverageReason: "The bounded evidence did not establish the multilevel PAM treatment." },
    ],
  };
  const rereview = {
    resolutions,
    units: [
      { unitId: "SU1", availableSourceIds: [], missingCitations: [], teachable: false, coverageReason: "No recovered page covers this unit." },
      { unitId: "SU2", availableSourceIds: [DECK], missingCitations: [], teachable: true, coverageReason: "Recovered deck page establishes multi-level PAM." },
    ],
  };

  const merged = mergeSyllabusCoverageRecoveryDecision({ syllabusPlan, initial, rereview, targetUnitIds: ["SU2"] });

  assert.deepEqual(syllabusCoverageDecisionProblems(merged, syllabusPlan, [COUCH, DECK]), []);
  const su1 = merged.units.find((unit) => unit.unitId === "SU1");
  const su2 = merged.units.find((unit) => unit.unitId === "SU2");
  assert.equal(su1.teachable, true, "the untargeted unit is not stripped by a rereview with no pages for it");
  assert.equal(su2.teachable, true, "the targeted unit takes the recovered verdict");
  assert.ok(su2.availableSourceIds.includes(DECK), "the recovered source is kept");
  assert.ok(su2.availableSourceIds.includes(COUCH), "the assigned work it already named is kept");
  assert.equal(new Set(su2.availableSourceIds).size, su2.availableSourceIds.length, "no duplicates");
});
