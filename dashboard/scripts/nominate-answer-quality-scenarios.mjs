// Mine rated-down answers into candidate benchmark scenarios.
//
// Reads the signals recorded by the answer-signals route, joins each one to the
// answer it judges and the question that produced it, and writes candidates to
// qa/answer-quality/candidates.json. Nothing here touches scenarios.json:
// promoting a candidate into the suite is a human edit, for the reasons in
// qa/answer-quality/README.md.
//
//   node --experimental-strip-types dashboard/scripts/nominate-answer-quality-scenarios.mjs
//   node --experimental-strip-types dashboard/scripts/nominate-answer-quality-scenarios.mjs --user 1 --dry-run
//
// The database is opened read-only. This script is safe to run while the app is.

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { databaseDir, repositoryRoot } from "../src/lib/runtime-paths.ts";
import {
  mergeCandidates,
  nominateScenarios,
} from "../src/lib/hermes/answer-quality-scenarios.ts";

const argv = process.argv.slice(2);
const argValue = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};
const dryRun = argv.includes("--dry-run");
const userFilter = argValue("--user");

const dbPath = path.join(databaseDir(), "brain.db");
if (!fs.existsSync(dbPath)) {
  console.error(`no database at ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

// A signal whose table does not exist yet is not an error: it means nobody has
// rated anything on this install.
const hasTable = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'answer_signals'")
  .get();
if (!hasTable) {
  console.log("No answer_signals table yet — nothing has been rated on this install.");
  process.exit(0);
}

const rows = db
  .prepare(
    `SELECT s.id, s.user_id, s.conversation_id, s.message_id, s.signal_kind,
            s.reason, s.conditions, s.occurrences, s.created_at, s.updated_at,
            m.content AS answer, m.order_index AS order_index
     FROM answer_signals s
     JOIN conversation_messages m ON m.id = s.message_id
     WHERE s.signal_kind = 'rated_down'
       AND s.reason IS NOT NULL
       AND (? IS NULL OR s.user_id = ?)
     ORDER BY s.updated_at DESC`,
  )
  .all(userFilter ?? null, userFilter ?? null);

const precedingQuestion = db.prepare(
  `SELECT content FROM conversation_messages
   WHERE conversation_id = ? AND order_index < ? AND role = 'user'
   ORDER BY order_index DESC LIMIT 1`,
);

const inputs = rows.map((row) => {
  let conditions = {};
  try {
    conditions = row.conditions ? JSON.parse(row.conditions) : {};
  } catch {
    conditions = {};
  }
  return {
    signal: {
      id: row.id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      kind: row.signal_kind,
      reason: row.reason,
      conditions,
      occurrences: row.occurrences,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    question:
      precedingQuestion.get(row.conversation_id, row.order_index)?.content ?? "",
    answer: row.answer ?? "",
  };
});

const nominated = nominateScenarios(inputs);

const candidateFile = path.join(
  repositoryRoot(),
  "qa",
  "answer-quality",
  "candidates.json",
);
let existing = [];
if (fs.existsSync(candidateFile)) {
  try {
    existing = JSON.parse(fs.readFileSync(candidateFile, "utf8")).candidates ?? [];
  } catch {
    console.error(`${candidateFile} is not readable JSON; refusing to overwrite it.`);
    process.exit(1);
  }
}

const { candidates, added } = mergeCandidates(existing, nominated);

console.log(
  `${rows.length} reasoned downvote(s) → ${nominated.length} candidate(s), ${added} new.`,
);
const needingReview = candidates.filter((candidate) => candidate.propertiesNeedReview);
if (needingReview.length) {
  console.log(
    `${needingReview.length} candidate(s) carry placeholder properties a reviewer must replace:`,
  );
  for (const candidate of needingReview) console.log(`   ${candidate.id}`);
}

if (dryRun) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

fs.mkdirSync(path.dirname(candidateFile), { recursive: true });
fs.writeFileSync(
  candidateFile,
  `${JSON.stringify(
    {
      about:
        "Candidate scenarios mined from rated-down answers. Promote one by moving it into scenarios.json and giving it a rubric you have read. Nothing in this file is run by the evaluator.",
      generatedAt: new Date().toISOString(),
      candidates,
    },
    null,
    2,
  )}\n`,
);
console.log(`\nwrote ${candidateFile} (${candidates.length} candidate(s) total)`);
