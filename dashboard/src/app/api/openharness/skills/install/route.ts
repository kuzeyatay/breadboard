import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
  ApiError,
} from "@/lib/openharness/route-helpers.ts";
import { searchRegistry, quarantineSkill, type SkillCandidate } from "@/lib/openharness/skills.ts";
import { recordSkillDecision } from "@/lib/openharness/runtime-store.ts";

export const dynamic = "force-dynamic";

const MAX_FILES = 40;
const MAX_FILE_BYTES = 200_000;

async function downloadCandidateFiles(candidate: SkillCandidate): Promise<Record<string, string>> {
  // Download the skill's files from its source index into memory (bounded). This
  // does NOT execute anything. The source publishes an index.json listing files.
  const base = candidate.source.endsWith("/") ? candidate.source : `${candidate.source}/`;
  const indexResponse = await fetch(new URL("index.json", base)).catch(() => null);
  if (!indexResponse || !indexResponse.ok) {
    // No reachable index — quarantine a placeholder manifest so the user still
    // sees a record and can reject it. Never fabricate an executable skill.
    return {
      "SKILL.md": `---\nname: ${candidate.name}\ndescription: ${candidate.description}\n---\n\n(Source index was unreachable; review manually before promoting.)\n`,
    };
  }
  const index = (await indexResponse.json().catch(() => ({}))) as { files?: string[] };
  const files: Record<string, string> = {};
  for (const file of (index.files ?? []).slice(0, MAX_FILES)) {
    if (typeof file !== "string" || file.includes("..")) continue;
    const fileResponse = await fetch(new URL(file, base)).catch(() => null);
    if (!fileResponse || !fileResponse.ok) continue;
    const text = (await fileResponse.text()).slice(0, MAX_FILE_BYTES);
    files[file] = text;
  }
  return files;
}

// POST: download a candidate skill into QUARANTINE and inspect it. Never
// executes, never promotes. Requires the user to have explicitly requested this
// candidate (by name). Records an auditable 'quarantined' decision.
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const body = await readJsonBody(request);
    const name = requireString(body.name, "name", 100);

    const candidate = searchRegistry(name).find((c) => c.name === name);
    if (!candidate) {
      throw new ApiError(404, "candidate_not_found", "That skill is not in the registry.");
    }

    const files = await downloadCandidateFiles(candidate);
    const report = quarantineSkill({ candidate, files });

    recordSkillDecision({
      skillName: report.name,
      sourceUrl: candidate.source,
      version: candidate.version,
      decision: "quarantined",
      decidedBy: userId,
      manifest: report,
    });

    return NextResponse.json({ report });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
