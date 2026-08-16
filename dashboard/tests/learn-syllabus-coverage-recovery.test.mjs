import test from "node:test";
import assert from "node:assert/strict";

import {
  runSyllabusCoverageEvidenceRecovery,
  syllabusCoverageRecoveryReceiptProblems,
} from "../src/lib/learn-syllabus-coverage-recovery.ts";
import { modelSourcePageAnchors } from "../src/lib/model-source-anchor-ledger.ts";

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);

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
        const page = payload.pageCatalog.find((entry) => entry.pageNumber === 19);
        assert.equal(page.sourceId, "book");
        return {
          rawResponse: JSON.stringify({
            selectedPages: [{
              anchorId: page.anchorId,
              sourceId: page.sourceId,
              pageNumber: page.pageNumber,
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
        const page = JSON.parse(request.user).pageCatalog.find((entry) => entry.pageNumber === 19);
        return { rawResponse: JSON.stringify({
          selectedPages: [{
            anchorId: page.anchorId,
            sourceId: page.sourceId,
            pageNumber: page.pageNumber,
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
        const page = JSON.parse(request.user).pageCatalog.find((entry) => entry.pageNumber === 19);
        return { rawResponse: JSON.stringify({
          selectedPages: [{ ...page, selectionReason: "Test the only substantive page." }]
            .map(({ anchorId, sourceId, pageNumber, selectionReason }) => ({
              anchorId, sourceId, pageNumber, selectionReason,
            })),
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

test("an already-teachable decision never consumes a recovery provider call", async () => {
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
    /may run only after a valid zero-teachable coverage decision/,
  );
  assert.equal(calls, 0);
});

test("selector identity mismatch fails after one semantic candidate and makes no rereview call", async () => {
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
            anchorId: "text-book-page-19",
            sourceId: "wrong-source",
            pageNumber: 19,
            selectionReason: "Wrong binding.",
          }],
          selectionReason: "Wrong binding.",
        }) };
      },
    }),
    /single bounded model candidate.*sourceId does not match/,
  );
  assert.equal(calls, 1);
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
        const page = JSON.parse(request.user).pageCatalog.find((entry) => entry.pageNumber === 19);
        return { rawResponse: JSON.stringify({
          selectedPages: [{
            anchorId: page.anchorId,
            sourceId: page.sourceId,
            pageNumber: page.pageNumber,
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
        assert.equal(catalog.some((entry) => entry.pageNumber === 999), false);
        const page = catalog.find((entry) => entry.pageNumber === 19);
        return { rawResponse: JSON.stringify({
          selectedPages: [{
            anchorId: page.anchorId,
            sourceId: page.sourceId,
            pageNumber: page.pageNumber,
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
        assert.equal(catalog.some((entry) => entry.pageNumber === 20), false);
        assert.equal(catalog.some((entry) => entry.pageNumber === 21), false);
        assert.equal(catalog.some((entry) => entry.pageNumber === 22), true);
        const page = catalog.find((entry) => entry.pageNumber === 19);
        return { rawResponse: JSON.stringify({
          selectedPages: [{
            anchorId: page.anchorId,
            sourceId: page.sourceId,
            pageNumber: page.pageNumber,
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
