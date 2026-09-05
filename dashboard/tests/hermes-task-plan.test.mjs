import test from "node:test";
import assert from "node:assert/strict";
import {
  elevateForSuperAgent,
  planTask,
  requiresCodingOutcome,
  requestWithoutSelectors,
} from "../src/lib/hermes/task-plan.ts";

function plan(request, options = {}) {
  return planTask({ request, authenticated: true, ...options });
}

function caps(request, options) {
  return new Set(plan(request, options).requiredCapabilities);
}

/* ------------------------------------------------------------------ */
/* The non-negotiable rule: reading/moving code is not coding          */
/* ------------------------------------------------------------------ */

test("explaining a TypeScript file is a read, not coding", () => {
  const p = plan("Explain what this TypeScript file does: src/lib/auth.ts");
  assert.equal(p.requiresCoding, false);
  assert.ok(p.requiredCapabilities.includes("filesystem_read"));
  assert.ok(!p.requiredCapabilities.includes("coding"));
});

test("searching for importers is read and search, not coding", () => {
  const p = plan("Find every file that imports this module.");
  assert.equal(p.requiresCoding, false);
  assert.ok(p.requiredCapabilities.includes("filesystem_read"));
});

test("running an existing test suite is command execution, not coding", () => {
  const p = plan("Run the existing test suite and explain the failures.");
  assert.equal(p.requiresCoding, false);
  assert.ok(p.requiredCapabilities.includes("command_execution"));
});

test("moving .ts files is a filesystem write, not coding", () => {
  const p = plan("Move these .ts files into an archive folder.");
  assert.equal(p.requiresCoding, false);
  assert.ok(p.requiredCapabilities.includes("filesystem_write"));
  assert.ok(!p.requiredCapabilities.includes("coding"));
});

test("batch renaming images is a filesystem operation, not coding", () => {
  const p = plan("Rename all these images using their creation dates.");
  assert.equal(p.requiresCoding, false);
  assert.ok(p.requiredCapabilities.includes("filesystem_write"));
});

test("renaming a symbol IS coding", () => {
  assert.equal(requiresCodingOutcome("Rename the parseHeader function to readHeader everywhere."), true);
});

/* ------------------------------------------------------------------ */
/* Coding is selected when the outcome is software                     */
/* ------------------------------------------------------------------ */

test("fixing failing tests is coding", () => {
  const p = plan("Fix the failing tests.");
  assert.equal(p.requiresCoding, true);
  assert.ok(p.requiredCapabilities.includes("coding"));
  assert.ok(p.requiredCapabilities.includes("command_execution"));
});

test("adding authentication is coding", () => {
  assert.equal(plan("Add authentication to this application.").requiresCoding, true);
});

test("creating a Python script is coding", () => {
  assert.equal(plan("Create a Python script that cleans this dataset.").requiresCoding, true);
});

test("refactoring a parser is coding", () => {
  assert.equal(plan("Refactor the parser module to use streaming.").requiresCoding, true);
});

/* ------------------------------------------------------------------ */
/* Filesystem outcomes                                                 */
/* ------------------------------------------------------------------ */

test("summarizing Documents is a filesystem read only", () => {
  const c = caps("Summarize the files in my Documents folder.");
  assert.ok(c.has("filesystem_read"));
  assert.ok(!c.has("filesystem_write"));
  assert.ok(!c.has("coding"));
});

test("organizing Downloads is filesystem read and write", () => {
  const c = caps("Organize my Downloads folder by file type.");
  assert.ok(c.has("filesystem_read"));
  assert.ok(c.has("filesystem_write"));
  assert.ok(!c.has("coding"));
});

test("casual whats phrasing still recognizes a Downloads inspection", () => {
  const c = caps("whats the biggest file in my downloads folder?");
  assert.ok(c.has("filesystem_read"));
  assert.ok(!c.has("filesystem_write"));
});

