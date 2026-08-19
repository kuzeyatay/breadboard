import test from "node:test";
import assert from "node:assert/strict";
import {
  activityLabelForTool,
  assertsExternalFact,
  assessVerification,
  reportWebGrounding,
  evidenceKindForTool,
  evidenceTitleForTool,
  WEB_GROUNDING_FAILED_MESSAGE,
  WEB_GROUNDING_UNAVAILABLE_MESSAGE,
  WEB_GROUNDING_LOOKUP_FAILED_NOTICE,
  WEB_GROUNDING_UNVERIFIED_NOTICE,
  isHttpUrl,
  extractDomain,
  normalizeWebsite,
  extractWebsitesFromPayload,
  extractWebsitesFromEvidence,
} from "../src/lib/hermes/evidence.ts";

const evidence = (kind) => ({
  id: `e-${kind}`,
  kind,
  title: kind,
  success: true,
  timestamp: new Date(0).toISOString(),
  details: {},
});

const failed = (kind) => ({ ...evidence(kind), success: false });

test("tool evidence remains source-distinguishable", () => {
  assert.equal(evidenceKindForTool("read"), "file_read");
  assert.equal(evidenceKindForTool("websearch"), "web_search");
  assert.equal(evidenceKindForTool("web_search"), "web_search");
  assert.equal(evidenceKindForTool("web_extract"), "web_source");
  assert.equal(evidenceKindForTool("garden_search"), "garden");
  assert.equal(evidenceKindForTool("gbrain_search"), "memory");
  assert.equal(evidenceKindForTool("save_memory"), "memory");
  assert.equal(evidenceKindForTool("task"), "subagent");
  assert.equal(evidenceKindForTool("tool_search"), "tool_metadata");
  assert.equal(evidenceKindForTool("tool_describe"), "tool_metadata");
  assert.equal(evidenceKindForTool("capability_search"), "tool_metadata");
});

test("a planned web turn is reported unsourced, never overwritten", () => {
  // The rule this file now enforces: the answer always survives. An unmet web
  // obligation is reported, because deleting a finished answer on the strength
  // of a pre-dispatch guess cost users whole turns whenever the guess was wrong.
  const answer = "Western Turkey may see a partial eclipse.";
  const report = reportWebGrounding(answer, [evidence("command")], true);
  assert.equal(report.required, true);
  assert.equal(report.satisfied, false);
  assert.equal(report.shortfall, "never_attempted");
  assert.equal(report.notice, WEB_GROUNDING_UNVERIFIED_NOTICE);

  const unsupported = assessVerification(answer, [evidence("command")], {
    webGroundingRequired: true,
  });
  assert.equal(unsupported.state, "contradicted");
  assert.match(unsupported.unsupportedClaims[0], /needed current web evidence/i);
  assert.equal(unsupported.webGrounding?.shortfall, "never_attempted");

  const grounded = assessVerification(
    "The eclipse path does not cross Turkey.",
    [evidence("web_search")],
    { webGroundingRequired: true },
  );
  assert.equal(grounded.state, "verified");
  assert.equal(grounded.webGrounding?.satisfied, true);
  assert.equal(
    reportWebGrounding(
      "The eclipse path does not cross Turkey.",
      [evidence("web_search")],
      true,
    ).satisfied,
    true,
  );

  // An answer persisted by the old substituting gate still reads as unverified,
  // and is never re-flagged as a fresh unsourced claim.
  const legacy = assessVerification(
    WEB_GROUNDING_UNAVAILABLE_MESSAGE,
    [evidence("command")],
    { webGroundingRequired: true },
  );
  assert.equal(legacy.state, "unverified");
  assert.deepEqual(legacy.unsupportedClaims, []);
  assert.equal(legacy.webGrounding?.shortfall, undefined);
});

