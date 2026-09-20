// What the ratings have added up to, and the decisions available on them.
//
// This is the read surface for the whole mechanism. The API route
// /api/answer-signals/proposals serves the same analysis to anything that wants
// to render it; this script exists because the thumbs themselves were left
// unchanged, and without it there would be no way to see what they produced or
// to act on it.
//
//   node --experimental-strip-types dashboard/scripts/answer-signal-report.mjs
//   node --experimental-strip-types dashboard/scripts/answer-signal-report.mjs --untagged
//   node --experimental-strip-types dashboard/scripts/answer-signal-report.mjs --tag 4821 too_long
//   node --experimental-strip-types dashboard/scripts/answer-signal-report.mjs --accept too_long:questionscope:general
//   node --experimental-strip-types dashboard/scripts/answer-signal-report.mjs --dismiss too_long:questionscope:general
//
// == Why --tag exists ==
//
// A downvote with no reason is uninterpretable: it says an answer was bad and
// nothing about which part, so it can inform the attribution table (which groups
// on the turn's conditions) but can never produce a preference proposal or a
// benchmark candidate — both of those need to know what was wrong. The thumbs
// on the message row do not ask, so `--tag` is the path that attaches a reason
// after the fact. `--untagged` lists the downvotes waiting for one.

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { databaseDir } from "../src/lib/runtime-paths.ts";
import {
  SIGNAL_REASONS,
  listAnswerSignals,
} from "../src/lib/hermes/answer-signals.ts";
import { analyzeAnswerSignals } from "../src/lib/hermes/answer-signal-analysis.ts";
import {
  acceptProposal,
  dismissProposal,
  pendingProposals,
  decidedProposals,
} from "../src/lib/hermes/answer-signal-proposals.ts";

const argv = process.argv.slice(2);
const argValue = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const tagTarget = argValue("--tag");
const acceptId = argValue("--accept");
const dismissId = argValue("--dismiss");
const showUntagged = argv.includes("--untagged");
const writes = Boolean(tagTarget || acceptId || dismissId);

const dbPath = path.join(databaseDir(), "brain.db");
if (!fs.existsSync(dbPath)) {
  console.error(`no database at ${dbPath}`);
  process.exit(1);
}
const db = new Database(dbPath, { readonly: !writes });

const hasTable = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'answer_signals'")
  .get();
if (!hasTable) {
  console.log("No answer_signals table yet — nothing has been rated on this install.");
  process.exit(0);
}

/**
 * Whose signals to read. A desktop install has one user, and asking for an id
 * every time would be ceremony; more than one is ambiguous and has to be said.
 */
function resolveUser() {
  const explicit = argValue("--user");
  if (explicit) return Number(explicit);
  const users = db
    .prepare("SELECT DISTINCT user_id FROM answer_signals ORDER BY user_id")
    .all();
  if (users.length === 1) return users[0].user_id;
  if (!users.length) {
    console.log("No signals recorded yet.");
    process.exit(0);
  }
  console.error(
    `Signals exist for ${users.length} users (${users
      .map((row) => row.user_id)
      .join(", ")}); pass --user <id>.`,
  );
  process.exit(1);
}

const userId = resolveUser();

// ------------------------------------------------------------------ tagging

if (tagTarget) {
  const reason = argv[argv.indexOf("--tag") + 2];
  if (!SIGNAL_REASONS.includes(reason)) {
    console.error(`--tag <messageId> <reason>, where reason is one of: ${SIGNAL_REASONS.join(", ")}`);
    process.exit(1);
  }
  const result = db
    .prepare(
      `UPDATE answer_signals SET reason = ?, updated_at = datetime('now')
       WHERE user_id = ? AND message_id = ? AND signal_kind = 'rated_down'`,
    )
    .run(reason, userId, Number(tagTarget));
  console.log(
    result.changes
      ? `Tagged message ${tagTarget} as "${reason}".`
      : `No untagged downvote on message ${tagTarget}.`,
  );
  process.exit(0);
}

// ----------------------------------------------------------------- untagged

