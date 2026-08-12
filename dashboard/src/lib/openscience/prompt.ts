// What the OpenScience agent is actually asked, and which of its harnesses
// answers.
//
// The clone ships its own research prompts — a `research` harness plus a
// read-only `plan` mode, with biology, physics, ML, critique and
// literature-review specialists it delegates to on its own. None of that is
// restated here: an instruction that duplicates the harness's own contract only
// gives the model something to disagree with. What this module adds is the
// small amount Breadboard knows and the runtime does not — that the answer is
// going into a chat, and whether the person wanted files left behind.

export type OpenscienceHarness = "research" | "plan";

export interface PromptOptions {
  /** `research` does the work; `plan` investigates without changing anything. */
  harness: OpenscienceHarness;
  /** Ask a run to leave its scripts, data and figures in the workspace. */
  deliverFiles: boolean;
}

/** The primary agents the runtime exposes. Specialists are reached by delegation. */
export const HARNESSES: readonly OpenscienceHarness[] = ["research", "plan"];

export function isHarness(value: string): value is OpenscienceHarness {
  return (HARNESSES as readonly string[]).includes(value);
}

/** A short, honest session title — the runtime lists these in its own history. */
export function sessionTitle(task: string): string {
  const cleaned = task.replace(/\s+/g, " ").trim();
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}…` : cleaned || "Research run";
}

/**
 * The turn as the runtime receives it: the goal, then the two things about its
 * surroundings it cannot infer.
 */
export function runInstruction(task: string, options: PromptOptions): string {
  const notes: string[] = [];
  notes.push(
    "Your reply is delivered straight into a chat, so end with the finding itself — what you did, what came out, and what it means — rather than a note that the work is on disk.",
  );
  if (options.deliverFiles) {
    notes.push(
      "Leave the scripts, data and figures you produce in the workspace under clear filenames; they are collected and attached to this answer.",
    );
  }
  if (options.harness === "plan") {
    notes.push(
      "Do not modify anything. Investigate and report what you would do and why.",
    );
  }
  return `${task.trim()}\n\n---\n${notes.map((note) => `- ${note}`).join("\n")}`;
}
