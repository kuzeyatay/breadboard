import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { classifySkill, isCatalogSkillInspectable } from "@/lib/hermes/skills.ts";
import { resolveSkillCompatibility } from "@/lib/hermes/skill-compatibility.ts";
import type { HermesSurface } from "@/lib/hermes/config.ts";
import { SkillsShClient } from "@/lib/hermes/skills-sh-client.ts";
import { getSkillsCatalogStore } from "@/lib/hermes/skills-catalog-store.ts";
import { revalidateSkillsCatalogInBackground } from "@/lib/hermes/skills-catalog-sync.ts";
import {
  SCIENTIFIC_SKILLS_SOURCE,
  isReviewedLocalSource,
  synchronizeLocalSkillsCatalogs,
} from "@/lib/hermes/local-skills-sources.ts";
import { recordAuditEvent } from "@/lib/hermes/runtime-store.ts";
import { listMcpConnections } from "@/lib/hermes/mcp-connections.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const userId = await requireUserId();
  requireEnabled();
  const connectedMcpServers = listMcpConnections(userId, true).map(
    (connection) => connection.slug,
  );
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim().slice(0, 200) ?? "";
  const surface: HermesSurface = url.searchParams.get("surface") === "garden_chat"
    ? "garden_chat"
    : url.searchParams.get("surface") === "quartz_ai"
      ? "quartz_ai"
      : "dashboard_terminal";
  if (!query) return NextResponse.json({ skills: [], candidates: [], stale: false, provider: "skills.sh/api/v1" });
  const store = getSkillsCatalogStore();
  synchronizeLocalSkillsCatalogs({ store });
  let stale = false;
  let message: string | null = null;
  let records = [] as ReturnType<typeof store.list>["skills"];
  try {
    const remote = await new SkillsShClient().search(query, 200);
    const mirrored = new Map(
      store.list({ ids: remote.map((skill) => skill.id), perPage: 100 }).skills.map((skill) => [skill.upstreamId, skill]),
    );
    records = remote.map((skill) => mirrored.get(skill.id) ?? {
      upstreamId: skill.id,
      source: skill.source,
      slug: skill.slug,
      name: skill.name,
      slashCommand: skill.slug,
      sourceType: skill.sourceType,
      installUrl: skill.installUrl,
      pageUrl: skill.url,
      installs: skill.installs,
      duplicate: skill.duplicate,
      curated: false,
      rankAllTime: null,
      rankTrending: null,
      rankHot: null,
      description: null,
      upstreamHash: null,
      approvedHash: null,
      quarantineLocalHash: null,
      catalogRevision: null,
      localHash: null,
      installedPath: null,
      reviewStatus: "unreviewed",
      installationStatus: "not_installed",
      updateStatus: "not_installed",
      upstreamStatus: "available",
      lastSeenAt: "",
      lastSynchronizedAt: "",
      detailCheckedAt: null,
      files: null,
      audits: null,
    });
    const localMatches = store.list({ query, page: 0, perPage: 100 }).skills
      .filter((skill) => isReviewedLocalSource(skill.source));
    const seen = new Set(records.map((skill) => skill.upstreamId));
    records.push(...localMatches.filter((skill) => !seen.has(skill.upstreamId)));
    if (records.some((skill) => !skill.lastSynchronizedAt)) revalidateSkillsCatalogInBackground();
  } catch (error) {
    const local = store.list({ query, page: 0, perPage: 100 });
    if (!local.skills.length && !store.status().hasSnapshot) {
      return NextResponse.json({
        error: "skill_search_unavailable",
        message: error instanceof Error ? error.message : "The skills catalog search is unavailable.",
        skills: [],
        candidates: [],
        stale: true,
      }, { status: 503 });
    }
    records = local.skills;
    stale = true;
    message = error instanceof Error ? error.message : "Showing last-known-good catalog results.";
  }
  const evaluated = records.map((skill) => {
    const manifest = skill.files?.find((file) => /^SKILL\.md$/i.test(file.path))?.contents ?? "";
    const classification = classifySkill({
      name: skill.slug,
      description: skill.description ?? undefined,
      repository: skill.source,
      manifest,
    });
    const compatibility = resolveSkillCompatibility({
      classification: classification.classification,
      manifest,
      name: skill.slug,
      description: skill.description ?? undefined,
      surface,
      connectedMcpServers,
      reviewedScientificSource: skill.source === SCIENTIFIC_SKILLS_SOURCE,
      reviewedLocalSource: isReviewedLocalSource(skill.source),
    });
    return { skill, classification, compatibility };
  }).filter(({ skill, classification }) =>
    isReviewedLocalSource(skill.source) ||
    isCatalogSkillInspectable(classification.classification)
  );
  const skills = evaluated.map(({ skill, classification, compatibility }) => {
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
  });
  const candidates = evaluated.map(({ skill, classification, compatibility }) => ({
    id: skill.upstreamId,
    upstreamId: skill.upstreamId,
    name: skill.slug,
    package: `${skill.source}@${skill.slug}`,
    publisher: skill.source.split("/")[0],
    repository: skill.source,
    source: `https://github.com/${skill.source}`,
    detailsUrl: skill.pageUrl ?? `https://skills.sh/${skill.source}/${skill.slug}`,
    installs: String(skill.installs),
    description: skill.description ?? "",
    installCommand: "Catalog snapshot via Breadboard proxy",
    requestedPermissions: [],
    provider: isReviewedLocalSource(skill.source) ? "local-git" : stale ? "cache" : "api",
    classification,
    ...compatibility,
    requiresOpenCode:
      classification.classification === "eligible_coding_conditional",
    slashCommand: skill.slashCommand,
  }));
  const hasLocalResults = skills.some((skill) => isReviewedLocalSource(skill.source));
  const provider = stale ? "last-known-good" : hasLocalResults ? "skills.sh/api/v1+local-git" : "skills.sh/api/v1";
  recordAuditEvent({
    eventType: "skill.search",
    userId,
    payload: { query, resultCount: skills.length, provider, stale },
  });
  return NextResponse.json({ skills, candidates, stale, provider, message });
}
