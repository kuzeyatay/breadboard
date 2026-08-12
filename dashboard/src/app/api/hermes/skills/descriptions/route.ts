import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { SkillsShClient } from "@/lib/hermes/skills-sh-client.ts";
import {
  getSkillsCatalogStore,
  type CatalogSkillRecord,
} from "@/lib/hermes/skills-catalog-store.ts";
import {
  getLocalReviewedSkill,
  synchronizeLocalSkillsCatalogs,
} from "@/lib/hermes/local-skills-sources.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_DESCRIPTION_BATCH = 6;

export async function POST(request: Request) {
  await requireUserId();
  requireEnabled();
  const body = await request.json().catch(() => null) as { ids?: unknown } | null;
  if (!body || !Array.isArray(body.ids) || body.ids.length > MAX_DESCRIPTION_BATCH) {
    return NextResponse.json({
      error: "invalid_skill_ids",
      message: `Provide up to ${MAX_DESCRIPTION_BATCH} synchronized skill ids.`,
    }, { status: 400 });
  }
  if (body.ids.some((value) => typeof value !== "string" || !value.trim() || value.length > 500)) {
    return NextResponse.json({
      error: "invalid_skill_ids",
      message: "Every skill id must be a non-empty catalog id.",
    }, { status: 400 });
  }
  const ids = [...new Set((body.ids as string[]).map((value) => value.trim()))];
  const store = getSkillsCatalogStore();
  synchronizeLocalSkillsCatalogs({ store });
  let client: SkillsShClient | null = null;
  const skills = await Promise.all(ids.map(async (upstreamId) => {
    const existing = store.get(upstreamId);
    if (!existing) {
      return {
        upstreamId,
        description: "This skill is no longer present in the synchronized catalog.",
        descriptionLoaded: true,
      };
    }
    if (existing.description || existing.detailCheckedAt) return publicDescription(existing);
    try {
      const local = getLocalReviewedSkill(upstreamId);
      const detail = local?.detail ?? await (client ??= new SkillsShClient()).detail(existing.source, existing.slug);
      return publicDescription(store.saveDescription(upstreamId, detail));
    } catch {
      return {
        upstreamId,
        description: "Description is temporarily unavailable from the publisher.",
        descriptionLoaded: true,
      };
    }
  }));
  return NextResponse.json({ skills });
}

function publicDescription(skill: CatalogSkillRecord) {
  return {
    upstreamId: skill.upstreamId,
    description: skill.description ?? "No description was provided by the publisher.",
    descriptionLoaded: true,
  };
}