test("common folder-name typos are normalized into grantable aliases", () => {
  const downloads = plan("whats the largest file in my donwloads folder?");
  assert.ok(downloads.requiredCapabilities.includes("filesystem_read"));
  assert.ok(
    downloads.requiredResources.some(
      (resource) =>
        resource.kind === "path" &&
        resource.value === "downloads" &&
        resource.absolute === false,
    ),
  );

  const documents = plan("what is in my docments fodler?");
  assert.ok(
    documents.requiredResources.some(
      (resource) =>
        resource.kind === "path" && resource.value === "documents",
    ),
  );
});

test("deleting duplicates needs confirmation and a destructive capability", () => {
  const p = plan(
    "Delete duplicate files in my Downloads folder after showing me the candidates.",
  );
  assert.ok(p.requiredCapabilities.includes("destructive_filesystem"));
  assert.equal(p.requiresConfirmation, true);
  assert.equal(p.riskLevel, "high");
});

test("a deletion with no identified target is a question, not filesystem work", () => {
  for (const request of [
    "please delete them all",
    "how do I delete a file in Python?",
    "should I delete my Gradle cache?",
  ]) {
    const p = plan(request);
    assert.deepEqual(
      p.requiredCapabilities,
      ["conversation"],
      `${request} must not plan filesystem capability`,
    );
    assert.equal(p.riskLevel, "low", request);
  }

  // The same words plan a deletion once the conversation has identified what
  // they point at.
  const resolved = plan("please delete them all", {
    resolvedResources: [{
      kind: "path",
      value: "C:\\Users\\Public\\wpilib",
      absolute: true,
      resourceType: "directory",
    }],
  });
  assert.ok(resolved.requiredCapabilities.includes("destructive_filesystem"));
  assert.equal(resolved.riskLevel, "high");
});

test("deleting a named media file does not plan media processing or artifact writes", () => {
  const p = plan("Delete the listed files except Demo_Team14.mp4", {
    resolvedResources: [{
      kind: "path",
      value: "C:\\Users\\me\\Downloads\\old-video.mp4",
      absolute: true,
      resourceType: "file",
    }],
  });
  assert.ok(p.requiredCapabilities.includes("filesystem_read"));
  assert.ok(p.requiredCapabilities.includes("destructive_filesystem"));
  assert.ok(!p.requiredCapabilities.includes("media_processing"));
  assert.ok(!p.requiredCapabilities.includes("filesystem_write"));
  assert.ok(!p.requiredCapabilities.includes("subagent"));
});

test("a rearrangement with no identified target is a question, not filesystem work", () => {
  // The turn that exposed this: "group" matched the mutation verb list.
  const reported = plan(
    "year2, course codes are 5ece0 and 5epf0 and it shouldnt be a group thing",
  );
  assert.deepEqual(reported.requiredCapabilities, ["conversation"]);
  assert.equal(reported.riskLevel, "low");

  for (const request of [
    "can you group the options by difficulty?",
    "sort out which elective I should take next semester",
    "should I move to another university?",
    "how do I organize my week around three deadlines?",
  ]) {
    const c = caps(request);
    for (const capability of [
      "filesystem_read",
      "filesystem_write",
      "destructive_filesystem",
    ]) {
      assert.ok(!c.has(capability), `${request} must not plan ${capability}`);
    }
  }

  // The same verbs plan a write as soon as something on disk is in scope.
  assert.ok(
    plan("group the files in my Downloads folder by type")
      .requiredCapabilities.includes("filesystem_write"),
  );
  assert.ok(
    plan("move them into a new folder", {
      resolvedResources: [{
        kind: "path",
        value: "C:\\Users\\me\\Downloads\\report.pdf",
        absolute: true,
        resourceType: "file",
      }],
    }).requiredCapabilities.includes("filesystem_write"),
  );
});

test("creating a folder is not coding", () => {
  const p = plan("Create a folder called Invoices in my Documents folder.");
  assert.equal(p.requiresCoding, false);
  assert.ok(p.requiredCapabilities.includes("filesystem_write"));
});