test("the web gate flags claims, never answers that make none", () => {
  // The turn that motivated this: "hi" planned as a web turn, answered
  // normally, and the whole reply replaced by a refusal at the last step.
  const greeting = "Hey! What would you like to work on?";
  assert.equal(assertsExternalFact(greeting), false);
  assert.equal(
    reportWebGrounding(greeting, [evidence("command")], true).shortfall,
    undefined,
  );

  for (const harmless of [
    "Hi there.",
    "Which file did you mean?",
    "I couldn't find anything matching that.",
    "I'm not able to reach that service right now.",
    "Let me know if you want me to keep going.",
  ]) {
    assert.equal(
      reportWebGrounding(harmless, [evidence("command")], true).notice,
      undefined,
      `flagged an answer that asserts nothing: ${harmless}`,
    );
  }

  // A first-person sentence still counts when it carries the claim itself.
  assert.equal(assertsExternalFact("I found the current price is $12."), true);

  // An answer that asserts nothing is not "contradicted" either — the panel
  // must not label a sound turn as one that outran its evidence.
  const summary = assessVerification(greeting, [evidence("command")], {
    webGroundingRequired: true,
  });
  assert.deepEqual(summary.unsupportedClaims, []);
});

test("a failed lookup is reported as failed, not as never having looked", () => {
  const claim = "The merger closed last quarter.";
  const attempted = reportWebGrounding(claim, [failed("web_search")], true);
  assert.equal(attempted.shortfall, "lookup_failed");
  assert.equal(attempted.notice, WEB_GROUNDING_LOOKUP_FAILED_NOTICE);
  assert.match(attempted.notice, /send the message again/i);

  // Never looking is a different fact about the turn than looking and failing.
  assert.equal(
    reportWebGrounding(claim, [evidence("command")], true).shortfall,
    "never_attempted",
  );

  // Answers the old substituting gate persisted keep reading as unverified,
  // and are never themselves flagged as unsourced claims.
  for (const notice of [
    WEB_GROUNDING_FAILED_MESSAGE,
    WEB_GROUNDING_UNAVAILABLE_MESSAGE,
  ]) {
    assert.equal(
      reportWebGrounding(notice, [failed("web_search")], true).shortfall,
      undefined,
    );
    assert.equal(
      assessVerification(notice, [failed("web_search")], {
        webGroundingRequired: true,
      }).state,
      "unverified",
    );
  }
});

test("opening the pasted source itself satisfies the web gate", () => {
  // The regression: a Watch turn downloaded the linked video, answered from
  // it, and the gate replaced the answer because no browser-shaped tool ran.
  const watched = {
    ...evidence("command"),
    details: { toolName: "watch_run" },
  };
  const claim = "At 2:14 the speaker says vision is the color green.";
  assert.equal(reportWebGrounding(claim, [watched], true).satisfied, true);
  assert.equal(
    assessVerification(claim, [watched], { webGroundingRequired: true })
      .unsupportedClaims.length,
    0,
  );

  // Factcheck fetches the page it is checking — the same standing.
  const factchecked = {
    ...evidence("command"),
    details: { toolName: "factcheck_run" },
  };
  assert.equal(
    reportWebGrounding("The article's central claim is false.", [factchecked], true)
      .satisfied,
    true,
  );

  // A watch that was attempted and failed is a failed lookup, not a turn
  // that never looked.
  const failedWatch = { ...watched, success: false };
  assert.equal(
    reportWebGrounding(claim, [failedWatch], true).shortfall,
    "lookup_failed",
  );

  // Any other command evidence still leaves the obligation unmet.
  assert.equal(
    reportWebGrounding(claim, [evidence("command")], true).shortfall,
    "never_attempted",
  );
});

test("capability discovery does not verify external factual claims", () => {
  const result = assessVerification(
    "Rahmi Koç Müzesi is the strongest current option.",
    [evidence("tool_metadata")],
  );

  assert.equal(result.state, "unverified");
  assert.equal(result.evidence.length, 1);
  assert.equal(activityLabelForTool("tool_search"), "Inspecting capabilities");
});

