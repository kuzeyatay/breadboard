import assert from "node:assert/strict";
import test from "node:test";

await import("../scripts/learn-worker-import-hook.mjs");
const { buildSyllabusCoverageSourceCatalog } = await import("../src/lib/learn-syllabus.ts");

// telecom-1 M3 (2026-10-16): seventeen sources cut every unpaged slide deck to
// 2k characters, so GE.3's subnet and CIDR slides never reached the coverage
// review, and the recovery rereview can only select paged sources.
test("an unpaged slide deck reaches syllabus coverage complete among many sources", () => {
  const deck = (n) => `## Slide ${n}\n\n${"IP forwarding detail. ".repeat(40)}\n\n`;
  const ge3 = `${Array.from({ length: 18 }, (_, i) => deck(i + 1)).join("")}## Classless InterDomain Routing\n\nCIDR prefix aggregation.\n`;
  const sources = [
    { slug: "ge-3", title: "GE.3", relPath: "sources/ge-3.md", body: ge3 },
    ...Array.from({ length: 16 }, (_, i) => ({
      slug: `deck-${i}`, title: `Deck ${i}`, relPath: `sources/deck-${i}.md`, body: deck(i).repeat(8),
    })),
  ];
  assert.ok(ge3.length > 2_000 && ge3.length < 24_000);
  const catalog = buildSyllabusCoverageSourceCatalog(sources);
  const evidence = catalog.find((entry) => entry.id === "ge-3").canonicalRawPageEvidence.unpagedEvidence;
  assert.equal(evidence.complete, true);
  assert.match(evidence.exactText, /Classless InterDomain Routing/);
});
