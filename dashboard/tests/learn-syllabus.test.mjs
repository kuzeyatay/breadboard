import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  excludeSyllabusFromSources,
  persistedLearnSelection,
  selectLearnSources,
  selectLearnSyllabus,
  sourceSetHashForSources,
  sourceSetHashWithSyllabus,
} from "../src/lib/learn-utils.ts";

const learnSource = fs.readFileSync(
  new URL("../src/lib/learn.ts", import.meta.url),
  "utf8",
);
const learnStatusProjectionSource = fs.readFileSync(
  new URL("../src/lib/learn-status-projection.ts", import.meta.url),
  "utf8",
);
const workspaceSource = fs.readFileSync(
  new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
  "utf8",
);
const viewportPopoverSource = fs.readFileSync(
  new URL("../src/app/components/viewport-popover.tsx", import.meta.url),
  "utf8",
);
const planRouteSource = fs.readFileSync(
  new URL("../src/app/api/gardens/[gardenId]/learn/plan/route.ts", import.meta.url),
  "utf8",
);
const rebuildRouteSource = fs.readFileSync(
  new URL("../src/app/api/gardens/[gardenId]/learn/rebuild/route.ts", import.meta.url),
  "utf8",
);

/** Count regex hits without letting a failure dump the whole 8k-line file. */
function countMatches(haystack, pattern) {
  return (haystack.match(pattern) ?? []).length;
}

function sourceDoc(slug, body = `Body of ${slug}`) {
  return {
    id: slug,
    slug,
    title: slug.replace(/-/g, " "),
    relPath: `sources/${slug}.md`,
    body,
  };
}