/* ------------------------------------------------------------------ */
/* Documents, media, web, garden                                       */
/* ------------------------------------------------------------------ */

test("summarizing a PDF is document processing", () => {
  assert.ok(caps("Summarize this PDF report for me.").has("document_processing"));
});

test("converting Markdown to PDF is document processing plus a write", () => {
  const c = caps("Convert these Markdown files to PDFs.");
  assert.ok(c.has("document_processing"));
  assert.ok(c.has("filesystem_write"));
  assert.ok(!c.has("coding"));
});

test("downloading and transcribing a video needs web, media and write", () => {
  const c = caps("Download this video and transcribe it.");
  assert.ok(c.has("web_research"));
  assert.ok(c.has("media_processing"));
  assert.ok(c.has("filesystem_write"));
  assert.ok(c.has("command_execution"));
  assert.ok(!c.has("coding"));
});

test("mapping Garden recordings is media synthesis, not a Windows Videos-folder write", () => {
  const p = plan(
    "in video and audio there are 25 recordings from 2024 to 2025 can you make a table by placing when the lectures are and their contents, like a map of what was taught and when",
  );
  const c = new Set(p.requiredCapabilities);
  assert.ok(!c.has("media_processing"));
  assert.ok(!c.has("filesystem_read"));
  assert.ok(!c.has("filesystem_write"));
  assert.ok(
    !p.requiredResources.some(
      (resource) => resource.kind === "path" && resource.value === "videos",
    ),
  );
});

test("an explicit request to analyze media still selects media processing", () => {
  for (const request of [
    "Summarize this lecture recording.",
    "Analyze the audio and describe the main argument.",
    "Transcribe this video.",
  ]) {
    assert.ok(caps(request).has("media_processing"), request);
  }
});

test("an explicitly named personal Videos folder remains a filesystem target", () => {
  for (const request of [
    "Summarize the recordings in my Videos.",
    "Summarize the recordings in the Videos folder.",
  ]) {
    const p = plan(request);
    assert.ok(p.requiredCapabilities.includes("filesystem_read"), request);
    assert.ok(
      p.requiredResources.some(
        (resource) => resource.kind === "path" && resource.value === "videos",
      ),
      request,
    );
  }
});

test("downloading any URL plans an authorized destination and exact command execution", () => {
  const p = plan("Download https://example.com/releases/archive.unknown to my Downloads folder.");
  const c = new Set(p.requiredCapabilities);
  assert.ok(c.has("web_research"));
  assert.ok(c.has("filesystem_write"));
  assert.ok(c.has("command_execution"));
  assert.ok(p.requiredResources.some((resource) => resource.kind === "url"));
  assert.ok(
    p.requiredResources.some(
      (resource) => resource.kind === "path" && resource.value === "downloads",
    ),
  );
  assert.match(p.intendedOutcome, /download/i);
  assert.match(p.rationale, /exact-command approval/i);
});

test("researching current information is web research", () => {
  assert.ok(caps("Search the web for the latest news on this topic.").has("web_research"));
});

test("a weather question activates live web research without requiring the word current", () => {
  const c = caps("whats the weather in bodrum?");
  assert.ok(c.has("web_research"));
  assert.ok(!c.has("filesystem_read"));
});

test("a relative-date real-world event requires current web evidence", () => {
  for (const request of [
    "is the total solar eclipse viewable from turkey tomorrow",
    "is the total solar eclipse viewable from turjey tomorrow",
    "Is tonight's meteor shower visible from Ankara?",
  ]) {
    assert.ok(caps(request).has("web_research"), request);
  }
  assert.ok(
    !caps("Explain how a total solar eclipse happens.").has("web_research"),
    "a timeless explanation should remain conversational",
  );
});

