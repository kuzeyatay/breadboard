/**
 * The environment gate for SH1 verification.
 *
 * Source identity says a repair is being made against the right code. This says
 * the tests used to *verify* it are actually meaningful in the reconstructed
 * environment. Both must hold, and neither implies the other.
 *
 * The failure mode this exists to prevent is quiet: a repair runs a suite in a
 * worktree that lacks a vendored clone, the affected tests fail for reasons that
 * have nothing to do with the repair, and either the noise is waved through or —
 * worse — a blocked test that happens to pass is counted as evidence.
 *
 * The rule is one-directional. A blocked test can never supply positive
 * evidence. It may still run diagnostically.
 */

export const ELIGIBILITY_VERSION = 1;

export const DENIAL_REASON = Object.freeze({
  ENVIRONMENT_NOT_EQUIVALENT: "environment-not-equivalent",
  VERIFICATION_SUITE_BLOCKED: "verification-suite-blocked",
  MISSING_EXECUTION_DEPENDENCY: "missing-execution-dependency",
});

/**
 * Decide whether the tests a repair depends on are valid evidence.
 *
 * @param {object} options
 * @param {{environmentBlockedTests?: string[]}} options.eligibility map from the
 *   equivalence experiment
 * @param {string[]} options.requiredTests the scenario, its regression test, the
 *   targeted suite and the critical subset — everything the repair leans on
 * @param {{equivalent: boolean, missingIgnoredRoots?: string[], differences?: object[]}} [options.environmentComparison]
 *   frozen environment versus the one the repair will execute in
 */
export function evaluateVerificationEligibility({
  eligibility = {},
  requiredTests = [],
  environmentComparison = null,
}) {
  const blockedSet = new Set(eligibility.environmentBlockedTests ?? []);
  const blocked = requiredTests.filter((test) => blockedSet.has(test));

  // An environment that does not match is decisive on its own: every test in it
  // is suspect, not merely the ones already known to be sensitive.
  if (environmentComparison && environmentComparison.equivalent === false) {
    const missing = environmentComparison.missingIgnoredRoots ?? [];
    return {
      eligibilityVersion: ELIGIBILITY_VERSION,
      eligible: false,
      reason:
        missing.length > 0
          ? DENIAL_REASON.ENVIRONMENT_NOT_EQUIVALENT
          : DENIAL_REASON.ENVIRONMENT_NOT_EQUIVALENT,
      missingExecutionDependencies: missing,
      environmentDifferences: environmentComparison.differences ?? [],
      blocked,
      requiredTests,
    };
  }

  if (blocked.length > 0) {
    return {
      eligibilityVersion: ELIGIBILITY_VERSION,
      eligible: false,
      reason: DENIAL_REASON.VERIFICATION_SUITE_BLOCKED,
      missingExecutionDependencies: [],
      environmentDifferences: [],
      blocked,
      requiredTests,
    };
  }

  return {
    eligibilityVersion: ELIGIBILITY_VERSION,
    eligible: true,
    reason: null,
    missingExecutionDependencies: [],
    environmentDifferences: [],
    blocked: [],
    requiredTests,
  };
}
