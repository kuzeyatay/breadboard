import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseGeneratedSyllabus,
  renderSyllabusMarkdown,
  syllabusDraftMessages,
} from "../src/lib/learn-syllabus-authoring.ts";

const workspaceSource = fs.readFileSync(
  new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
  "utf8",
);
const generateRouteSource = fs.readFileSync(
  new URL(
    "../src/app/api/gardens/[gardenId]/learn/syllabus/generate/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const authoringSource = fs.readFileSync(
  new URL("../src/lib/learn-syllabus-authoring.ts", import.meta.url),
  "utf8",
);

function draft(overrides = {}) {
  return JSON.stringify({
    courseTitle: "Introduction to Electronics",
    overview: "Circuits from first principles.",
    audience: "Learners with no prior electronics background.",
    units: [
      {
        label: "Unit 1",
        title: "Charge, current, and voltage",
        objectives: ["Define current as charge per unit time"],
        topics: ["Charge", "Current", "Voltage"],
      },
    ],
    ...overrides,
  });
}

describe("Generated syllabus parsing", () => {
  test("a well-formed draft becomes a syllabus", () => {
    const syllabus = parseGeneratedSyllabus(draft());
    assert.equal(syllabus.courseTitle, "Introduction to Electronics");
    assert.equal(syllabus.overview, "Circuits from first principles.");
    assert.equal(syllabus.units.length, 1);
    assert.deepEqual(syllabus.units[0].topics, ["Charge", "Current", "Voltage"]);
  });

  test("code fences and surrounding prose do not defeat the parse", () => {
    const syllabus = parseGeneratedSyllabus(
      `Here you go:\n\`\`\`json\n${draft()}\n\`\`\`\nHope that helps.`,
    );
    assert.equal(syllabus.units[0].title, "Charge, current, and voltage");
  });

  test("a unit that teaches nothing is dropped rather than kept", () => {
    const syllabus = parseGeneratedSyllabus(
      draft({
        units: [
          { label: "Unit 1", title: "Real unit", topics: ["Ohm's law"] },
          { label: "Unit 2", title: "Empty unit", objectives: [], topics: [] },
          { label: "Unit 3", objectives: ["Untitled units teach nothing"] },
        ],
      }),
    );
    assert.equal(syllabus.units.length, 1);
    assert.equal(syllabus.units[0].title, "Real unit");
  });

  test("unusable responses return null instead of an empty syllabus", () => {
    assert.equal(parseGeneratedSyllabus(""), null);
    assert.equal(parseGeneratedSyllabus("I could not write that."), null);
    assert.equal(parseGeneratedSyllabus("{not json"), null);
    assert.equal(parseGeneratedSyllabus(draft({ units: [] })), null);
  });

  test("a missing label still numbers the unit", () => {
    const syllabus = parseGeneratedSyllabus(
      draft({ units: [{ title: "Unlabeled", topics: ["Something"] }] }),
    );
    assert.equal(syllabus.units[0].label, "Unit 1");
  });

  test("runaway output is capped and de-duplicated", () => {
    const syllabus = parseGeneratedSyllabus(
      draft({
        units: Array.from({ length: 40 }, (_, index) => ({
          label: `Unit ${index + 1}`,
          title: `Unit ${index + 1}`,
          objectives: Array.from({ length: 20 }, (_, n) => `Objective ${n}`),
          topics: ["Ohm's law", "ohm's law", "OHM'S LAW", "Kirchhoff"],
        })),
      }),
    );
    assert.ok(syllabus.units.length <= 16);
    assert.ok(syllabus.units[0].objectives.length <= 6);
    // Casing differences are the same topic, so only one survives.
    assert.deepEqual(syllabus.units[0].topics, ["Ohm's law", "Kirchhoff"]);
  });
});

describe("Generated syllabus markdown", () => {
  test("renders a course outline the reading stage can parse back", () => {
    const markdown = renderSyllabusMarkdown(parseGeneratedSyllabus(draft()));
    assert.match(markdown, /^# Introduction to Electronics$/m);
    assert.match(markdown, /^## Course outline$/m);
    assert.match(markdown, /^### Unit 1 — Charge, current, and voltage$/m);
    assert.match(markdown, /\*\*Learning objectives\*\*/);
    assert.match(markdown, /^- Define current as charge per unit time$/m);
    assert.match(markdown, /\*\*Topics covered\*\*/);
  });

  test("nothing in the rendered syllabus assigns a reading", () => {
    const markdown = renderSyllabusMarkdown(parseGeneratedSyllabus(draft()));
    assert.doesNotMatch(markdown, /Readings|Bibliography|Textbook|References/i);
  });
});

describe("Generated syllabus prompting", () => {
  test("the course is planned over the material the garden actually holds", () => {
    const [, user] = syllabusDraftMessages("everything introductory about electronics", [
      { title: "Op-amp lab notes", description: "Inverting and non-inverting" },
      { title: "Semiconductor physics slides" },
    ]);
    assert.match(user.content, /everything introductory about electronics/);
    assert.match(user.content, /- Op-amp lab notes — Inverting and non-inverting/);
    assert.match(user.content, /- Semiconductor physics slides/);
  });

  test("an empty garden still gets a syllabus, planned from the request alone", () => {
    const [, user] = syllabusDraftMessages("learn electronics", []);
    assert.match(user.content, /no uploaded material yet/);
  });

  /**
   * The load-bearing rule: every citation a syllabus makes becomes a
   * `missingCitation` unless a garden document matches it, and missing
   * citations suppress lesson content. A generated syllabus that invented its
   * own reading list would block the course it just asked for.
   */
  test("the model is forbidden from assigning readings", () => {
    const [system] = syllabusDraftMessages("learn electronics");
    assert.match(system.content, /Never assign readings/);
    assert.match(system.content, /Do not name a textbook, paper, author/);
  });
});

describe("Generated syllabus API surface", () => {
  test("the route is owner-gated and writes into the caller's own garden", () => {
    assert.match(generateRouteSource, /requireOwnedClusterFromSlug\(gardenId\)/);
    assert.match(generateRouteSource, /clusterSlug: cluster\.slug/);
  });

  test("an empty prompt is rejected before any model call", () => {
    assert.match(generateRouteSource, /if \(!prompt\)[\s\S]{0,160}status: 400/);
    assert.ok(
      generateRouteSource.indexOf("status: 400") <
        generateRouteSource.indexOf("createChatmockClient("),
      "the 400 must be returned before the model client is built",
    );
  });

  test("the syllabus lands as a source document with no concept extraction", () => {
    assert.match(generateRouteSource, /writeDocumentKnowledge\(\{/);
    assert.match(generateRouteSource, /sourceLabel: "Syllabus"/);
    assert.match(generateRouteSource, /topics: \[\],\s*relationships: \[\],/);
  });

  test("an unavailable or unreadable model fails loudly instead of writing junk", () => {
    assert.match(generateRouteSource, /status: 502/);
    assert.match(generateRouteSource, /if \(!syllabus\)/);
  });
});

describe("Learn panel syllabus generation", () => {
  test("the picker offers generating a syllabus beside uploading one", () => {
    assert.match(workspaceSource, /Generate a syllabus/);
    assert.match(workspaceSource, /Upload a syllabus/);
    assert.match(workspaceSource, /Or describe what you want to learn/);
    assert.match(
      workspaceSource,
      /placeholder="I want to learn everything introductory about electronics"/,
    );
  });

  test("a generated syllabus is designated immediately and shows up in Documents", () => {
    const generateStart = workspaceSource.indexOf(
      "async function handleSyllabusGenerate()",
    );
    const generateEnd = workspaceSource.indexOf(
      "function chooseLearnSyllabusDocument",
      generateStart,
    );
    const generate = workspaceSource.slice(generateStart, generateEnd);
    const designate = generate.indexOf("chooseLearnSyllabusDocument(slug)");
    const refreshDocuments = generate.indexOf("await fetchDocuments()");

    assert.ok(generateStart >= 0 && generateEnd > generateStart);
    assert.ok(designate >= 0 && designate < refreshDocuments);
    assert.match(
      workspaceSource.slice(generateEnd),
      /setLearnSyllabusSlug\(sourceSlug\)/,
    );
    assert.match(workspaceSource, /learn\/syllabus\/generate/);
  });

  test("generating is blocked while the Learning Map is locked or a syllabus is uploading", () => {
    assert.match(
      workspaceSource,
      /onClick=\{\(\) => void handleSyllabusGenerate\(\)\}[\s\S]{0,320}learnDocumentSelectionLocked[\s\S]{0,120}learnSyllabusUploading[\s\S]{0,120}!learnSyllabusPrompt\.trim\(\)/,
    );
  });

  test("the authoring library is the only place the prompt shape is defined", () => {
    assert.match(authoringSource, /export function parseGeneratedSyllabus/);
    assert.match(authoringSource, /export function renderSyllabusMarkdown/);
    assert.match(authoringSource, /export function syllabusDraftMessages/);
  });
});
