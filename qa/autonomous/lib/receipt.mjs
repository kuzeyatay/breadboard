/**
 * Repair receipts.
 *
 * A receipt is the only durable statement about what a repair attempt actually
 * did. It is validated structurally so an incomplete attempt cannot be written
 * out as if it were a finished one, and it is scanned for secrets before it is
 * persisted.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const RECEIPT_SCHEMA_VERSION = 1;

export const FINAL_STATUS = Object.freeze([
  "VERIFIED_REPAIR",
  "FAILED_REPAIR",
  "BLOCKED",
  "HUMAN_GATE",
  "TEST_ENVIRONMENT",
  "FLAKY",
  "EXPECTED_BEHAVIOR",
]);

const REQUIRED_FIELDS = Object.freeze([
  "finding_id",
  "scenario_id",
  "revision",
  "worktree",
  "allowed_paths",
  "classification",
  "severity",
  "reproduction_result",
  "root_cause",
  "causal_chain",
  "iterations",
  "files_changed",
  "diff_summary",
  "new_regression_tests",
  "commands_run",
  "command_exit_codes",
  "original_scenario_replay",
  "critical_suite_result",
  "assertion_integrity_result",
  "isolation_result",
  "repair_capability",
  "secret_scan_result",
  "rollback",
  "unresolved_risks",
  "stop_reason",
  "final_status",
]);

/**
 * Patterns that must never appear in a textual QA artifact. Deliberately
 * narrow-but-real: long random secrets, bearer/JWT material, and named keys.
 */
