import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { requireEnabled } from "@/lib/openharness/route-helpers.ts";
import { SkillsShClient } from "@/lib/openharness/skills-sh-client.ts";
import { getSkillsCatalogStore } from "@/lib/openharness/skills-catalog-store.ts";
import { synchronizeSkillsCatalog } from "@/lib/openharness/skills-catalog-sync.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  await requireUserId();
  requireEnabled();
  const upstreamId = new URL(request.url).searchParams.get("id")?.trim();
  if (!upstreamId) {
    return NextResponse.json({ error: "missing_skill_id", message: "A stable skills.sh id is required." }, { status: 400 });
  }
  const store = getSkillsCatalogStore();
  let skill = store.get(upstreamId);
  if (!skill) {
    try {
      await synchronizeSkillsCatalog({ store, force: true });
      skill = store.get(upstreamId);
    } catch {
      // The not-found response below remains accurate when refresh cannot add it.
    }
  }
  if (!skill) {
    return NextResponse.json({ error: "skill_not_found", message: "That skill is not in the synchronized skills.sh catalog." }, { status: 404 });
  }
  const client = new SkillsShClient();
  try {
    const detail = await client.detail(skill.source, skill.slug);
    let audits = skill.audits ?? [];
    let auditError: string | null = null;
    try {
      audits = await client.audits(skill.source, skill.slug);
    } catch (error) {
      auditError = error instanceof Error ? error.message : "Upstream audits are unavailable.";
    }
    const updated = store.saveDetail(upstreamId, detail, audits);
    return NextResponse.json({
      skill: browserSkill(updated),
      detail,
      audits,
      auditError,
      inspectionNotice: "Upstream audits are supplementary. Breadboard review and explicit approval are still required.",
    });
  } catch (error) {
    const cached = store.get(upstreamId);
    return NextResponse.json({
      error: "skill_detail_unavailable",
      message: error instanceof Error ? error.message : "Skill details are unavailable.",
      skill: cached ? browserSkill(cached) : null,
      cached: Boolean(cached?.files),
    }, { status: cached?.files ? 200 : 502 });
  }
}

function browserSkill(skill: NonNullable<ReturnType<ReturnType<typeof getSkillsCatalogStore>["get"]>>) {
  return {
    ...skill,
    installedPath: undefined,
    files: skill.files?.map((file) => ({ path: file.path })) ?? null,
    command: `/${skill.slashCommand}`,
    description: skill.description ?? "Open to load skill details",
    descriptionLoaded: Boolean(skill.description),
  };
}
