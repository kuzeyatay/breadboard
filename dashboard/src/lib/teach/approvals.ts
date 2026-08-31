// Where a learned workflow must stop and ask.
//
// Approval boundaries come from two places and the union always wins. The
// user's narration can create one ("always ask me before I click Submit"),
// which the induction model turns into an approval on the step. And a fixed
// policy here marks the classically consequential actions -- sending, buying,
// deleting, publishing, overwriting -- whether or not anyone said so, because a
// demonstration is one person's afternoon and a replay is an unattended agent.
//
// Policy can add boundaries. Nothing in the pipeline may remove one.

import type { DemonstratedProcedure, WorkflowStep } from "./types.ts";

/**
 * Words that mean the click commits something beyond the local screen.
 * Matched against the step's target and instruction, lower-cased.
 */
const CONSEQUENTIAL_TARGET_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bsend\b|\bsend\s+message\b/, reason: "This sends a message." },
  { pattern: /\bsubmit\b/, reason: "This submits a form." },
  { pattern: /\bbuy\b|\bpurchase\b|\bcheckout\b|\bplace\s+order\b|\border\s+now\b/, reason: "This makes a purchase." },
  { pattern: /\bpay\b|\bpayment\b|\btransfer\b|\bwire\b/, reason: "This moves money." },
  { pattern: /\bdelete\b|\bremove\s+permanently\b|\berase\b/, reason: "This deletes data." },
  { pattern: /\bpublish\b|\bpost\b|\btweet\b|\bshare\s+publicly\b/, reason: "This publishes content." },
  { pattern: /\boverwrite\b|\breplace\s+existing\b/, reason: "This overwrites an existing file." },
  { pattern: /\bunsubscribe\b|\bcancel\s+account\b|\bclose\s+account\b/, reason: "This changes an account." },
  { pattern: /\bpassword\b|\bsecurity\s+settings?\b|\btwo[- ]factor\b/, reason: "This changes security settings." },
  { pattern: /\bconfirm\s+(order|purchase|payment|delete|deletion)\b/, reason: "This confirms a consequential action." },
];

/** Shell fragments that are destructive however they are spelled around. */
const DESTRUCTIVE_SHELL_PATTERNS: ReadonlyArray<RegExp> = [
  /\brm\s+-\w*r/i,
  /\brmdir\b/i,
  /\bremove-item\b/i,
  /\bdel\s+\/[sq]/i,
  /\bformat\b/i,
  /\bmkfs\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\b/i,
  /\bgit\s+push\s+--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bshutdown\b/i,
];

export interface ApprovalClassification {
  required: boolean;
  reason?: string;
}

export function classifyStepForApproval(
  step: Pick<WorkflowStep, "action" | "target" | "instruction" | "actionArgs" | "route">,
): ApprovalClassification {
  const haystack = [step.target, step.instruction, step.actionArgs?.text]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (step.route === "shell" || step.action === "run") {
    const command = (step.actionArgs?.command ?? haystack).toLowerCase();
    for (const pattern of DESTRUCTIVE_SHELL_PATTERNS) {
      if (pattern.test(command)) {
        return { required: true, reason: "This runs a destructive shell operation." };
      }
    }
  }

  // Only an action that commits can be consequential; reading and typing are
  // preparation. The click (or Enter) is where the boundary belongs, which is
  // also where a person would pause.
  const commits =
    step.action === "click" ||
    step.action === "run" ||
    (step.action === "key" && (step.actionArgs?.key ?? "").toLowerCase() === "enter");
  if (!commits) return { required: false };

  for (const { pattern, reason } of CONSEQUENTIAL_TARGET_PATTERNS) {
    if (pattern.test(haystack)) return { required: true, reason };
  }
  return { required: false };
}

/**
 * Apply policy on top of what induction produced. Narration-derived approvals
 * survive untouched; policy fills in the ones nobody thought to say aloud.
 */
export function ensureApprovalBoundaries(procedure: DemonstratedProcedure): DemonstratedProcedure {
  const approvals = [...procedure.approvals];
  const known = new Set(approvals.map((approval) => approval.stepId));

  const steps = procedure.steps.map((step) => {
    if (step.approvalRequired) {
      if (!known.has(step.id)) {
        approvals.push({
          stepId: step.id,
          reason: step.approvalReason ?? "The demonstration marked this step as needing approval.",
          source: "narration",
        });
        known.add(step.id);
      }
      return step;
    }
    const classification = classifyStepForApproval(step);
    if (!classification.required) return step;
    if (!known.has(step.id)) {
      approvals.push({
        stepId: step.id,
        reason: classification.reason ?? "This action is consequential.",
        source: "policy",
      });
      known.add(step.id);
    }
    return {
      ...step,
      approvalRequired: true,
      approvalReason: step.approvalReason ?? classification.reason,
    };
  });

  return { ...procedure, steps, approvals };
}
