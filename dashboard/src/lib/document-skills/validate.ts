// Server-facing adapter for the clone's SKILL.md auditor. The Python process
// itself is owned by the disposable Runtime V2 Office worker; this module only
// supplies authenticated scope and a sealed SKILL.md input.

import {
  validateDocumentSkillViaRuntime,
  type RuntimeSkillValidation,
  type RuntimeV2OfficeScope,
} from "../office/runtime-v2.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { skillDirectory } from "./store.ts";

export type SkillValidation = RuntimeSkillValidation;

export async function validateGeneratedSkill(
  slug: string,
  scope: RuntimeV2OfficeScope,
  signal?: AbortSignal,
): Promise<SkillValidation> {
  const skillFile = path.join(skillDirectory(slug), "SKILL.md");
  if (!fs.existsSync(skillFile)) return { ran: false, ok: true, warnings: [] };
  return validateDocumentSkillViaRuntime(scope, skillFile, {
    idempotencySeed: `${slug}:validate`,
    signal,
  });
}
