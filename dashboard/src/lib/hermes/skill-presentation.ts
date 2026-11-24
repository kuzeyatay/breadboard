import type { CapabilityUse } from "./capability-usage.ts";

export function skillUseState(use: CapabilityUse): "used" | "loaded" | "failed" | "selected" {
  if (use.calls > 0) return use.failures >= use.calls ? "failed" : "used";
  return use.guidanceLoaded ? "loaded" : "selected";
}

const PERMISSION_LABELS: Record<string, string> = {
  "filesystem-read": "Read files in the allowed workspace",
  "filesystem-write": "Create or change files in the allowed workspace",
  "garden-read": "Read Garden content",
  "garden-propose": "Propose changes to your Garden",
  network: "Access the network",
  shell: "Run commands in the allowed workspace",
  "repository-read": "Read the connected repository",
  "repository-write": "Change files in the connected repository",
  "external-service": "Use an external service",
};

export function skillPermissionLabel(permission: string): string {
  return PERMISSION_LABELS[permission] ?? permission;
}
