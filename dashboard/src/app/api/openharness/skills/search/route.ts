import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { requireEnabled } from "@/lib/openharness/route-helpers.ts";
import { classifySkill } from "@/lib/openharness/skills.ts";
import { resolveSkillCompatibility } from "@/lib/openharness/skill-compatibility.ts";
import type { OpenHarnessSurface } from "@/lib/openharness/config.ts";
import { SkillsShClient } from "@/lib/openharness/skills-sh-client.ts";
import { getSkillsCatalogStore } from "@/lib/openharness/skills-catalog-store.ts";
import { revalidateSkillsCatalogInBackground } from "@/lib/openharness/skills-catalog-sync.ts";
import { recordAuditEvent } from "@/lib/openharness/runtime-store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const userId = await requireUserId();
  requireEnabled();
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim().slice(0, 200) ?? "";
  const surface: OpenHarnessSurface = url.searchParams.get("surface") === "garden_chat"
    ? "garden_chat"
    : url.searchParams.get("surface") === "quartz_ai"
      ? "quartz_ai"
      : "dashboard_terminal";
  if (!query) return NextResponse.json({ skills: [], candidates: [], stale: false, provider: "skills.sh/api/v1" });
  const store = getSkillsCatalogStore();
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
    if (records.some((skill) => !skill.lastSynchronizedAt)) revalidateSkillsCatalogInBackground();
  } catch (error) {
    const local = store.list({ query, page: 0, perPage: 100 });
    if (!local.skills.length && !store.status().hasSnapshot) {
      return NextResponse.json({
        error: "skill_search_unavailable",
        message: error instanceof Error ? error.message : "skills.sh search is unavailable.",
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
    });
    return { skill, classification, compatibility };
  }).filter(({ classification, compatibility }) =>
    classification.classification === "eligible_general" && compatibility.availability === "ready"
  );
  const skills = evaluated.map(({ skill, classification, compatibility }) => {
    return {
      ...skill,
      installedPath: undefined,
      files: skill.files?.map((file) => ({ path: file.path })) ?? null,
      command: `/${skill.slashCommand}`,
      description: skill.description ?? "Open to load skill details",
      descriptionLoaded: Boolean(skill.description),
      classification,
      ...compatibility,
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
    installCommand: `npx skills add ${skill.source} --skill ${skill.slug}`,
    requestedPermissions: [],
    provider: stale ? "cache" : "api",
    classification,
    ...compatibility,
    slashCommand: skill.slashCommand,
  }));
  recordAuditEvent({
    eventType: "skill.search",
    userId,
    payload: { query, resultCount: skills.length, provider: stale ? "last-known-good" : "skills.sh/api/v1", stale },
  });
  return NextResponse.json({ skills, candidates, stale, provider: stale ? "last-known-good" : "skills.sh/api/v1", message });
}
