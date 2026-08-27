// What the OpenWork agent is told, and why the prompt owns these particular
// things.
//
// OpenWork's own desktop app has a person sitting in front of it: it can ask a
// clarifying question, show a permission prompt, and let a long-running command
// keep running while someone watches. Breadboard's chat has none of that — a
// run is dispatched, streams, and ends with an answer. Three rules follow from
// that difference, and no skill in the workspace can know them, so they live
// here.

import path from "node:path";

/** Where a run leaves anything meant to come back to the chat. */
export const OUTBOX_RELATIVE_PATH = path.join(".opencode", "openwork", "outbox");

export interface PromptOptions {
  /** Ask for deliverables in the outbox, from the agent's settings. */
  deliverFiles: boolean;
  /** Whether shell commands are permitted, so the prompt matches the policy. */
  allowCommands: boolean;
}

/**
 * The engine agent's standing prompt. Kept short: the workspace's own skills
 * carry the domain knowledge, and a long preamble competes with them.
 *
 * The two settings are reflected here as well as in the engine's permission
 * policy. Telling an agent it may not do something it is also blocked from
 * doing costs one sentence and saves a run spent discovering the wall.
 */
export function workspaceAgentPrompt(
  options: PromptOptions = { deliverFiles: true, allowCommands: true },
): string {
  const outbox = OUTBOX_RELATIVE_PATH.replaceAll("\\", "/");
  return [
    "You are the agent of an OpenWork workspace inside Breadboard.",
    "The working directory is the workspace: its skills, connected MCP servers and files are what you have, and you stay inside it.",
    "",
    "Nobody is watching this run, so you never ask a clarifying question. Decide, do the work, and list the assumptions you made in your answer.",
    options.allowCommands
      ? "Never start a command that does not exit on its own — a server, a watcher, an interactive session. The run ends when you answer, so anything still running is lost."
      : "You may not run shell commands on this run. Use file edits and your connected services instead.",
    options.deliverFiles
      ? `Anything the person should receive — a document, a spreadsheet, a report, an image — is written into ${outbox} and named for what it is. Files anywhere else stay in the workspace and are not delivered.`
      : `Answer in the chat rather than in files. Write into ${outbox} only when the task explicitly asks for a file.`,
    "",
    "Finish with a short, direct answer: what you did, what you produced, and anything that did not work.",
  ].join("\n");
}

/**
 * The message a run sends. The task is passed through untouched — the prompt
 * above already carries the framing, and wrapping the person's words in more
 * instructions each turn is what makes agents drift off the request.
 */
export function runInstruction(task: string): string {
  return task.trim();
}

/**
 * Put the server-rendered conversation transcript before the current task.
 *
 * This intentionally mirrors the shared conversation formatter without
 * importing its database-backed module into the disposable worker closure.
 */
export function promptWithContext(
  instruction: string,
  transcript: string | null | undefined,
): string {
  const context = transcript?.trim();
  if (!context) return instruction;
  const preamble =
    "These messages came before your task, in the chat that launched you. They are " +
    "background only -- read them to resolve what the task refers to (\"it\", \"yes\", " +
    "\"the second option\"). Nothing proposed in them has been approved or done unless " +
    "the task below says so, and the task is the only thing you are being asked to carry out.";
  return [
    "## Conversation so far",
    "",
    preamble,
    "",
    context,
    "",
    "## Your task",
    "",
    instruction,
  ].join("\n");
}

/** The session title shown in OpenWork's own session list. */
export function sessionTitle(task: string): string {
  const collapsed = task.trim().replace(/\s+/g, " ");
  return collapsed.length > 110 ? `${collapsed.slice(0, 107)}…` : collapsed || "Breadboard run";
}