describe("Learn syllabus selection", () => {
  const documents = [
    sourceDoc("course-syllabus", "Week 1: forces. Week 2: energy."),
    sourceDoc("lecture-1"),
    sourceDoc("lecture-2"),
  ];

  test("no syllabus id leaves the run untouched", () => {
    assert.equal(selectLearnSyllabus(documents, undefined), null);
    assert.equal(selectLearnSyllabus(documents, null), null);
    assert.equal(selectLearnSyllabus(documents, "  "), null);
    assert.deepEqual(excludeSyllabusFromSources(documents, null), documents);
  });

  test("resolves the designated study guide by slug", () => {
    const syllabus = selectLearnSyllabus(documents, "course-syllabus");
    assert.equal(syllabus?.slug, "course-syllabus");
    assert.equal(syllabus?.body, "Week 1: forces. Week 2: energy.");
  });

  test("a deleted syllabus fails loudly instead of silently planning without it", () => {
    assert.throws(
      () => selectLearnSyllabus(documents, "removed-guide"),
      /no longer available: removed-guide/,
    );
  });

  test("the syllabus resolves even when it is not one of the selected documents", () => {
    // A study guide can steer a run without being taught as source material.
    const selected = selectLearnSources(documents, ["lecture-1", "lecture-2"]);
    const syllabus = selectLearnSyllabus(documents, "course-syllabus");
    assert.equal(syllabus?.slug, "course-syllabus");
    assert.deepEqual(
      excludeSyllabusFromSources(selected, syllabus).map((s) => s.slug),
      ["lecture-1", "lecture-2"],
    );
  });

  test("the syllabus is dropped from the teaching sources when it is also selected", () => {
    const selected = selectLearnSources(documents, [
      "course-syllabus",
      "lecture-1",
    ]);
    const syllabus = selectLearnSyllabus(documents, "course-syllabus");
    assert.deepEqual(
      excludeSyllabusFromSources(selected, syllabus).map((s) => s.slug),
      ["lecture-1"],
    );
  });

  test("persisted selection fields come from one newest workflow owner", () => {
    const proposedCoverage = { owner: "proposed" };
    const confirmedCoverage = { owner: "confirmed" };

    assert.deepEqual(
      persistedLearnSelection(
        { sourceIds: ["current-source"], syllabusSourceId: null },
        {
          sourceIds: ["proposed-source"],
          syllabusSourceId: "proposed-guide",
          syllabusCoverage: proposedCoverage,
        },
        {
          sourceIds: ["confirmed-source"],
          syllabusSourceId: "confirmed-guide",
          syllabusCoverage: confirmedCoverage,
        },
      ),
      {
        sourceIds: ["current-source"],
        syllabusSourceId: null,
        syllabusCoverage: null,
      },
    );

    assert.deepEqual(
      persistedLearnSelection(
        {
          sourceIds: ["current-source"],
          syllabusSourceId: "current-guide",
        },
        {
          sourceIds: ["proposed-source"],
          syllabusSourceId: "proposed-guide",
          syllabusCoverage: proposedCoverage,
        },
        null,
      ),
      {
        sourceIds: ["current-source"],
        syllabusSourceId: "current-guide",
        syllabusCoverage: null,
      },
    );

    assert.deepEqual(
      persistedLearnSelection(
        null,
        {
          sourceIds: ["proposed-source"],
          syllabusSourceId: " proposed-guide ",
          syllabusCoverage: proposedCoverage,
        },
        {
          sourceIds: ["confirmed-source"],
          syllabusSourceId: "confirmed-guide",
          syllabusCoverage: confirmedCoverage,
        },
      ),
      {
        sourceIds: ["proposed-source"],
        syllabusSourceId: "proposed-guide",
        syllabusCoverage: proposedCoverage,
      },
    );

    assert.deepEqual(
      persistedLearnSelection(null, null, {
        sourceIds: ["confirmed-source"],
        syllabusSourceId: "confirmed-guide",
        syllabusCoverage: confirmedCoverage,
      }),
      {
        sourceIds: ["confirmed-source"],
        syllabusSourceId: "confirmed-guide",
        syllabusCoverage: confirmedCoverage,
      },
    );
    assert.equal(persistedLearnSelection(null, null, null), null);
  });

  test("an exact job-bound map supplies coverage without taking selection ownership", () => {
    const exactCoverage = { owner: "exact-job-map" };
    const currentJob = {
      status: "awaiting_confirmation",
      proposedLearningMapId: "map-current",
      sourceIds: ["source-a", "source-b"],
      syllabusSourceId: "guide-current",
    };
    const currentMap = {
      id: "map-current",
      sourceIds: ["source-a", "source-b"],
      syllabusSourceId: "guide-current",
      syllabusCoverage: exactCoverage,
    };

    assert.deepEqual(
      persistedLearnSelection(currentJob, currentMap, {
        id: "map-older",
        sourceIds: ["source-older"],
        syllabusSourceId: "guide-older",
        syllabusCoverage: { owner: "older-confirmed" },
      }),
      {
        sourceIds: ["source-a", "source-b"],
        syllabusSourceId: "guide-current",
        syllabusCoverage: exactCoverage,
      },
    );

    assert.deepEqual(
      persistedLearnSelection(
        {
          ...currentJob,
          status: "complete",
          proposedLearningMapId: undefined,
          confirmedLearningMapId: "map-current",
        },
        currentMap,
        null,
      ),
      {
        sourceIds: ["source-a", "source-b"],
        syllabusSourceId: "guide-current",
        syllabusCoverage: exactCoverage,
      },
    );
  });

  test("mismatched, failed, or missing job maps mask coverage instead of borrowing it", () => {
    const job = {
      status: "awaiting_confirmation",
      proposedLearningMapId: "map-current",
      sourceIds: ["source-a", "source-b"],
      syllabusSourceId: "guide-current",
    };
    const map = {
      id: "map-current",
      sourceIds: ["source-a", "source-b"],
      syllabusSourceId: "guide-current",
      syllabusCoverage: { owner: "candidate" },
    };
    const olderConfirmed = {
      id: "map-older",
      sourceIds: ["source-older"],
      syllabusSourceId: "guide-older",
      syllabusCoverage: { owner: "older-confirmed" },
    };
    const cases = [
      ["map id", job, { ...map, id: "map-other" }],
      ["source order", job, { ...map, sourceIds: ["source-b", "source-a"] }],
      ["syllabus", job, { ...map, syllabusSourceId: "guide-other" }],
      ["failed job", { ...job, status: "failed" }, map],
      ["no proposal", job, null],
    ];

    for (const [label, candidateJob, candidateMap] of cases) {
      assert.deepEqual(
        persistedLearnSelection(candidateJob, candidateMap, olderConfirmed),
        {
          sourceIds: ["source-a", "source-b"],
          syllabusSourceId: "guide-current",
          syllabusCoverage: null,
        },
        label,
      );
    }
  });
});

