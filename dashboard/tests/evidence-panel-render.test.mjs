// Renders the evidence panel for real (esbuild -> CJS -> react-dom/server)
// rather than reasoning about what it would produce.
//
// Three things are worth pinning down. A tool that failed before the runtime
// wrote a summary must not show its registry name ("web_search") where a
// sentence belongs. A turn that handed work to a runtime agent has to say so.
// And the panel has to stay small enough to read: sources listed once for the
// whole turn rather than under every call that touched them, no status word on
// a call that simply worked, one scroll region, and a height the caller
// measured — the panel used to take 70% of the viewport from wherever it was
// anchored and run its own close button off the top of the screen.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-evidence-panel-"),
);

after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as EvidencePanel } from "@/app/components/hermes/evidence-panel";\n`,
  "utf8",
);

const bundle = path.join(outDirectory, "bundle.cjs");
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  outfile: bundle,
  format: "cjs",
  platform: "node",
  target: "node20",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: { "@": path.join(dashboardRoot, "src") },
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  logLevel: "silent",
});

const require = module.createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { EvidencePanel } = require(bundle);

function render(verification, props = {}) {
  return renderToStaticMarkup(
    React.createElement(EvidencePanel, {
      verification,
      onClose: () => {},
      ...props,
    }),
  );
}

function evidence(overrides = {}) {
  return {
    id: "evidence-1",
    kind: "web_search",
    title: "Searching the web",
    success: false,
    timestamp: new Date(0).toISOString(),
    details: { toolName: "web_search" },
    ...overrides,
  };
}

function summary(overrides = {}) {
  return {
    state: "partially_verified",
    evidence: [],
    unsupportedClaims: [],
    assumptions: [],
    ...overrides,
  };
}

test("a failed lookup names the action, not the tool", () => {
  const markup = render(summary({ evidence: [evidence()] }));
  assert.match(markup, /Searching the web/);
  assert.match(markup, /failed/);
  assert.doesNotMatch(markup, /web_search/);
});

test("delegated runtime agents appear in the ledger", () => {
  const markup = render(
    summary({
      externalAgents: [
        {
          agentId: "money-printer",
          agentName: "Money Printer",
          command: "/agents:money-printer",
          reason: "Video production is its work.",
          requiresApproval: true,
          requestedAt: new Date(0).toISOString(),
        },
      ],
    }),
  );
  assert.match(markup, /External agents/);
  assert.match(markup, /Money Printer/);
  assert.match(markup, /\/agents:money-printer/);
  assert.match(markup, /needs approval/);
});

function coverage(overrides = {}) {
  return {
    entities: 4,
    fields: 5,
    settled: 14,
    total: 20,
    verified: 12,
    conflicting: 2,
    exhausted: 2,
    open: 4,
    searches: 31,
    stopReason: "coverage_sufficient",
    openRows: ["Gamma Aero: memberCount=open foundedAt=exhausted"],
    openRowsTruncated: 3,
    ...overrides,
  };
}

test("research coverage is shown as counts, not as the whole matrix", () => {
  const markup = render(summary({ researchCoverage: coverage() }));
  assert.match(markup, /Research coverage/);
  assert.match(markup, /14 of 20 requested details settled across 4 entities/);
  assert.match(markup, /after 31 searches/);
  assert.match(markup, /12 verified/);
  assert.match(markup, /2 left with sources in conflict/);
  // The distinction the pipeline exists to protect, made visible to the reader.
  assert.match(markup, /2 searched out — not publicly available/);
  assert.match(markup, /4 still unresolved — not established, rather than absent/);
  assert.match(markup, /Gamma Aero: memberCount=open/);
  assert.match(markup, /and 3 more incomplete/);
  assert.match(markup, /the requested details were covered/);
});

test("a run that ran out of budget says so rather than implying completeness", () => {
  const spent = render(
    summary({ researchCoverage: coverage({ stopReason: "budget_exhausted" }) }),
  );
  assert.match(spent, /the research budget ran out/);
  assert.match(spent, /not searched to exhaustion/);

  const unfinished = render(
    summary({ researchCoverage: coverage({ stopReason: null }) }),
  );
  assert.match(unfinished, /did not reach a stopping point/);

  // Every other turn is untouched: no section at all.
  assert.doesNotMatch(render(summary()), /Research coverage/);
});

test("a turn with no delegation renders no delegation section at all", () => {
  // The line denying it appeared on every non-delegating turn in the app; the
  // absence of the section carries the same fact for a fraction of the space.
  assert.doesNotMatch(render(summary({ externalAgents: [] })), /external agent/i);
  assert.doesNotMatch(render(summary()), /external agent/i);
});

test("consulted websites are listed once for the turn, one line each", () => {
  const markup = render(
    summary({
      evidence: [
        evidence({
          success: true,
          title: "Searched for student teams",
          location: "TU/e Eindhoven student teams",
          websites: [
            {
              url: "https://www.tue.nl/en/education/tue-student-experience/student-teams",
              title: "Student Teams | Eindhoven University of Technology",
              domain: "tue.nl",
              snippet: "Overview of official student teams at TU/e.",
            },
            {
              url: "https://en.wikipedia.org/wiki/Eindhoven_University_of_Technology",
              title: "Eindhoven University of Technology - Wikipedia",
              domain: "wikipedia.org",
            },
          ],
        }),
      ],
    }),
  );
  assert.match(markup, /2 sources/);
  assert.match(markup, /Student Teams | Eindhoven University of Technology/);
  assert.match(markup, /https:\/\/www\.tue\.nl\/en\/education\/tue-student-experience\/student-teams/);
  assert.match(markup, /tue\.nl/);
  assert.match(markup, /wikipedia\.org/);
  // The snippet is dropped on purpose: two wrapped lines of blurb per source
  // is what made five sources taller than the panel.
  assert.doesNotMatch(markup, /Overview of official student teams at TU\/e\./);
  // No globe, no per-link arrow — a source is a title and a host.
  assert.doesNotMatch(markup, /<svg[^>]*>\s*<path[^>]*d="M12 21a9/);
});

test("web search evidence without explicit websites array extracts websites from details", () => {
  const markup = render(
    summary({
      evidence: [
        evidence({
          success: true,
          title: "Searching the web",
          details: {
            toolName: "web_search",
            sources: [
              {
                url: "https://solarteam.nl",
                title: "Solar Team Eindhoven",
              },
            ],
          },
        }),
      ],
    }),
  );
  assert.match(markup, /1 source/);
  assert.match(markup, /Solar Team Eindhoven/);
  assert.match(markup, /https:\/\/solarteam\.nl/);
  assert.match(markup, /solarteam\.nl/);
});

test("a source reached by two calls is listed once, not once per call", () => {
  const page = {
    url: "https://marvel.com/d23-2026-x-men-cast",
    title: "D23 2026: Marvel Studios Unveils X-Men Cast",
    domain: "marvel.com",
  };
  const markup = render(
    summary({
      evidence: [
        evidence({
          id: "call-search",
          kind: "web_search",
          success: true,
          title: "Did 5 searches in 6.5s",
          websites: [page],
        }),
        // The extraction that followed reports the same page, with a trailing
        // slash. Listing it under both calls is what showed one host three
        // times over and hid how few distinct sources the answer really had.
        evidence({
          id: "call-extract",
          kind: "web_source",
          success: true,
          title: "Extracted 2 pages in 1.5s",
          websites: [{ ...page, url: `${page.url}/` }],
        }),
      ],
    }),
  );
  assert.match(markup, /1 source/);
  assert.doesNotMatch(markup, /2 sources/);
  assert.equal(markup.match(/marvel\.com<\/span>/g)?.length, 1);
});

test("a successful call carries no status word; a failed one still does", () => {
  // A column of "succeeded" down the whole ledger told the reader nothing they
  // could act on, so silence now means it worked.
  const fine = render(
    summary({ evidence: [evidence({ success: true, title: "Did 5 searches in 6.5s" })] }),
  );
  assert.doesNotMatch(fine, /succeeded/);
  assert.match(
    render(summary({ evidence: [evidence({ success: false })] })),
    /failed/,
  );
});

test("the panel bounds its own height and scrolls instead of growing off-screen", () => {
  const markup = render(
    summary({
      evidence: Array.from({ length: 40 }, (_, index) =>
        evidence({
          id: `evidence-${index}`,
          success: true,
          title: `Did 5 searches in ${index}.0s`,
        }),
      ),
    }),
  );
  assert.match(markup, /max-h-\[70vh\]/);
  assert.match(markup, /overflow-y-auto/);
  assert.match(markup, /40 tool calls/);
  // Exactly one scroll region. A source list nested in its own scroller
  // trapped the wheel over half the panel's height.
  assert.equal(markup.match(/overflow-y-auto/g).length, 1);
});

test("a measured height from the caller wins over the viewport default", () => {
  // The bug this pins down: anchored to an action row near the bottom of the
  // window, a 70vh panel grew off the top of the screen, close button and all.
  // The caller measures the room the trigger actually has and passes it in.
  const markup = render(
    summary({ evidence: [evidence({ success: true, title: "Did 5 searches" })] }),
    { maxHeight: 240 },
  );
  assert.match(markup, /max-height:240px/);
});

test("a turn that read nothing says so once, in the header", () => {
  const markup = render(
    summary({
      evidence: [
        evidence({ success: true, title: "Did 5 searches in 8.7s" }),
      ],
    }),
  );
  assert.match(markup, /no sources/);
  // Repeating it under the call as well said the same thing twice.
  assert.doesNotMatch(markup, /No source links were recorded/);
});

test("web search and tool evidence items render as plain text without badge containers", () => {
  const markup = render(
    summary({
      evidence: [
        evidence({
          id: "evidence-1",
          success: false,
          title: "Searching the web",
        }),
        evidence({
          id: "evidence-2",
          success: true,
          title: "Did 5 searches in 6.5s",
        }),
      ],
    }),
  );
  assert.match(markup, /Searching the web/);
  assert.match(markup, /Did 5 searches in 6.5s/);
  assert.doesNotMatch(markup, /rounded-lg border border-\[var\(--line\)\] bg-\[var\(--paper-surface\)\]/);
});

test("a search query is shown as plain text, with no badge and no code face", () => {
  const markup = render(
    summary({
      evidence: [
        evidence({
          success: true,
          title: "Did 5 searches in 8.7s",
          location: '"Eindhoven University of Technology" ("Harvard" OR "MIT")',
        }),
      ],
    }),
  );
  assert.match(markup, /Eindhoven University of Technology/);
  assert.doesNotMatch(markup, /<code/);
  assert.doesNotMatch(markup, /font-mono/);
  // No pill, chip or badge anywhere in the row.
  assert.doesNotMatch(markup, /bg-\[var\(--paper-strong\)\] px-1/);
});

// A capability is not a tool call. The panel's whole reason for carrying this
// section is the turn nobody typed a command for: super agent reads a pasted
// video link, selects Watch on the user's behalf, and until now the only trace
// of it in the transcript was a row that said "Running command".

test("an automatically selected skill is named, with the reason it fired", () => {
  const markup = render(
    summary({
      capabilities: {
        superAgent: true,
        inventory: { skills: 118, connections: 12, workflows: 4 },
        used: [
          {
            kind: "skill",
            id: "watch",
            label: "Watch",
            selection: "automatic",
            reason: "The message linked a video.",
            calls: 1,
            failures: 0,
            command: "/watch",
          },
        ],
      },
    }),
  );
  assert.match(markup, /Capabilities used/);
  assert.match(markup, /Watch/);
  assert.match(markup, /selected automatically/);
  assert.match(markup, /The message linked a video\./);
  assert.match(markup, /\/watch/);
  assert.match(markup, /1 call/);
  // What was merely on the table is not reported at all. A super-agent turn is
  // handed the whole catalogue, so the inventory line described the mode the
  // user switched on rather than this answer, on every single turn.
  assert.doesNotMatch(markup, /118 skills/);
  assert.doesNotMatch(markup, /Super agent/);
});

// Super agent alone no longer opens the section: with the inventory line gone
// there is nothing left to say about a turn that used none of what it was
// offered, and a bare heading reads as a claim that something is missing.
test("super agent with nothing used shows no capabilities section", () => {
  const markup = render(
    summary({
      capabilities: {
        superAgent: true,
        inventory: { skills: 24, connections: 0, workflows: 2 },
        used: [],
      },
    }),
  );
  assert.doesNotMatch(markup, /Capabilities used/);
  assert.doesNotMatch(markup, /Super agent/);
  assert.doesNotMatch(markup, /24 skills/);
});

// The turn a person actually reads after a delegation is the hand-back, and it
// makes no calls of its own. Denying evidence on it hid the fact that its whole
// content came out of a worker's run.
test("a carried delegation names the agent the answer came from", () => {
  const markup = render(
    summary({
      // The hand-back turn's own verdict: it asserted nothing it had to prove.
      state: "not_applicable",
      externalAgents: [
        {
          agentId: "deep-research",
          agentName: "Deep Research",
          command: "/agents:deep-research",
          requiresApproval: false,
          requestedAt: "2026-08-20T10:00:00.000Z",
          carried: true,
        },
      ],
    }),
  );
  assert.match(markup, /External agents/);
  assert.match(markup, /Deep Research/);
  assert.match(markup, /answered by/);
  // The verdict header describes this turn's own evidence, and it has none.
  // Saying it needed no verification would deny the run the answer came from.
  assert.match(markup, /Answered by Deep Research/);
  assert.doesNotMatch(markup, /No external verification needed/);
  assert.doesNotMatch(markup, /delegated/);
  assert.match(markup, /the work was done by the runtime agent below/);
  assert.doesNotMatch(
    markup,
    /No external tool evidence was recorded for this answer/,
  );
});

test("connections and automations are reported beside skills", () => {
  const markup = render(
    summary({
      capabilities: {
        superAgent: false,
        used: [
          {
            kind: "connection",
            id: "gmail",
            label: "Gmail",
            selection: "agent",
            calls: 2,
            failures: 1,
            command: "/gmail",
            actions: ["GMAIL_SEND_EMAIL"],
          },
          {
            kind: "workflow",
            id: "wf-7",
            label: "Daily digest",
            selection: "agent",
            calls: 1,
            failures: 0,
          },
        ],
      },
    }),
  );
  assert.match(markup, /Connections/);
  assert.match(markup, /Gmail/);
  assert.match(markup, /GMAIL_SEND_EMAIL/);
  assert.match(markup, /2 calls · 1 failed/);
  assert.match(markup, /Automations/);
  assert.match(markup, /Daily digest/);
});

test("a turn that used no capability renders no capability section", () => {
  // A heading followed by a denial is two lines spent saying nothing happened.
  const empty = render(summary({ capabilities: { superAgent: false, used: [] } }));
  assert.doesNotMatch(empty, /Capabilities used/);
  assert.doesNotMatch(empty, /No skill, connection or automation was used/);
  // Same for a summary persisted before capabilities were recorded at all.
  assert.doesNotMatch(render(summary()), /Capabilities used/);
});

test("renders web search results with search query and extracted websites from details.result", () => {
  const markup = render(
    summary({
      evidence: [
        evidence({
          id: "call-search-1",
          kind: "web_search",
          success: true,
          title: "Did 5 searches in 6.5s",
          location: "TU/e student teams",
          details: {
            toolName: "web_search",
            query: "TU/e student teams",
            result: {
              success: true,
              data: {
                web: [
                  {
                    title: "Student Teams | TU/e",
                    url: "https://www.tue.nl/en/education/student-teams",
                    description: "Overview of official student teams.",
                  },
                  {
                    title: "Solar Team Eindhoven",
                    url: "https://solarteam.nl",
                    description: "Solar car student team.",
                  },
                ],
              },
            },
          },
        }),
      ],
    }),
  );
  assert.match(markup, /Did 5 searches in 6.5s/);
  assert.match(markup, /TU\/e student teams/);
  assert.match(markup, /2 sources/);
  assert.match(markup, /Student Teams \| TU\/e/);
  assert.match(markup, /https:\/\/www\.tue\.nl\/en\/education\/student-teams/);
  assert.match(markup, /tue.nl/);
  assert.match(markup, /Solar Team Eindhoven/);
  assert.match(markup, /solarteam.nl/);
  assert.doesNotMatch(markup, /No source links were recorded/);
});

test("renders extracted web pages with clickable link and title from details.result", () => {
  const markup = render(
    summary({
      evidence: [
        evidence({
          id: "call-extract-1",
          kind: "web_source",
          success: true,
          title: "Extracted 1 page in 0.5s",
          location: "https://www.tue.nl/en/education/student-teams",
          details: {
            toolName: "web_extract",
            args: { urls: ["https://www.tue.nl/en/education/student-teams"] },
            result: {
              results: [
                {
                  title: "Student Teams | TU/e",
                  url: "https://www.tue.nl/en/education/student-teams",
                  content: "Content...",
                },
              ],
            },
          },
        }),
      ],
    }),
  );
  assert.match(markup, /Extracted 1 page in 0.5s/);
  assert.match(markup, /1 source/);
  assert.match(markup, /Student Teams \| TU\/e/);
  assert.match(markup, /https:\/\/www\.tue\.nl\/en\/education\/student-teams/);
  assert.match(markup, /tue.nl/);
  assert.doesNotMatch(markup, /No source links were recorded/);
});

test("a delegated agent's own sources render under its name", () => {
  // The screenshot this fixes: "Deep Research · answered by", and directly
  // above it "4 tool calls · no sources" — about an answer built entirely from
  // pages that agent read. A delegated run searches in its own process, so none
  // of it reaches the tool calls above.
  const markup = render(
    summary({
      state: "partially_verified",
      evidence: [evidence({ success: true, title: "Creating an artifact" })],
      externalAgents: [
        {
          agentId: "deep_research",
          agentName: "Deep Research",
          command: "/agents:deep-research",
          requiresApproval: false,
          requestedAt: new Date(0).toISOString(),
          carried: true,
          websites: [
            { url: "https://ifr.org/report", title: "World Robotics", domain: "ifr.org" },
            { url: "https://www.nist.gov/assembly", domain: "nist.gov" },
          ],
        },
      ],
    }),
  );

  assert.match(markup, /Deep Research/);
  assert.match(markup, /Deep Research read 2 pages/);
  assert.match(markup, /https:\/\/ifr\.org\/report/);
  assert.match(markup, /World Robotics/);
  assert.match(markup, /https:\/\/www\.nist\.gov\/assembly/);
  // And the header stops denying they exist.
  assert.doesNotMatch(markup, /no sources/);
  assert.match(markup, /2 sources/);
});

test("a page the turn and its agent both opened counts once", () => {
  const shared = "https://ifr.org/report";
  const markup = render(
    summary({
      evidence: [
        evidence({
          success: true,
          websites: [{ url: shared, domain: "ifr.org" }],
        }),
      ],
      externalAgents: [
        {
          agentId: "deep_research",
          agentName: "Deep Research",
          command: "/agents:deep-research",
          requiresApproval: false,
          requestedAt: new Date(0).toISOString(),
          carried: true,
          websites: [{ url: shared, domain: "ifr.org" }],
        },
      ],
    }),
  );
  assert.match(markup, /1 source(?!s)/);
});

test("an agent that read nothing adds no empty heading", () => {
  const markup = render(
    summary({
      evidence: [evidence({ success: true })],
      externalAgents: [
        {
          agentId: "vimax",
          agentName: "Vimax",
          command: "/agents:vimax",
          requiresApproval: false,
          requestedAt: new Date(0).toISOString(),
        },
      ],
    }),
  );
  assert.match(markup, /Vimax/);
  assert.doesNotMatch(markup, /read 0 pages/);
  assert.match(markup, /no sources/);
});