if (showUntagged) {
  const rows = db
    .prepare(
      `SELECT s.message_id, substr(m.content, 1, 100) AS preview, s.created_at
       FROM answer_signals s
       JOIN conversation_messages m ON m.id = s.message_id
       WHERE s.user_id = ? AND s.signal_kind = 'rated_down' AND s.reason IS NULL
       ORDER BY s.created_at DESC`,
    )
    .all(userId);
  if (!rows.length) {
    console.log("Every downvote carries a reason.");
    process.exit(0);
  }
  console.log(`${rows.length} downvote(s) with no reason attached:\n`);
  for (const row of rows) {
    console.log(`  message ${row.message_id}  ${row.created_at}`);
    console.log(`    ${row.preview.replace(/\s+/g, " ")}...`);
  }
  console.log(`\nAttach one with:  --tag <messageId> <${SIGNAL_REASONS.join("|")}>`);
  process.exit(0);
}

// ------------------------------------------------------------------ analysis

const signals = listAnswerSignals(userId, { limit: 5_000 }, db);
const analysis = analyzeAnswerSignals(signals);

// ------------------------------------------------------------------ deciding

if (acceptId || dismissId) {
  const id = acceptId ?? dismissId;
  const proposal = analysis.proposals.find((candidate) => candidate.id === id);
  if (!proposal) {
    console.error(`No current proposal with id ${id}. Run without flags to list them.`);
    process.exit(1);
  }
  if (acceptId) {
    acceptProposal({ userId, proposal }, db);
    console.log(`Accepted. Written to durable memory as a confirmed global ${proposal.kind}:`);
    console.log(`  "${proposal.content}"`);
    console.log("\nIt now applies to every personalized turn. Remove it in the memory panel.");
  } else {
    dismissProposal({ userId, proposalId: proposal.id, content: proposal.content }, db);
    console.log(`Dismissed. It will not be proposed again.`);
  }
  process.exit(0);
}

// -------------------------------------------------------------------- report

console.log(`Signals: ${signals.length} recorded, ${analysis.considered} eligible for analysis.`);
for (const [reason, count] of Object.entries(analysis.excluded)) {
  console.log(`  excluded ${count} (${reason.replace(/_/g, " ")})`);
}

if (!analysis.groups.length) {
  console.log(
    `\nNo condition has reached the support floor yet. Groups appear once they carry enough ratings to mean something.`,
  );
}

if (analysis.groups.length) {
  console.log("\nAttribution — ratings by condition\n");
  const width = Math.max(...analysis.groups.map((group) => `${group.dimension}=${group.value}`.length));
  console.log(
    `  ${"condition".padEnd(width)}   up  down   net   copied  regen`,
  );
  for (const group of analysis.groups) {
    const label = `${group.dimension}=${group.value}`.padEnd(width);
    console.log(
      `  ${label}  ${String(group.ratedUp).padStart(3)}  ${String(group.ratedDown).padStart(4)}  ${String(group.net).padStart(4)}   ${String(group.approval).padStart(6)}  ${String(group.dissatisfaction).padStart(5)}`,
    );
  }
}

if (analysis.findings.length) {
  console.log("\nFindings — where the complaints concentrate\n");
  for (const finding of analysis.findings) {
    console.log(`  ${finding.summary}  (${Math.round(finding.concentration * 100)}%)`);
  }
}

const pending = pendingProposals(userId, analysis.proposals, db);
if (pending.length) {
  console.log("\nProposals awaiting your decision\n");
  for (const proposal of pending) {
    console.log(`  ${proposal.id}`);
    console.log(`    would write: "${proposal.content}"`);
    console.log(`    as a confirmed global ${proposal.kind}, applied to every personalized turn`);
    console.log(`    evidence: ${proposal.evidence}`);
    console.log(`    accept with:  --accept ${proposal.id}`);
    console.log(`    dismiss with: --dismiss ${proposal.id}`);
  }
} else if (analysis.considered) {
  console.log("\nNo proposals. A pattern needs enough ratings, carrying reasons, concentrated on one condition.");
}

const decided = decidedProposals(userId, analysis.proposals, db);
if (decided.length) {
  console.log("\nAlready decided\n");
  for (const proposal of decided) {
    console.log(`  [${proposal.status}] ${proposal.id} — ${proposal.decidedAt}`);
  }
}
