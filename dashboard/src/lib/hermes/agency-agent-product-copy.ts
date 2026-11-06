// Display summaries for bundled personas. Matching original text preserves custom versions.
const SUMMARIES: Readonly<Record<string, { original: string; description: string }>> = {
  "ai-data-remediation-engineer": {
    "original": "Specialist in self-healing data pipelines — uses air-gapped local SLMs and semantic clustering to automatically detect, classify, and fix data anomalies at scale. Focuses exclusively on the remediation layer: intercepting bad data, generating deterministic fix logic via Ollama, and guaranteeing zero data loss. Not a general data engineer — a surgical specialist for when your data is broken and the pipeline can't stop.",
    "description": "Review data-quality issues and develop fixes using local models."
  },
  "email-intelligence-engineer": {
    "original": "Expert in extracting structured, reasoning-ready data from raw email threads for AI agents and automation systems",
    "description": "Extract structured information from email threads for analysis and automation."
  },
  "clinical-evidence-agent": {
    "original": "Evidence standards and clinical credibility framework for AI agents operating in healthcare contexts. Defines how to distinguish validated from unvalidated clinical claims, how to write for both peer review and investor audiences from the same evidence base, and how to frame clinical decision support without claiming diagnostic authority.",
    "description": "Review clinical evidence and claims for research and communications. Does not provide a diagnosis."
  },
  "sovereign-health-systems-agent": {
    "original": "Government health mandate engagement framework for AI agents operating at the intersection of national health infrastructure, UHC policy, and emerging market deployment. Defines how to navigate sovereign health ministry engagement, frame health technology for mandate alignment, and sequence a dual-market launch across regulated and sovereign contexts.",
    "description": "Plan health-technology policy, government engagement, and rollout across markets."
  },
  "agents-orchestrator": {
    "original": "Autonomous pipeline manager that orchestrates the entire development workflow. You are the leader of this process.",
    "description": "Coordinate coding agents through planning, implementation, and review."
  },
  "real-estate-buyer-seller": {
    "original": "Comprehensive real estate agent assistant for buyer representation, seller representation, listing management, offer negotiation, transaction coordination, and closing support — delivering a world-class client experience from first showing to final closing across residential and investment real estate",
    "description": "Help with property searches, listings, offers, negotiations, and closing preparations."
  }
};

export function agencyAgentProductDescription(agent: {slug: string; description: string}): string {
  if (!Object.hasOwn(SUMMARIES, agent.slug)) return agent.description;
  const summary = SUMMARIES[agent.slug];
  return agent.description === summary.original ? summary.description : agent.description;
}
