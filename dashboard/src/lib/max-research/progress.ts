// Public milestones only. Worker output, prompts and model reasoning are never
// used as progress copy. Replaying durable events reconstructs the same timeline.
export const MAX_RESEARCH_PROGRESS_EVENTS = [
  "run.started", "plan.started", "plan.completed", "wave.started", "wave.completed",
  "participant.started", "participant.retrying", "participant.unavailable",
  "participant.settled", "synthesis.started", "review.started", "review.completed",
  "review.skipped", "run.completed", "run.failed", "run.aborted",
] as const;

export const MAX_RESEARCH_PARTICIPANT_LABELS: Record<string, string> = {
  deep_research: "Deep Research", agent_reach: "Agent Reach", get_doc: "Get Doc",
  feynman: "Feynman", openscience: "OpenScience", praxist: "Praxist", aris: "ARIS",
};

const START_NOTES: Record<string, string> = {
  deep_research: "Deep Research is searching the web and following up on sources.",
  agent_reach: "Agent Reach is checking discussions, videos, and practitioner reports.",
  get_doc: "Get Doc is finding academic papers and available full texts.",
  feynman: "Feynman is finding and ranking relevant papers for evidence screening.",
  openscience: "OpenScience is investigating the question using the collected evidence.",
  praxist: "Praxist is running its research task against the available evidence.",
  aris: "ARIS is reviewing methods, evidence gaps, and competing explanations.",
};

export interface MaxResearchProgress {
  stage: string;
  notes: string[];
}

export const INITIAL_MAX_RESEARCH_PROGRESS: MaxResearchProgress = { stage: "Starting", notes: [] };

export function advanceMaxResearchProgress(
  current: MaxResearchProgress,
  type: string,
  payload: Record<string, unknown>,
): MaxResearchProgress {
  let stage = current.stage;
  let note = "";
  const name = typeof payload.participant === "string" && Object.hasOwn(MAX_RESEARCH_PARTICIPANT_LABELS, payload.participant)
    ? MAX_RESEARCH_PARTICIPANT_LABELS[payload.participant] : undefined;
  switch (type) {
    case "run.started":
    case "plan.started":
      stage = "Planning the research";
      note = "Planning the research and checking which specialist agents are available.";
      break;
    case "plan.completed": {
      stage = "Research plan ready";
      const names = Array.isArray(payload.participants) ? payload.participants.flatMap((entry) => {
        const id = entry && typeof entry === "object" ? entry.participant : undefined;
        return typeof id === "string" && Object.hasOwn(MAX_RESEARCH_PARTICIPANT_LABELS, id)
          ? [MAX_RESEARCH_PARTICIPANT_LABELS[id]] : [];
      }) : [];
      note = names.length ? `Research plan ready. Assigning work to ${names.join(", ")}.` : "The research plan is ready.";
      break;
    }
    case "wave.started": {
      const wave = typeof payload.wave === "number" ? payload.wave : 0;
      stage = wave === 0 ? "Gathering sources" : "Investigating the evidence";
      note = wave === 0
        ? "Starting source collection across the research agents."
        : `Starting research round ${wave + 1}, using findings from the earlier agents.`;
      break;
    }
    case "wave.completed":
      note = typeof payload.wave === "number" ? `Research round ${payload.wave + 1} has finished.` : "The research round has finished.";
      break;
    case "participant.started":
      if (!name) return current;
      if (["Starting", "Planning the research", "Research plan ready"].includes(stage)) stage = "Researching";
      // Parallel participants share the wave's stage; one starting or finishing
      // must not imply its siblings have changed phase.
      note = START_NOTES[String(payload.participant)];
      break;
    case "participant.retrying":
      if (!name) return current;
      note = `${name} is waiting for capacity before trying to start again.`;
      break;
    case "participant.unavailable":
      if (!name) return current;
      note = `${name} is unavailable for this run.`;
      break;
    case "participant.settled":
      if (!name) return current;
      if (payload.status === "completed") {
        const pages = Array.isArray(payload.websites) ? payload.websites.length : 0;
        const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts.length : 0;
        const details = [pages ? `${pages} source ${pages === 1 ? "page" : "pages"}` : "",
          artifacts ? `${artifacts} saved ${artifacts === 1 ? "artifact" : "artifacts"}` : ""].filter(Boolean);
        note = `${name} has finished${details.length ? ` with ${details.join(" and ")}` : ""}.`;
      } else if (payload.status === "unavailable") note = `${name} is unavailable for this run.`;
      else if (payload.status === "failed") note = `${name} could not complete its part of the research.`;
      else if (payload.status === "aborted") note = `${name} was stopped before finishing.`;
      break;
    case "synthesis.started":
      stage = "Reconciling the findings";
      note = "Comparing the collected findings, resolving disagreements, and drafting the research answer.";
      break;
    case "review.started":
      stage = "Checking evidence and citations";
      note = "Checking the draft against the evidence, citations, and the original request.";
      break;
    case "review.completed":
      stage = "Finalizing the research";
      note = payload.revised === true ? "The final evidence check is complete and the answer has been revised." : "The final evidence check is complete.";
      break;
    case "review.skipped":
      stage = "Finalizing the research";
      note = "The final evidence check could not be completed. Keeping the research draft.";
      break;
    case "run.completed":
      stage = "Done";
      note = "Max Research has finished and returned its findings.";
      break;
    case "run.failed":
      stage = "Failed";
      note = "Max Research could not finish the research answer.";
      break;
    case "run.aborted":
      stage = "Stopped";
      note = payload.interrupted === true ? "Max Research was interrupted." : "Max Research was stopped.";
      break;
    default: return current;
  }
  // Admission retries and replayed snapshots should not flood the disclosure.
  const notes = note && !current.notes.includes(note) ? [...current.notes, note].slice(-80) : current.notes;
  return stage === current.stage && notes === current.notes ? current : { stage, notes };
}