test("current recommendations activate web research without an explicit browse verb", () => {
  for (const request of [
    "What are the best immersive experiences near Beşiktaş?",
    "Recommend a laptop for video editing.",
    "I'm looking for a good laptop for Blender.",
    "Any recommendations for date ideas in Istanbul?",
    "Where should I eat near Galataport?",
    "Beşiktaş çevresinde neler var?",
    "Bana Beşiktaş'ta bir müze önerir misin?",
    "İstanbul'da gezilecek ilginç yerler var mı?",
  ]) {
    assert.ok(
      caps(request).has("web_research"),
      `${request} should use current external evidence`,
    );
  }
});

test("the exact Turkish recommendation correction inherits only the active recommendation intent", () => {
  const priorRequests = [
    "beşiktaşın orda neler var",
    "yemek ve gezilecek yer",
    "daha ilginç gezilecek yer yok mu ya mesela istanbul modern baya ilginçti",
  ];
  const correction = caps(
    "sanat değil de deneyim, mesela hollanda’da van gogh müzssi vardı",
    { priorRequests },
  );
  assert.ok(correction.has("web_research"));

  const referential = caps("buna benzer başka ne var?", { priorRequests });
  assert.ok(referential.has("web_research"));

  const chained = caps("and another one?", {
    priorRequests: [
      "Recommend an unusual museum in Istanbul.",
      "More like an immersive experience instead.",
    ],
  });
  assert.ok(chained.has("web_research"));
});

test("recommendation wording does not browse for static preferences or stale prior intent", () => {
  for (const request of [
    "I prefer museums to galleries.",
    "Explain what a museum curator does.",
    "What is the best way to learn TypeScript?",
  ]) {
    assert.ok(!caps(request).has("web_research"), request);
  }

  const unrelated = caps("Explain binary trees.", {
    priorRequests: ["Recommend a restaurant near me."],
  });
  assert.ok(!unrelated.has("web_research"));

  const staleReferential = caps("buna benzer başka ne var?", {
    priorRequests: [
      "Recommend a restaurant near me.",
      "Explain binary trees.",
    ],
  });
  assert.ok(!staleReferential.has("web_research"));
});

test("research plus garden write selects both", () => {
  const c = caps("Research this topic and add the findings to my garden.");
  assert.ok(c.has("web_research"));
  assert.ok(c.has("garden_write"));
});

test("emailing a report requires confirmation and an external action", () => {
  const p = plan("Email this report to Alex.");
  assert.ok(p.requiredCapabilities.includes("application_action"));
  assert.equal(p.requiresConfirmation, true);
});

test("referring to a previous message stays conversational", () => {
  const p = plan(
    "What reference number did I give you in my previous message? Reply only with the reference number.",
  );
  assert.deepEqual(p.requiredCapabilities, ["conversation"]);
  assert.equal(p.requiresConfirmation, false);
  assert.equal(p.riskLevel, "low");
});

test("messaging a recipient remains an external action", () => {
  const p = plan("Message the team that the deployment is ready.");
  assert.ok(p.requiredCapabilities.includes("application_action"));
  assert.ok(p.requiredCapabilities.includes("mcp"));
  assert.equal(p.requiresConfirmation, true);
});

/* ------------------------------------------------------------------ */
/* Least privilege and isolation                                       */
/* ------------------------------------------------------------------ */

test("a conversational request gets no action capability", () => {
  const p = plan("What is the difference between AM and FM modulation?");
  assert.deepEqual(p.requiredCapabilities, ["conversation"]);
  assert.equal(p.riskLevel, "low");
});

test("an explicit no-mutation instruction suppresses coding", () => {
  assert.equal(
    plan("Explain the auth module but do not modify any code.").requiresCoding,
    false,
  );
});

