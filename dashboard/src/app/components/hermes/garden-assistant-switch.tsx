'use client';

// One garden owns one assistant surface. Keeping this wrapper preserves the
// existing garden routes while ensuring runtime health cannot swap in a second
// launcher with a different identity.

import GardenAssistant from '@/app/garden/garden-assistant';
import type {
  QuartzAssistantSelectionRequest,
  QuartzInlineAnswerStopRequest,
  QuartzInlineAnswerUpdate,
} from '@/lib/quartz-assistant-selection';

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
  selectedTextRequest?: QuartzAssistantSelectionRequest | null;
  inlineAnswerStopRequest?: QuartzInlineAnswerStopRequest | null;
  onInlineAnswerUpdate?: (update: QuartzInlineAnswerUpdate) => void;
  initialOpen?: boolean;
  launcherHidden?: boolean;
}

export default function GardenAssistantSwitch(props: Props) {
  // Keep one stable Assistant entry point regardless of runtime-health changes.
  return <GardenAssistant {...props} />;
}
