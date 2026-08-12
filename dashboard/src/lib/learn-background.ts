import "server-only";

import { after } from "next/server";

const LEARN_BACKGROUND_HANDOFF_MS = 25;

type SettledLearnTask<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

export type LearnTaskHandoff<T> =
  | { accepted: true }
  | { accepted: false; value: T };

/**
 * Let fast validation failures keep normal HTTP error semantics, then hand a
 * genuinely long Learn run to Next's post-response lifecycle. The pipeline has
 * already created its durable job and acquired its lease before its first model
 * await, so status polling and Stop work as soon as the 202 response arrives.
 */
export async function handOffLearnTask<T>(
  task: Promise<T>,
  label: string,
): Promise<LearnTaskHandoff<T>> {
  const settled = task.then<SettledLearnTask<T>, SettledLearnTask<T>>(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  );
  const initial = await Promise.race<SettledLearnTask<T> | null>([
    settled,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), LEARN_BACKGROUND_HANDOFF_MS);
    }),
  ]);

  if (initial) {
    if (!initial.ok) throw initial.error;
    return { accepted: false, value: initial.value };
  }

  after(async () => {
    const final = await settled;
    if (!final.ok) {
      // The pipeline persists its own failed/cancelled state. This log is for
      // operators; the UI learns the same outcome through status polling.
      console.error(`[learn] Background ${label} failed:`, final.error);
    }
  });
  return { accepted: true };
}
