export const PAPER_ORCHESTRA_COMMAND = "/agents:paper-orchestra";
export const PAPER_ORCHESTRA_AGENT_ID = "paper-orchestra";
export const PAPER_ORCHESTRA_AGENT_NAME = "PaperOrchestra";

export type PaperTemplate = "iclr2025" | "cvpr2025";

export interface PaperOrchestraRequest {
  /** The idea and results in the person's words, flags removed. */
  brief: string;
  template: PaperTemplate;
  /** Draw plots/diagrams. Plots run model-written matplotlib code. */
  plotting: boolean;
}

/** The task with the command token removed; other stacked tokens stay in front. */
export function taskFromPaperOrchestraCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:paper-orchestra") selected = true;
    else precedingTokens.push(`/${match[1]}`);
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

/** `--cvpr`/`--iclr` pick the template, `--plots` turns on figure drawing. */
export function parsePaperOrchestraTask(task: string): PaperOrchestraRequest {
  let template: PaperTemplate = "iclr2025";
  let plotting = false;
  const brief = task
    .replace(/(^|\s)--(cvpr|iclr|plots)(?=\s|$)/gi, (_whole, lead: string, flag: string) => {
      const name = flag.toLowerCase();
      if (name === "cvpr") template = "cvpr2025";
      else if (name === "iclr") template = "iclr2025";
      else plotting = true;
      return lead;
    })
    .replace(/\s+/g, " ")
    .trim();
  return { brief, template, plotting };
}

export function paperOrchestraUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${PAPER_ORCHESTRA_COMMAND} ${trimmed}` : PAPER_ORCHESTRA_COMMAND;
}