describe("Learn syllabus source-set hash", () => {
  const sources = [sourceDoc("lecture-1"), sourceDoc("lecture-2")];
  const base = sourceSetHashForSources(sources);

  test("a run without a syllabus keeps its existing hash", () => {
    // Existing gardens must not be reported as changed just because the
    // syllabus feature exists.
    assert.equal(sourceSetHashWithSyllabus(base, null), base);
  });

  test("designating a syllabus changes the hash", () => {
    const syllabus = sourceDoc("course-syllabus", "Week 1: forces.");
    assert.notEqual(sourceSetHashWithSyllabus(base, syllabus), base);
  });

  test("editing the syllabus body changes the hash", () => {
    const before = sourceSetHashWithSyllabus(
      base,
      sourceDoc("course-syllabus", "Week 1: forces."),
    );
    const after = sourceSetHashWithSyllabus(
      base,
      sourceDoc("course-syllabus", "Week 1: forces. Week 2: energy."),
    );
    assert.notEqual(before, after);
  });

  test("editing prompt-visible syllabus metadata changes the hash", () => {
    const baseline = sourceDoc("course-syllabus", "Week 1: forces.");
    const renamed = { ...baseline, title: "Renamed course guide" };
    const described = { ...baseline, description: "Updated course scope" };
    const moved = {
      ...baseline,
      relPath: "sources/moved-course-syllabus.md",
      sourceFile: "moved-course-syllabus.pdf",
    };
    const before = sourceSetHashWithSyllabus(base, baseline);
    assert.notEqual(sourceSetHashWithSyllabus(base, renamed), before);
    assert.notEqual(sourceSetHashWithSyllabus(base, described), before);
    assert.notEqual(sourceSetHashWithSyllabus(base, moved), before);
  });

  test("swapping which document is the syllabus changes the hash", () => {
    const body = "Week 1: forces.";
    assert.notEqual(
      sourceSetHashWithSyllabus(base, sourceDoc("guide-a", body)),
      sourceSetHashWithSyllabus(base, sourceDoc("guide-b", body)),
    );
  });
});