test("save_memory reads as a durable-memory write", () => {
  assert.equal(evidenceKindForTool("save_memory"), "memory");
  assert.equal(activityLabelForTool("save_memory"), "Saving durable memory");
  // gbrain retrieval must not be mislabeled as a write.
  assert.equal(activityLabelForTool("gbrain_search"), "Consulting memory");
});

test("deterministic honesty rejects unsupported operational claims", () => {
  const result = assessVerification(
    "I searched the web, tests passed, and GBrain is integrated.",
    [],
  );
  assert.equal(result.state, "contradicted");
  assert.equal(result.unsupportedClaims.length, 3);
});

test("matching evidence verifies supported claims", () => {
  const result = assessVerification("I searched the web and tests passed.", [
    evidence("web_search"),
    evidence("test"),
  ]);
  assert.equal(result.state, "verified");
  assert.deepEqual(result.unsupportedClaims, []);
});

test("a tool that failed before writing a summary is still named in English", () => {
  // The runtime writes a summary only once a tool produced something. Without
  // a fallback the ledger showed the raw registry name beside "failed".
  assert.equal(evidenceTitleForTool("web_search", undefined), "Searching the web");
  assert.equal(evidenceTitleForTool("web_search", "   "), "Searching the web");
  assert.equal(evidenceTitleForTool("read"), "Reading file");
  // A written summary always wins: it says more than the generic label can.
  assert.equal(
    evidenceTitleForTool("web_search", "Did 10 searches in 5.0s"),
    "Did 10 searches in 5.0s",
  );
});

test("delegated runtime agents are reported without changing the verdict", () => {
  const delegation = [
    {
      agentId: "money-printer",
      agentName: "Money Printer",
      command: "/agents:money-printer",
      reason: "Video production is its work.",
      requiresApproval: true,
      requestedAt: new Date(0).toISOString(),
    },
  ];
  const delegated = assessVerification("Handing this to Money Printer.", [], {
    externalAgents: delegation,
  });
  assert.deepEqual(delegated.externalAgents, delegation);
  // A queued run is not a result, so it must not lift the answer's standing.
  assert.equal(delegated.state, "not_applicable");

  // The field is always present once assessed, so the panel can tell "none
  // were called" apart from "this summary predates the record".
  assert.deepEqual(assessVerification("Hello.", []).externalAgents, []);
});

test("academic source claims require Garden, web, or user-provided evidence", () => {
  const unsupported = assessVerification(
    "The report includes academic references with DOI links.",
    [evidence("command")],
  );
  assert.equal(unsupported.state, "contradicted");
  assert.match(unsupported.unsupportedClaims[0], /Source-backed claim/);

  const grounded = assessVerification(
    "The report includes academic references with DOI links.",
    [evidence("garden")],
  );
  assert.equal(grounded.state, "verified");
});

test("website normalization and domain extraction", () => {
  assert.equal(isHttpUrl("https://www.tue.nl/student-teams"), true);
  assert.equal(isHttpUrl("http://example.com"), true);
  assert.equal(isHttpUrl("not-a-url"), false);
  assert.equal(isHttpUrl("ftp://files.example.com"), false);

  assert.equal(extractDomain("https://www.tue.nl/path"), "tue.nl");
  assert.equal(extractDomain("https://en.wikipedia.org/wiki/TU_Eindhoven"), "en.wikipedia.org");

  const site = normalizeWebsite({
    url: "https://www.tue.nl/en/education/student-teams",
    title: "TU/e Student Teams",
    snippet: "Official team list.",
  });
  assert.deepEqual(site, {
    url: "https://www.tue.nl/en/education/student-teams",
    title: "TU/e Student Teams",
    domain: "tue.nl",
    snippet: "Official team list.",
  });

  const fromString = normalizeWebsite("https://github.com/breadboard");
  assert.deepEqual(fromString, {
    url: "https://github.com/breadboard",
    domain: "github.com",
  });
});

