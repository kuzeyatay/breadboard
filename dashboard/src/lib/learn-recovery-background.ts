import "server-only";

import { submitRuntimeLearnRecoveryJob } from "@/lib/supervisor-control";

const RECOVERY_GENERATION_MS = 5 * 60_000;

const globalState = globalThis as typeof globalThis & {
  __breadboardLearnRecoverySubmission?: Promise<void>;
};

function recoveryIdempotencyKey(now = Date.now()): string {
  const generation = Math.floor(now / RECOVERY_GENERATION_MS);
  return `learn-recovery-v2:${generation}`;
}

async function submitRecoverySweep(): Promise<void> {
  await submitRuntimeLearnRecoveryJob(recoveryIdempotencyKey());
}

/**
 * Submit startup/stale-job recovery to the native Runtime V2 owner. Repeated
 * minute sweeps collapse into one durable five-minute generation, so a
 * dashboard recycle cannot duplicate the heavyweight recovery process and no
 * long-lived JavaScript process owns or detaches a child.
 */
export function launchAbandonedLearnRecoveryWorker(): Promise<void> {
  const configuredContentPath = process.env.QUARTZ_CONTENT_PATH?.trim();
  if (!configuredContentPath) return Promise.resolve();
  const existing = globalState.__breadboardLearnRecoverySubmission;
  if (existing) return existing;

  const submission = submitRecoverySweep();
  globalState.__breadboardLearnRecoverySubmission = submission;
  void submission.then(
    () => {
      if (globalState.__breadboardLearnRecoverySubmission === submission) {
        delete globalState.__breadboardLearnRecoverySubmission;
      }
    },
    () => {
      if (globalState.__breadboardLearnRecoverySubmission === submission) {
        delete globalState.__breadboardLearnRecoverySubmission;
      }
    },
  );
  return submission;
}

export const learnRecoveryGenerationForTests = recoveryIdempotencyKey;
