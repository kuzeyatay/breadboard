"use client";

// One garden owns one assistant surface. Keeping this wrapper preserves the
// existing garden routes while ensuring runtime health cannot swap in a second
// launcher with a different identity.

import GardenAssistant from "@/app/garden/garden-assistant";

interface ActiveMarkdown {
  cluster: string;
  slug: string;
  title?: string;
  content?: string;
  loading?: boolean;
}

interface Props {
  activeClusterSlug: string | null;
  activeClusterName?: string;
  activeMarkdown?: ActiveMarkdown | null;
  initialOpen?: boolean;
}

export default function GardenAssistantSwitch(props: Props) {
  // Keep one stable Quartz AI entry point regardless of runtime-health changes.
  return <GardenAssistant {...props} />;
}