test("extractWebsitesFromPayload parses markdown, JSON, and structured tool results", () => {
  const md = "Found results:\n1. [TU/e Teams](https://www.tue.nl/teams)\n2. [Solar Team](https://solarteam.nl)";
  const mdWebsites = extractWebsitesFromPayload(md);
  assert.equal(mdWebsites.length, 2);
  assert.equal(mdWebsites[0].url, "https://www.tue.nl/teams");
  assert.equal(mdWebsites[0].title, "TU/e Teams");
  assert.equal(mdWebsites[0].domain, "tue.nl");
  assert.equal(mdWebsites[1].url, "https://solarteam.nl");

  const structured = {
    action: {
      sources: [
        { url: "https://www.nature.com/articles/123", title: "Nature Paper" },
      ],
    },
  };
  const structuredWebsites = extractWebsitesFromPayload(structured);
  assert.equal(structuredWebsites.length, 1);
  assert.equal(structuredWebsites[0].domain, "nature.com");
  assert.equal(structuredWebsites[0].title, "Nature Paper");

  const jsonString = JSON.stringify({
    results: [
      { url: "https://news.ycombinator.com", title: "Hacker News" },
    ],
  });
  const jsonWebsites = extractWebsitesFromPayload(jsonString);
  assert.equal(jsonWebsites.length, 1);
  assert.equal(jsonWebsites[0].url, "https://news.ycombinator.com");
});

test("extractWebsitesFromEvidence aggregates and deduplicates websites", () => {
  const record = {
    id: "e-web",
    kind: "web_search",
    title: "Searching the web",
    success: true,
    location: "TU/e Eindhoven student teams",
    timestamp: new Date().toISOString(),
    websites: [
      { url: "https://www.tue.nl/teams", title: "TU/e Teams", domain: "tue.nl" },
    ],
    details: {
      toolName: "web_search",
      sources: [
        { url: "https://www.tue.nl/teams/", title: "TU/e Teams" },
        { url: "https://solarteam.nl", title: "Solar Team" },
      ],
    },
  };
  const sites = extractWebsitesFromEvidence(record);
  assert.equal(sites.length, 2);
  assert.equal(sites[0].url, "https://www.tue.nl/teams");
  assert.equal(sites[1].url, "https://solarteam.nl");
});

test("the shape Hermes's web_search actually returns yields its result pages", () => {
  // {"success": true, "data": {"web": [...]}} — the wrapper that previously
  // walked to a dead end, so every search row named no page at all.
  const websites = extractWebsitesFromPayload({
    tool_id: "call-1",
    name: "web_search",
    args: { query: "TU/e student teams", limit: 5 },
    summary: "Did 5 searches in 6.4s",
    result: {
      success: true,
      data: {
        web: [
          {
            title: "Student Teams | TU/e",
            url: "https://www.tue.nl/en/education/student-teams",
            description: "Overview of official student teams.",
            position: 1,
          },
          {
            title: "Solar Team Eindhoven",
            url: "https://solarteam.nl",
            description: "Solar Team Eindhoven builds solar cars.",
            position: 2,
          },
        ],
      },
    },
  });
  assert.equal(websites.length, 2);
  assert.equal(websites[0].url, "https://www.tue.nl/en/education/student-teams");
  assert.equal(websites[0].title, "Student Teams | TU/e");
  assert.equal(websites[0].domain, "tue.nl");
  assert.equal(websites[0].snippet, "Overview of official student teams.");
  assert.equal(websites[1].domain, "solarteam.nl");
});

test("an extracted page contributes itself, not every link in its body", () => {
  const websites = extractWebsitesFromPayload({
    tool_id: "call-2",
    name: "web_extract",
    summary: "Extracted 1 page in 0.3s",
    result: {
      results: [
        {
          url: "https://www.tue.nl/en/education/student-teams",
          title: "Student Teams",
          content:
            "See also https://example.com/ads and https://tracker.example.net/pixel for more.",
          error: null,
        },
      ],
    },
  });
  assert.equal(websites.length, 1);
  assert.equal(websites[0].url, "https://www.tue.nl/en/education/student-teams");
});
