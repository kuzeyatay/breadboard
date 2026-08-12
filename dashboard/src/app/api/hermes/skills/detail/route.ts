import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { SkillsShClient } from "@/lib/hermes/skills-sh-client.ts";
import { getSkillsCatalogStore } from "@/lib/hermes/skills-catalog-store.ts";
import { synchronizeSkillsCatalog } from "@/lib/hermes/skills-catalog-sync.ts";
import { ApiError, apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import {
  getLocalReviewedSkill,
  isReviewedLocalSource,
  SCIENTIFIC_SKILLS_SOURCE,
  REVERSE_SKILLS_SOURCE,
  synchronizeLocalSkillsCatalogs,
} from "@/lib/hermes/local-skills-sources.ts";
import {
  classifySkill,
} from "@/lib/hermes/skills.ts";
import {
  resolveSkillCompatibility,
} from "@/lib/hermes/skill-compatibility.ts";
import { listMcpConnections } from "@/lib/hermes/mcp-connections.ts";
import type { HermesSurface } from "@/lib/hermes/config.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
  const url = new URL(request.url);
  const upstreamId = url.searchParams.get("id")?.trim();
  const surface = parseSurface(url.searchParams.get("surface"));
  const connectedMcpServers = listMcpConnections(userId, true).map(
    (connection) => connection.slug,
  );
  if (!upstreamId) {
    return NextResponse.json({ error: "missing_skill_id", message: "A stable skills.sh id is required." }, { status: 400 });
  }
  const store = getSkillsCatalogStore();
  synchronizeLocalSkillsCatalogs({ store });
  let skill = store.get(upstreamId);
  if (!skill) {
    try {
      await synchronizeSkillsCatalog({ store, force: true, includeLocalSources: true });
      skill = store.get(upstreamId);
    } catch {
      // The not-found response below remains accurate when refresh cannot add it.
    }
  }
  if (!skill) {
    return NextResponse.json({ error: "skill_not_found", message: "That skill is not in the synchronized catalog." }, { status: 404 });
  }
  const local = getLocalReviewedSkill(upstreamId);
  if (local) {
    const updated = store.saveDetail(upstreamId, local.detail, skill.audits ?? []);
    return NextResponse.json({
      skill: browserSkill(updated, surface, connectedMcpServers),
      detail: local.detail,
      audits: updated.audits ?? [],
      auditError: null,
      inspectionNotice: local.binaryPaths.length
        ? `Loaded from the local ${local.label} at ${local.revision.slice(0, 12)}. ${local.binaryPaths.length} binary asset${local.binaryPaths.length === 1 ? " is" : "s are"} listed without an inline preview; review still uses the original files.`
        : `Loaded from the local ${local.label} at ${local.revision.slice(0, 12)}. Breadboard review and explicit approval are still required.`,
    });
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
      skill: browserSkill(updated, surface, connectedMcpServers),
      detail,
      audits,
      auditError,
      inspectionNotice: "Upstream audits are supplementary. Breadboard review and explicit approval are still required.",
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const cached = store.get(upstreamId);
    return NextResponse.json({
      error: "skill_detail_unavailable",
      message: error instanceof Error ? error.message : "Skill details are unavailable.",
      skill: cached ? browserSkill(cached, surface, connectedMcpServers) : null,
      cached: Boolean(cached?.files),
    }, { status: cached?.files ? 200 : 502 });
  }
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function browserSkill(
  skill: NonNullable<ReturnType<ReturnType<typeof getSkillsCatalogStore>["get"]>>,
  surface: HermesSurface,
  connectedMcpServers: Iterable<string>,
) {
  const manifest =
    skill.files?.find((file) => /^SKILL\.md$/i.test(file.path))?.contents ??
    "";
  const classification = classifySkill({
    name: skill.name || skill.slug,
    description: skill.description ?? undefined,
    repository: skill.source,
    manifest,
  });
  const compatibility = resolveSkillCompatibility({
    classification: classification.classification,
    manifest,
    name: skill.name || skill.slug,
    description: skill.description ?? undefined,
    surface,
    connectedMcpServers,
    reviewedScientificSource: skill.source === SCIENTIFIC_SKILLS_SOURCE,
    reviewedReverseSource: skill.source === REVERSE_SKILLS_SOURCE,
    reviewedLocalSource: isReviewedLocalSource(skill.source),
  });
  return {
    ...skill,
    installedPath: undefined,
    files: skill.files?.map((file) => ({ path: file.path })) ?? null,
    command: `/${skill.slashCommand}`,
    description: skill.description ?? (skill.detailCheckedAt ? "No description was provided by the publisher." : ""),
    descriptionLoaded: Boolean(skill.description || skill.detailCheckedAt),
    classification,
    ...compatibility,
    requiresOpenCode:
      classification.classification === "eligible_coding_conditional",
  };
}

function parseSurface(value: string | null): HermesSurface {
  return value === "garden_chat" ||
    value === "quartz_ai" ||
    value === "dashboard_terminal"
    ? value
    : "dashboard_terminal";
}