describe("Learn pipeline wiring", () => {
  test("the syllabus is split out of the teaching sources in the one shared context builder", () => {
    assert.match(learnSource, /const syllabus = selectLearnSyllabus\(availableSources, syllabusSourceId\)/);
    assert.match(learnSource, /const sources = excludeSyllabusFromSources\(selectedSources, syllabus\)/);
    assert.match(learnSource, /sourceSetHashWithSyllabus\(/);
  });

  test("a syllabus-only selection is refused with an actionable message", () => {
    assert.match(learnSource, /is set as the syllabus, so it is not taught as source material/);
  });

  test("syllabus-derived concepts do not re-enter when no explicit selection was made", () => {
    assert.match(learnSource, /node\.sourceDocument !== syllabus\?\.slug/);
  });

  test("the full selection is persisted so a confirmed run reproduces the same split", () => {
    // Planning's job, stored map, and both generation paths must persist the
    // user's whole selection — persisting only the teaching sources would drop
    // the syllabus from the set the next run resolves against.
    const persistedSelections = countMatches(
      learnSource,
      /sourceIds: context\.selectedSourceIds/g,
    );
    assert.equal(
      persistedSelections,
      4,
      `expected 4 persisted selections (planning job, stored map, and both generation paths), found ${persistedSelections}`,
    );
    const persistedSyllabi = countMatches(
      learnSource,
      /syllabusSourceId: context\.syllabus\?\.slug/g,
    );
    assert.equal(
      persistedSyllabi,
      4,
      `expected the syllabus persisted alongside each selection, found ${persistedSyllabi}`,
    );
  });

  test("a syllabus rebind guards every prompt-visible syllabus identity field", () => {
    assert.match(
      learnSource,
      /const syllabusIdentity = \(context: LearnSourceContext\) => \{[\s\S]*?title: syllabus\.title \?\? ""[\s\S]*?description: syllabus\.description \?\? ""[\s\S]*?relPath: syllabus\.relPath[\s\S]*?sourceFile: syllabus\.sourceFile \?\? ""/,
    );
  });

  test("page generation re-reads the syllabus the confirmed map was planned against", () => {
    assert.match(
      learnSource,
      /map\.sourceIds\.length > 0 \? map\.sourceIds : undefined,\s*map\.syllabusSourceId,/,
    );
    assert.match(learnSource, /syllabus: context\.syllabus,/);
  });

  test("both learn tables carry the syllabus and migrate existing databases", () => {
    assert.match(learnSource, /syllabus_source_id\s+TEXT/);
    assert.match(
      learnSource,
      /ALTER TABLE learn_jobs ADD COLUMN syllabus_source_id TEXT/,
    );
    assert.match(
      learnSource,
      /ALTER TABLE learn_maps ADD COLUMN syllabus_source_id TEXT/,
    );
  });

  test("rolling back a run restores its document selection and syllabus", () => {
    assert.match(learnSource, /row\.source_ids_json \?\? "\[\]"/);
    assert.match(learnSource, /row\.syllabus_source_id \?\? null/);
  });
});

describe("Learn syllabus prompting", () => {
  test("syllabus rules are appended only when a syllabus is present", () => {
    assert.match(learnSource, /function withSyllabusRules\(/);
    assert.match(learnSource, /return hasSyllabus \? `\$\{basePrompt\}\\n\$\{rules\}` : basePrompt;/);
  });

  test("every planning stage receives the syllabus", () => {
    assert.match(
      learnSource,
      /withSyllabusRules\(SOURCE_MAP_PROMPT, SYLLABUS_PLANNING_RULES, hasSyllabus\)/,
    );
    assert.match(
      learnSource,
      /withSyllabusRules\(SCOPE_CONTRACT_PROMPT, SYLLABUS_PLANNING_RULES, hasSyllabus\)/,
    );
    assert.match(
      learnSource,
      /withSyllabusRules\(TOPIC_MAP_PROMPT, SYLLABUS_PLANNING_RULES, hasSyllabus\)/,
    );
    assert.match(learnSource, /syllabus: syllabusPayload,/);
  });

  test("the syllabus steers scope but never becomes a lesson topic", () => {
    const rules = SYLLABUS_RULES_TEXT();
    assert.match(rules, /never write a page about the syllabus/i);
    assert.match(rules, /never invent a substitute for it/);
    assert.match(
      learnSource,
      /Never mention, quote, cite, or describe the syllabus in the lesson/,
    );
  });

  test("a syllabus topic with no material is left uncovered, not filled in", () => {
    const rules = SYLLABUS_RULES_TEXT();
    assert.match(rules, /only as far as that material genuinely supports/);
    assert.match(rules, /leave the topic uncovered and record it in warnings/);
    assert.match(rules, /Do not create learning units for them/);
  });

  test("page writing gets the syllabus as orientation only", () => {
    assert.match(
      learnSource,
      /withSyllabusRules\(\s*SUBSECTION_PROMPT,\s*SYLLABUS_PAGE_RULES,/,
    );
    assert.match(learnSource, /outline: truncate\(syllabus\.body, MAX_SYLLABUS_DOSSIER_CHARS\)/);
  });
});

/** The planning rules block, isolated so assertions read against just that text. */
function SYLLABUS_RULES_TEXT() {
  const match = learnSource.match(
    /const SYLLABUS_PLANNING_RULES = `([\s\S]*?)`;/,
  );
  assert.ok(match, "SYLLABUS_PLANNING_RULES should be defined");
  return match[1];
}

describe("Learn syllabus API surface", () => {
  test("plan and rebuild accept a syllabus id", () => {
    for (const [name, source] of [
      ["plan", planRouteSource],
      ["rebuild", rebuildRouteSource],
    ]) {
      assert.match(
        source,
        /parseExplicitLearnPlanSelection\(body\)|typeof body\.syllabusSourceId === "string" && body\.syllabusSourceId\.trim\(\)/,
        `${name} route should parse syllabusSourceId`,
      );
      assert.match(source, /syllabusSourceId/, `${name} route should forward it`);
    }
  });

  test("the status snapshot reports the syllabus and drops a deleted one", () => {
    assert.match(learnSource, /syllabusSourceId: string \| null;/);
    assert.match(
      learnStatusProjectionSource,
      /const latestJobBoundMapId =[\s\S]*?latestJob\?\.proposedLearningMapId \?\? latestJob\?\.confirmedLearningMapId[\s\S]*?const selection = persistedLearnSelection\(\s*latestJob,\s*latestJob \? latestJobBoundMap : contractProposed,\s*confirmedMap,/,
    );
    assert.match(
      learnStatusProjectionSource,
      /const coverage = selection\?\.syllabusCoverage \?\? null;[\s\S]*?const syllabusCoverage =\s*syllabusSourceId && coverage/,
    );
  });
});

describe("Learn panel syllabus controls", () => {
  test("the menus escape the Learn tray's scrolling boundary", () => {
    assert.equal(countMatches(workspaceSource, /<ViewportPopover/g), 3);
    assert.match(viewportPopoverSource, /createPortal\(/);
    assert.match(viewportPopoverSource, /window\.addEventListener\("scroll", place, true\)/);
  });

  test("the panel offers picking an existing document or uploading one", () => {
    assert.match(workspaceSource, /Syllabus for Learn/);
    assert.match(workspaceSource, /name="learn-syllabus"/);
    assert.match(workspaceSource, /No syllabus/);
    assert.match(workspaceSource, /Upload a syllabus/);
    assert.match(workspaceSource, /handleSyllabusUpload/);
  });

  test("an uploaded syllabus reuses the ingest pipeline without map generation", () => {
    assert.match(
      workspaceSource,
      /formData\.append\("sourceLabel", "Syllabus"\)[\s\S]{0,200}formData\.append\("generateMap", "false"\)/,
    );
    assert.match(workspaceSource, /chooseLearnSyllabusDocument\(slug\)/);
  });

  test("the chosen syllabus is sent with every Learn action", () => {
    assert.match(
      workspaceSource,
      /syllabusSourceId:\s*learnSyllabusSlug/,
    );
  });

  test("the panel sends an explicit selection only after status hydration", () => {
    assert.match(
      workspaceSource,
      /includedSourceIds:\s*\([\s\S]*?learnIncludedSourceSlugs \?\?[\s\S]*?document\.type === "source-document"[\s\S]*?sourceSlug !== learnSyllabusSlug/,
    );
    assert.match(workspaceSource, /syllabusSourceId: learnSyllabusSlug/);
    assert.match(
      workspaceSource,
      /const learnSelectionHydrated =[\s\S]*?lastSyncedLearnSelectionRef\.current[\s\S]*?lastSyncedLearnSyllabusRef\.current/,
    );
    assert.match(
      workspaceSource,
      /const canStart =[\s\S]*?learnSelectionHydrated[\s\S]*?hasSelectedLearnSources/,
    );
  });

  test("the syllabus does not count as material to teach from", () => {
    assert.match(
      workspaceSource,
      /learnEligibleSourceDocuments = sourceDocuments\.filter\(/,
    );
    assert.match(
      workspaceSource,
      /Sources \{learnTeachingSourceSlugs\.length\}\/\s*\{learnEligibleSourceDocuments\.length\}/,
    );
    assert.match(
      workspaceSource,
      /Used as syllabus — not teaching material/,
    );
    assert.match(
      workspaceSource,
      /Select at least one teaching document before starting Learn/,
    );
  });

  test("choosing a syllabus removes it from the teaching selection", () => {
    assert.match(
      workspaceSource,
      /function chooseLearnSyllabusDocument\(sourceSlug: string \| null\)/,
    );
    assert.match(
      workspaceSource,
      /if \(previousSyllabusSlug\) selected\.add\(previousSyllabusSlug\)/,
    );
    assert.match(
      workspaceSource,
      /if \(sourceSlug\) selected\.delete\(sourceSlug\)/,
    );
    assert.match(
      workspaceSource,
      /learnDocumentSelectionLocked \|\| isSyllabus/,
    );
  });

  test("a deleted syllabus reverts to none instead of blocking the run", () => {
    assert.match(
      workspaceSource,
      /current && !availableSourceSlugs\.has\(current\) \? null : current/,
    );
  });
});
