/** Shared with the editor; keep this module free of server imports. */
export const MAX_SYSTEM_PROMPT_LENGTH = 64_000;

export interface SystemPromptDefinition {
  id: string;
  title: string;
  group: string;
  description: string;
  source: string;
  defaultContent: string;
  scope?: "account" | "installation";
}

export interface SystemPromptView extends SystemPromptDefinition {
  content: string;
  customized: boolean;
  revision: number;
  updatedAt: string | null;
  editable?: boolean;
  installationOwner?: "unclaimed" | "you" | "other-account";
}

export interface SystemPromptEdit {
  id: string;
  content: string | null;
  revision: number;
}
