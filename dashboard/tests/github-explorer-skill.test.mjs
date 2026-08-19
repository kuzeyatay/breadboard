// GitHub Explorer: the OpenClaw github-explorer workflow, re-authored as a
// prebuilt first-party skill that selects itself when someone names a repo
// they want understood.
//
// Three things are locked here: the shipped SKILL.md keeps the rules the
// re-authoring exists for (API-not-SPA sourcing, link traceability, the
// provenance check), the skill is a ready knowledge-work skill on both chat
// surfaces, and the intent module fires on the sentences people write without
// claiming the work orders next door.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { listApprovedSkills, listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  githubExplorerCommandText,
  shouldAutoSelectGithubExplorer,
  GITHUB_EXPLORER_SKILL,
} from "../src/lib/hermes/github-explorer-intent.ts";

const shippedSkill = new URL(
  "../../hermes-skills/prebuilt/github-explorer/SKILL.md",
  import.meta.url,
);

function selects(text, priorMessages) {
  return shouldAutoSelectGithubExplorer({
    text,
    surface: "dashboard_terminal",
    authenticated: true,
    priorMessages,
  });
}

test("the shipped SKILL.md keeps the rules the re-authoring exists for", () => {
  const shipped = fs.readFileSync(shippedSkill, "utf8");
  for (const marker of [
    // The one hard technical rule: GitHub repo pages are a client-rendered
    // shell, so facts come from the API and raw endpoints.
    "api.github.com/repos/{owner}/{repo}",
    "raw.githubusercontent.com",
    "Never scrape github.com repo pages",
    // The sourcing discipline that separates a dossier from a README recap.
    "Community claims are specific and sourced",
    // The provenance check — this skill was itself recovered from a
    // malware-lure repost of the upstream repo, and it checks for the pattern.
    "Provenance and risk",
    "never fetch-and-run",
    // The tools it names are the ones Hermes turns actually have.
    "web_search",
    "web_extract",
  ]) {
    assert.ok(shipped.includes(marker), `SKILL.md lost: ${marker}`);
  }
  // No shell in a chat turn means no shell in the guidance.
  assert.doesNotMatch(shipped, /\bcurl\b/, "guidance must not assume a shell");
  assert.doesNotMatch(shipped, /\{PAT\}/, "guidance must not assume a token");
});

test("GitHub Explorer is a ready knowledge-work skill on both chat surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find(
      (candidate) => candidate.slug === GITHUB_EXPLORER_SKILL,
    );
    assert.ok(skill, `github-explorer missing from ${surface}`);
    // Confined to scoped_implementation, the skill would be unselectable on
    // the research turns it exists for — a dossier is not repository coding.
    assert.equal(skill.classification, "eligible_general", surface);
    assert.equal(skill.availability, "ready", surface);
    assert.ok(skill.enabled && skill.healthy, surface);
    assert.ok(
      listApprovedSkills(surface).some(
        (candidate) => candidate.slug === GITHUB_EXPLORER_SKILL,
      ),
      `github-explorer is not approved on ${surface}`,
    );
  }
});

test("the sentences people actually write select the skill", () => {
  for (const text of [
    "look into https://github.com/vercel/next.js for me",
    "can you check out this repo? https://github.com/karpathy/nanoGPT",
    "analyze https://github.com/infiniflow/ragflow",
    "is https://github.com/some-org/some-tool any good?",
    "what do you think of https://github.com/pola-rs/polars",
    "https://github.com/astral-sh/uv",
    "https://github.com/astral-sh/uv thoughts?",
    "investigate this github project: https://github.com/acme/widget",
    "should we use https://github.com/tanstack/query in production?",
    "how well-maintained is https://github.com/expressjs/express these days",
    "audit https://github.com/sketchy/lure before we integrate it",
    "investigate the langchain repo on github",
    "deep dive into this github repository please: https://github.com/a/b",
    "is https://github.com/caution724/github-explorer-skill legit?",
  ]) {
    assert.equal(selects(text), true, `should select: ${text}`);
  }
});

test("it stays out of the work orders and object questions next door", () => {
  for (const text of [
    // Work orders: hands, not a report.
    "clone https://github.com/vercel/next.js and build it",
    "integrate https://github.com/some/lib into the dashboard",
    "install https://github.com/astral-sh/uv and set it up",
    "fix the bug described in https://github.com/acme/widget",
    "open a PR against https://github.com/acme/widget",
    // One object inside a repo, not the repo.
    "explain https://github.com/acme/widget/blob/main/src/index.ts",
    "summarize https://github.com/acme/widget/pull/42",
    "what does https://github.com/acme/widget/issues/7 say",
    // GitHub the product, not a repo on it.
    "how do I create a github repo",
    // GitHub's own pages are not repositories.
    "https://github.com/trending is fun",
    // Ordinary chat that happens to contain the noun.
    "the repo is finally green again",
    "push my changes to the repo",
    // An explicit command decides for itself.
    "/watch https://github.com/acme/widget",
  ]) {
    assert.equal(selects(text), false, `should not select: ${text}`);
  }
});

test("a follow-up keeps the sourcing rules the first dossier was built with", () => {
  const prior = [
    { role: "user", content: "look into https://github.com/acme/widget" },
    {
      role: "assistant",
      content: "# [Widget](https://github.com/acme/widget)\n**🎯 One-line positioning**…",
    },
  ];
  assert.equal(selects("what about its issues?", prior), true);
  assert.equal(selects("how active is it?", prior), true);
  assert.equal(selects("any alternatives?", prior), true);
  // The same follow-up after an unrelated turn is just a follow-up.
  assert.equal(
    selects("what about its issues?", [
      { role: "assistant", content: "I renamed the CSS variables." },
    ]),
    false,
  );
});

test("selection is scoped to authenticated chat surfaces", () => {
  const text = "look into https://github.com/vercel/next.js for me";
  assert.equal(
    shouldAutoSelectGithubExplorer({ text, surface: "quartz_ai", authenticated: true }),
    false,
  );
  assert.equal(
    shouldAutoSelectGithubExplorer({
      text,
      surface: "dashboard_terminal",
      authenticated: false,
    }),
    false,
  );
});

test("the command text is the skill's slash command plus the untouched message", () => {
  const text = "look into https://github.com/vercel/next.js for me";
  assert.deepEqual(
    githubExplorerCommandText({ text, surface: "garden_chat", authenticated: true }),
    { text: `/${GITHUB_EXPLORER_SKILL} ${text}`, automatic: true },
  );
});

test("both turn pipelines select it, or the feature works on one surface only", () => {
  for (const file of [
    "../src/lib/conversations/turn-service.ts",
    "../src/lib/hermes/garden-chat-adapter.ts",
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /githubExplorerCommandText\(/, file);
    assert.match(source, /text: diagramSelection\.text/, `${file}: chain order`);
    assert.match(
      source,
      /text: githubExplorerSelection\.text/,
      `${file}: messaging follows`,
    );
    assert.match(
      source,
      /!githubExplorerSelection\.automatic/,
      `${file}: unavailable fallback`,
    );
  }
});
