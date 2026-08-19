// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/lib/permission-groups/types.ts
// (PermissionGroupConfig only); adapted for Breadboard. The group-resolution layer is
// Postgres-coupled and was not vendored: Breadboard's permission checks are allow-all
// (core/ee/access-control/utils/permission-check), so no config is ever produced.

export type ShareAuthType = string;

export interface PermissionGroupConfig {
  allowedIntegrations: string[] | null;
  allowedModelProviders: string[] | null;
  deniedModels: string[];
  deniedTools: string[];
  hideTraceSpans: boolean;
  hideKnowledgeBaseTab: boolean;
  hideTablesTab: boolean;
  hideCopilot: boolean;
  hideIntegrationsTab: boolean;
  hideSecretsTab: boolean;
  hideApiKeysTab: boolean;
  hideInboxTab: boolean;
  hideFilesTab: boolean;
  disableMcpTools: boolean;
  disableCustomTools: boolean;
  disableSkills: boolean;
  disableInvitations: boolean;
  disablePublicApi: boolean;
  disablePublicFileSharing: boolean;
  allowedFileShareAuthTypes: ShareAuthType[] | null;
  hideDeployApi: boolean;
  hideDeployMcp: boolean;
  hideDeployChatbot: boolean;
  allowedChatDeployAuthTypes: ShareAuthType[] | null;
}