const SECRET_PATTERNS = Object.freeze([
  { name: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { name: "openai-key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    // Breadboard's own config keys are camelCase (`hermesCapabilitySecret`,
    // `nextAuthSecret`), so a leading word boundary would miss exactly the
    // names most likely to reach a QA artifact. Allow any identifier prefix.
    // The value must look like a *value*, not an identifier. Source text such
    // as `apiKey: chatmockApiKeyValue` names a variable and discloses nothing,
    // and firing on it trains readers to ignore the scanner. Requiring a digit
    // or a non-identifier character keeps every realistic secret shape — random
    // hex, base64, dashed keys — while dropping bare camelCase references.
    name: "named-secret-assignment",
    pattern:
      /[A-Za-z0-9_]*(?:api_?key|secret|password|passwd|capability_?token|session_?token|access_?token|auth_?token)\s*[:=]\s*["']?(?=[A-Za-z0-9_\-./+]{12,})[A-Za-z0-9_\-./+]*(?:[0-9]|[-./+])[A-Za-z0-9_\-./+]*["']?/i,
  },
]);

/** Values the harness knows are disposable but should still never be printed. */
export function scanForSecrets(text, extraSecrets = []) {
  const hits = [];
  const value = String(text ?? "");
  for (const entry of SECRET_PATTERNS) {
    if (entry.pattern.test(value)) hits.push({ rule: entry.name });
  }
  for (const secret of extraSecrets) {
    if (typeof secret === "string" && secret.length >= 8 && value.includes(secret)) {
      hits.push({ rule: "known-run-secret" });
    }
  }
  return { clean: hits.length === 0, hits };
}

export function validateReceipt(receipt) {
  const problems = [];
  for (const field of REQUIRED_FIELDS) {
    if (!(field in (receipt ?? {}))) problems.push(`missing required field: ${field}`);
  }
  if (receipt && !FINAL_STATUS.includes(receipt.final_status)) {
    problems.push(
      `final_status ${JSON.stringify(receipt?.final_status)} is not one of ${FINAL_STATUS.join(", ")}`,
    );
  }
  if (receipt && !Array.isArray(receipt.commands_run)) {
    problems.push("commands_run must be an array");
  }
  if (receipt && !Array.isArray(receipt.command_exit_codes)) {
    problems.push("command_exit_codes must be an array");
  }
  if (
    receipt &&
    Array.isArray(receipt.commands_run) &&
    Array.isArray(receipt.command_exit_codes) &&
    receipt.commands_run.length !== receipt.command_exit_codes.length
  ) {
    problems.push("commands_run and command_exit_codes must be the same length");
  }
  if (receipt?.final_status === "VERIFIED_REPAIR") {
    if (receipt.classification !== "PRODUCT_BUG") {
      problems.push("VERIFIED_REPAIR requires classification PRODUCT_BUG");
    }
    if (receipt.original_scenario_replay?.passed !== true) {
      problems.push("VERIFIED_REPAIR requires the original scenario replay to pass");
    }
    if (!Array.isArray(receipt.new_regression_tests) || receipt.new_regression_tests.length === 0) {
      problems.push("VERIFIED_REPAIR requires at least one new regression test");
    }
    if (receipt.assertion_integrity_result?.verdict === "REJECTED") {
      problems.push("VERIFIED_REPAIR cannot carry a rejected assertion-integrity verdict");
    }
    // `files_changed` must be the repair, not the tree it ran in.
    //
    // A snapshot worktree carries the developer's whole in-flight tree, and a
    // receipt built from a raw worktree diff reported 150+ files for a repair
    // that wrote three. A verified repair can only have changed files it was
    // authorised to change, so anything outside `allowed_paths` means the
    // receipt is describing snapshot context as though the repair caused it.
    if (Array.isArray(receipt.files_changed) && Array.isArray(receipt.allowed_paths)) {
      const allowed = receipt.allowed_paths.map((entry) => String(entry).replace(/\\/g, "/"));
      const outside = receipt.files_changed
        .map((entry) => String(entry).replace(/\\/g, "/"))
        .filter((file) => !allowed.some((prefix) => file === prefix || file.startsWith(prefix + "/")));
      if (outside.length > 0) {
        problems.push(
          `files_changed reports ${outside.length} path(s) outside allowed_paths, so it is describing snapshot context rather than the repair: ${outside
            .slice(0, 5)
            .join(", ")}${outside.length > 5 ? ", …" : ""}`,
        );
      }
    }
    if (receipt.isolation_result?.verified !== true) {
      problems.push("VERIFIED_REPAIR requires verified worktree isolation");
    }
    // Week 2 (B-2): a repair that did not go through the mandatory capability
    // cannot be certified, and a capability that saw an unauthorised change is
    // proof that something wrote outside the supported path.
    if (receipt.repair_capability?.finalized !== true) {
      problems.push(
        "VERIFIED_REPAIR requires a finalized repair capability; an ungated repair cannot be certified",
      );
    }
    if ((receipt.repair_capability?.unauthorisedChanges ?? []).length > 0) {
      problems.push(
        "VERIFIED_REPAIR cannot carry unauthorised changes: the worktree was modified outside the capability",
      );
    }
    if (
      typeof receipt.repair_capability?.capabilityId !== "string" ||
      receipt.repair_capability.findingId !== receipt.finding_id
    ) {
      problems.push("the repair capability must identify itself and match this receipt's finding");
    }
  }
  return { valid: problems.length === 0, problems };
}

export function renderReceiptMarkdown(receipt) {
  const list = (values) =>
    Array.isArray(values) && values.length > 0
      ? values.map((value) => `- ${typeof value === "string" ? value : JSON.stringify(value)}`).join("\n")
      : "- (none)";
  const commands = (receipt.commands_run ?? [])
    .map((command, index) => `- \`${command}\` → exit ${receipt.command_exit_codes?.[index] ?? "?"}`)
    .join("\n");

  return `# Repair receipt: ${receipt.finding_id}

- **Scenario**: ${receipt.scenario_id}
- **Revision**: ${receipt.revision}
- **Worktree**: ${receipt.worktree}
- **Classification / severity**: ${receipt.classification} / ${receipt.severity}
- **Final status**: **${receipt.final_status}**
- **Stop reason**: ${receipt.stop_reason}
- **Iterations**: ${receipt.iterations}

## Allowed paths
${list(receipt.allowed_paths)}

## Reproduction
${receipt.reproduction_result}

## Root cause
${receipt.root_cause ?? "(not established)"}

## Causal chain
${list(receipt.causal_chain)}

## Files changed
${list(receipt.files_changed)}

\`\`\`
${receipt.diff_summary ?? ""}
\`\`\`

## New regression tests
${list(receipt.new_regression_tests)}

## Commands
${commands || "- (none)"}

## Verification
- **Original scenario replay**: ${JSON.stringify(receipt.original_scenario_replay)}
- **Critical suite**: ${JSON.stringify(receipt.critical_suite_result)}
- **Assertion integrity**: ${JSON.stringify(receipt.assertion_integrity_result)}
- **Isolation**: ${JSON.stringify(receipt.isolation_result)}
- **Secret scan**: ${JSON.stringify(receipt.secret_scan_result)}

## Rollback
${receipt.rollback}

## Unresolved risks
${list(receipt.unresolved_risks)}
`;
}

/**
 * Validate, secret-scan, and persist a receipt as JSON plus Markdown. Throws
 * rather than writing a receipt that claims more than the run established.
 */
export function writeReceipt({ receipt, outputDir, knownSecrets = [] }) {
  const validation = validateReceipt(receipt);
  if (!validation.valid) {
    throw new Error(`Refusing to write an invalid repair receipt:\n- ${validation.problems.join("\n- ")}`);
  }
  const json = `${JSON.stringify({ schemaVersion: RECEIPT_SCHEMA_VERSION, ...receipt }, null, 2)}\n`;
  const markdown = renderReceiptMarkdown(receipt);
  const scan = scanForSecrets(`${json}\n${markdown}`, knownSecrets);
  if (!scan.clean) {
    throw new Error(
      `Refusing to write a repair receipt containing secret-like material: ${scan.hits
        .map((hit) => hit.rule)
        .join(", ")}`,
    );
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `${receipt.finding_id}.receipt.json`);
  const markdownPath = path.join(outputDir, `${receipt.finding_id}.receipt.md`);
  fs.writeFileSync(jsonPath, json, "utf8");
  fs.writeFileSync(markdownPath, markdown, "utf8");
  return { jsonPath, markdownPath, secretScan: scan };
}