test("isolated sessions never receive private capabilities", () => {
  const p = plan("Organize my Downloads folder and fix the failing tests.", {
    authenticated: false,
    isolated: true,
  });
  assert.equal(p.requiresCoding, false);
  for (const forbidden of [
    "filesystem_read",
    "filesystem_write",
    "destructive_filesystem",
    "coding",
    "command_execution",
    "memory",
  ]) {
    assert.ok(!p.requiredCapabilities.includes(forbidden), `${forbidden} must not be granted`);
  }
});

test("slash selectors cannot steer the plan", () => {
  assert.equal(requestWithoutSelectors("/skill:deploy  ship it"), "ship it");
  const p = plan("/mcp:github What is in my Documents folder?");
  assert.equal(p.requiresCoding, false);
});

test("plans expose their goal, outcome, steps and rationale", () => {
  const p = plan("Organize my Downloads folder by file type.");
  assert.ok(p.userGoal.length > 0);
  assert.ok(p.intendedOutcome.length > 0);
  assert.ok(p.steps.length >= 2);
  assert.ok(p.rationale.includes("filesystem"));
  assert.equal(p.planSource, "breadboard_task_planner_v1");
  assert.ok(p.steps.every((s, i) => s.index === i + 1));
});

/* ------------------------------------------------------------------ */
/* Reach is not obligation: super agent widens what a turn may touch,   */
/* never what its answer owes.                                          */
/* ------------------------------------------------------------------ */

test("super agent grants web reach without making the turn owe web evidence", () => {
  const greeting = elevateForSuperAgent(plan("hi"));
  assert.ok(greeting.requiredCapabilities.includes("web_research"));
  assert.equal(greeting.requiresWebEvidence, false);

  // The same elevation over a request that genuinely asked for live facts
  // still carries the obligation, so the guard is narrowed and not removed.
  const live = elevateForSuperAgent(plan("What is the latest news on the merger?"));
  assert.equal(live.requiresWebEvidence, true);
});

test("only a live-information request owes web evidence", () => {
  assert.equal(plan("hi").requiresWebEvidence, false);
  assert.equal(plan("Thanks, that worked.").requiresWebEvidence, false);
  assert.equal(plan("What is the current weather in Ankara?").requiresWebEvidence, true);

  // A download asks for a file, not for facts. Its step legitimately holds
  // web_research reach, which must not be read back as an evidence debt.
  const download = plan("Download the quarterly report to my Downloads folder.");
  assert.ok(download.requiredCapabilities.includes("web_research"));
  assert.equal(download.requiresWebEvidence, false);
});

test("a video link is Watch's subject, not a web-evidence debt", () => {
  // The regression: this exact shape selected the Watch skill, answered from
  // the downloaded video, and then had the answer replaced by the grounding
  // refusal because the pasted link had armed the web gate.
  const watch = plan(
    "in this video https://www.youtube.com/watch?v=XYOY2lk-QN4 what is the color of vision?",
  );
  assert.equal(watch.requiresWebEvidence, false);
  assert.ok(!watch.requiredCapabilities.includes("web_research"));

  // Short-host and direct-file video links are the same subject.
  assert.equal(
    plan("what happens at the end of https://youtu.be/XYOY2lk-QN4").requiresWebEvidence,
    false,
  );

  // A page link still owes a live source: only video links are exempt.
  assert.equal(
    plan("summarize this article https://example.com/story").requiresWebEvidence,
    true,
  );

  // A video link beside a page link keeps the obligation for the page.
  assert.equal(
    plan(
      "compare this video https://youtu.be/XYOY2lk-QN4 with the claims in https://example.com/review",
    ).requiresWebEvidence,
    true,
  );
});

test("resources are extracted for paths, urls and target formats", () => {
  const p = plan("Convert C:\\Users\\me\\notes\\draft.md to PDF and email it, see https://example.com/spec");
  const kinds = new Set(p.requiredResources.map((r) => r.kind));
  assert.ok(kinds.has("path"));
  assert.ok(kinds.has("url"));
  assert.ok(kinds.has("format"));
  assert.ok(p.requiredResources.some((r) => r.kind === "path" && r.absolute === true));
});
