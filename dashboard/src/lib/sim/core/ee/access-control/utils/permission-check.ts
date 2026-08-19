// Breadboard stand-in for sim's ee/access-control/utils/permission-check.ts
// (simstudioai/sim, Apache-2.0). Sim's enterprise edition resolves per-workspace
// permission groups from Postgres to deny models, blocks, MCP/custom tools and skills.
// Breadboard has no permission-group plane — every check is allow-all, which is what
// sim itself does when no group is configured.

import type { ExecutionContext } from "@/lib/sim/executor/types";

export async function validateModelProvider(
  _userId: string | undefined,
  _workspaceId: string | undefined,
  _model: string,
  _ctx?: ExecutionContext,
): Promise<void> {}

export async function validateBlockType(
  _userId: string | undefined,
  _workspaceId: string | undefined,
  _blockType: string,
  _ctx?: ExecutionContext,
): Promise<void> {}

export async function validateMcpToolsAllowed(
  _userId: string | undefined,
  _workspaceId: string | undefined,
  _ctx?: ExecutionContext,
): Promise<void> {}

export async function validateCustomToolsAllowed(
  _userId: string | undefined,
  _workspaceId: string | undefined,
  _ctx?: ExecutionContext,
): Promise<void> {}

export async function validateSkillsAllowed(
  _userId: string | undefined,
  _workspaceId: string | undefined,
  _ctx?: ExecutionContext,
): Promise<void> {}
