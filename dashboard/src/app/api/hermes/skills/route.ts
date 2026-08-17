import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { requireEnabled } from "@/lib/hermes/route-helpers.ts";
import {
  getSkillsCatalogStore,
  type CatalogFilter,
} from "@/lib/hermes/skills-catalog-store.ts";
import {
  catalogSyncInProgress,
  revalidateSkillsCatalogInBackground,
  synchronizeSkillsCatalog,
} from "@/lib/hermes/skills-catalog-sync.ts";
import {
  classifySkill,
  isCatalogSkillInspectable,
  listFirstPartySkills,
  listInstalledLocalSkills,
} from "@/lib/hermes/skills.ts";
import { resolveSkillCompatibility } from "@/lib/hermes/skill-compatibility.ts";
import type { HermesSurface } from "@/lib/hermes/config.ts";
import {
  SCIENTIFIC_SKILLS_SOURCE,
  REVERSE_SKILLS_SOURCE,
  DESIGN_SKILLS_SOURCE,
  OMH_SKILLS_SOURCE,
  ENGINEERING_SKILLS_SOURCE,
  OFFICE_SKILLS_SOURCE,
  isReviewedLocalSource,
  synchronizeLocalSkillsCatalogs,
} from "@/lib/hermes/local-skills-sources.ts";
import { listMcpConnections } from "@/lib/hermes/mcp-connections.ts";
import { listSkills as listDocumentSkills } from "@/lib/document-skills/store.ts";
import type { DocumentSkillRecord } from "@/lib/document-skills/types.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SkillsRouteFilter = CatalogFilter | "recent";

const FILTERS = new Set<SkillsRouteFilter>([
  "all", "recent", "featured", "scientific", "reverse", "design", "engineering", "office", "documents", "omh", "coding", "trending", "hot", "official", "installed", "updates", "audited", "unreviewed",
]);

/**
 * A document the user distilled, rendered in the catalog panel's skill shape.
 *
 * These never enter the shared catalog store: they belong to one user, they are
 * built rather than fetched, and they carry the contents of that user's files.
 * Listing them here keeps them visible and deletable without giving a
 * per-user artifact a row in a catalog that is meant to mirror upstreams.
 */
function publicDocumentSkill(record: DocumentSkillRecord) {
  const built = record.updatedAt;
  const origin =
    record.origin.kind === "garden"
      ? `${record.origin.fileName} — ${record.origin.clusterSlug}`
      : record.origin.fileName;
  return {
    upstreamId: `document:${record.slug}`,
    source: "Breadboard document",
    slug: record.slug,
    name: record.title,
    slashCommand: record.slug,
    command: `/${record.slug}`,
    sourceType: "document",
    installUrl: null,
    pageUrl: null,
    installs: 0,
    duplicate: false,
    curated: true,
    rankAllTime: null,
    rankTrending: null,
    rankHot: null,
    description:
      record.status === "ready"
        ? `${record.chapterCount} sections distilled from ${origin}.`
        : record.status === "building"
          ? `Being distilled from ${origin}…`
          : `Could not be distilled from ${origin}: ${record.error ?? "unknown error"}`,
    descriptionLoaded: true,
    upstreamHash: record.contentHash,
    approvedHash: record.contentHash,
    localHash: record.contentHash,
    quarantineLocalHash: null,
    catalogRevision: null,
    reviewStatus: "first_party",
    installationStatus: record.status === "ready" ? "installed" : "not_installed",
    updateStatus: "current",
    upstreamStatus: "available",
    lastSeenAt: built,
    lastSynchronizedAt: built,
    detailCheckedAt: built,
    files: null,
    audits: null,
    classification: { classification: "eligible", category: "knowledge", reasons: [] },
    availability: record.status === "ready" ? "available" : "unavailable",
    reasons: record.status === "ready" ? [] : ["The document is still being distilled."],
    contract: null,
    requirements: null,
    requiresOpenCode: false,
  };
}

export async function GET(request: Request) {
  const userId = await requireUserId();
  requireEnabled();
  const connectedMcpServers = listMcpConnections(userId, true).map(
    (connection) => connection.slug,
  );
  const url = new URL(request.url);
  const surface = parseSurface(url.searchParams.get("surface"));
  const requestedFilter = url.searchParams.get("filter") as SkillsRouteFilter | null;
  const filter = requestedFilter && FILTERS.has(requestedFilter) ? requestedFilter : "all";
  if (filter === "recent") {
    const recentIds = [...new Set(
      url.searchParams
        .getAll("id")
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && id.length <= 300),
    )].slice(0, 30);
    const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const firstParty = surface === "quartz_ai"
      ? []
      : listFirstPartySkills(surface, connectedMcpServers).map(publicFirstPartySkill);
    const store = getSkillsCatalogStore();
    synchronizeLocalSkillsCatalogs({ store });
    const catalog = recentIds.length
      ? store.list({ ids: recentIds, page: 0, perPage: 100 }).skills
          .map((skill) => withCompatibility(skill, surface, connectedMcpServers))
          .filter((skill) =>
            isReviewedLocalSource(skill.source) ||
            isCatalogSkillInspectable(skill.classification.classification)
          )
          .map(publicSkill)
      : [];
    const byId = new Map(
      [...firstParty, ...catalog].map((skill) => [skill.upstreamId, skill] as const),
    );
    const skills = recentIds
      .flatMap((id) => {
        const skill = byId.get(id);
        return skill ? [skill] : [];
      })
      .filter((skill) =>
        !query ||
        `${skill.name}\n${skill.description}\n${skill.slug}\n${skill.source}`
          .toLowerCase()
          .includes(query)
      );
    const status = store.status();
    return NextResponse.json({
      skills,
      pagination: {
        page: 0,
        perPage: skills.length,
        total: skills.length,
        hasMore: false,
      },
      status: { ...status, synchronizing: catalogSyncInProgress() },
      filter,
    });
  }
  if (filter === "featured") {
    const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const skills = surface === "quartz_ai"
      ? []
      : listFirstPartySkills(surface, connectedMcpServers)
        .filter((skill) =>
          !query ||
          `${skill.name}\n${skill.description}\n${skill.slug}`.toLowerCase().includes(query)
        )
        .map(publicFirstPartySkill);
    return NextResponse.json({
      skills,
      pagination: {
        page: 0,
        perPage: skills.length,
        total: skills.length,
        hasMore: false,
      },
      status: {
        hasSnapshot: true,
        totalAvailable: skills.length,
        stale: false,
        lastSuccessfulSyncAt: null,
        lastFailure: null,
      },
      filter,
    });
  }
  const store = getSkillsCatalogStore();
  synchronizeLocalSkillsCatalogs({ store });
  let status = store.status();
  if (!status.hasSnapshot) {
    try {
      await synchronizeSkillsCatalog({ store, includeLocalSources: true });
      status = store.status();
    } catch (error) {
      status = store.status();
      return NextResponse.json({
        error: "catalog_unavailable",
        message: error instanceof Error ? error.message : "The skills catalog could not be synchronized.",
        status,
        skills: [],
        pagination: { page: 0, perPage: 50, total: 0, hasMore: false },
      }, { status: 503 });
    }
  } else if (status.stale) {
    revalidateSkillsCatalogInBackground();
  }
  if (filter === "coding") {
    const requestedPage = Math.max(
      0,
      Math.trunc(Number(url.searchParams.get("page") ?? 0) || 0),
    );
    const requestedPerPage = Math.min(
      100,
      Math.max(
        1,
        Math.trunc(Number(url.searchParams.get("perPage") ?? 50) || 50),
      ),
    );
    const query = url.searchParams.get("q") ?? undefined;
    const records: ReturnType<typeof store.list>["skills"] = [];
    for (let catalogPage = 0; ; catalogPage += 1) {
      const batch = store.list({
        filter: "all",
        query,
        page: catalogPage,
        perPage: 100,
      });
      records.push(...batch.skills);
      if (!batch.hasMore) break;
    }
    const firstParty = surface === "quartz_ai"
      ? []
      : listFirstPartySkills(surface, connectedMcpServers)
          .filter(
            (skill) =>
              skill.classification === "eligible_coding_conditional",
          )
          .map(publicFirstPartySkill);
    const catalogSkills = records
      .map((skill) => withCompatibility(skill, surface, connectedMcpServers))
      .filter(
        (skill) =>
          skill.classification.classification ===
          "eligible_coding_conditional",
      )
      .map(publicSkill);
    const codingSkills = [...firstParty, ...catalogSkills];
    const start = requestedPage * requestedPerPage;
    const skills = codingSkills.slice(start, start + requestedPerPage);
    status = store.status();
    return NextResponse.json({
      skills,
      pagination: {
        page: requestedPage,
        perPage: requestedPerPage,
        total: codingSkills.length,
        hasMore: start + requestedPerPage < codingSkills.length,
      },
      status: { ...status, synchronizing: catalogSyncInProgress() },
      filter,
    });
  }
  if (filter === "documents") {
    // Not a catalog query: these live in Breadboard's own store, scoped to the
    // user whose documents they came from.
    const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const all = listDocumentSkills(userId)
      .filter(
        (record) =>
          !query ||
          record.title.toLowerCase().includes(query) ||
          record.origin.fileName.toLowerCase().includes(query),
      )
      .map(publicDocumentSkill);
    const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0);
    const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get("perPage") ?? 50) || 50));
    const start = page * perPage;
    return NextResponse.json({
      skills: all.slice(start, start + perPage),
      pagination: { page, perPage, total: all.length, hasMore: start + perPage < all.length },
      status: { ...store.status(), synchronizing: catalogSyncInProgress() },
      filter,
    });
  }

  const result = store.list({
    filter,
    source:
      filter === "scientific"
        ? SCIENTIFIC_SKILLS_SOURCE
        : filter === "reverse"
          ? REVERSE_SKILLS_SOURCE
          : filter === "design"
            ? DESIGN_SKILLS_SOURCE
            : filter === "engineering"
              ? ENGINEERING_SKILLS_SOURCE
              : filter === "office"
                ? OFFICE_SKILLS_SOURCE
                : filter === "omh"
                  ? OMH_SKILLS_SOURCE
                  : undefined,
    query: url.searchParams.get("q") ?? undefined,
    page: Number(url.searchParams.get("page") ?? 0),
    perPage: Number(url.searchParams.get("perPage") ?? 50),
  });
  status = store.status();
  const visible = result.skills
    .map((skill) => withCompatibility(skill, surface, connectedMcpServers))
    .filter((skill) =>
      isReviewedLocalSource(skill.source) ||
      isCatalogSkillInspectable(skill.classification.classification)
    );
  const skills = visible.map(publicSkill);
  // A reviewed skill living only in the approved store has no catalog row, so
  // the database query above cannot see it. Surface those on the first page of
  // the Installed tab, skipping any that a catalog row already covers.
  const localInstalls =
    filter === "installed" && result.page === 0 && surface !== "quartz_ai"
      ? listInstalledLocalSkills(surface, connectedMcpServers)
          .filter((skill) => !visible.some((listed) => listed.upstreamId === skill.id))
          .map(publicLocalInstallSkill)
      : [];
  return NextResponse.json({
    skills: [...localInstalls, ...skills],
    pagination: {
      page: result.page,
      perPage: result.perPage,
      total: result.total + localInstalls.length,
      hasMore: result.hasMore,
    },
    status: { ...status, synchronizing: catalogSyncInProgress() },
    filter,
  });
}

/** A reviewed store install rendered in the catalog panel's skill shape. */
function publicLocalInstallSkill(
  skill: ReturnType<typeof listInstalledLocalSkills>[number],
) {
  return {
    ...publicFirstPartySkill(skill),
    source: skill.source ?? "Breadboard",
    // Not "first-party": that is what puts a skill in the Featured tab, and
    // these are installed skills rather than shipped ones.
    sourceType: "local-install",
    reviewStatus: "approved",
    installationStatus: "installed",
  };
}

function publicFirstPartySkill(
  skill: ReturnType<typeof listFirstPartySkills>[number],
) {
  const now = new Date(0).toISOString();
  return {
    upstreamId: skill.id,
    source: "Breadboard",
    slug: skill.slug,
    name: skill.name,
    slashCommand: skill.slug,
    command: `/${skill.slug}`,
    sourceType: "first-party",
    installUrl: null,
    pageUrl: null,
    installs: 0,
    duplicate: false,
    curated: true,
    rankAllTime: null,
    rankTrending: null,
    rankHot: null,
    description: skill.description,
    descriptionLoaded: true,
    upstreamHash: skill.contentHash ?? null,
    approvedHash: skill.contentHash ?? null,
    localHash: skill.contentHash ?? null,
    quarantineLocalHash: null,
    catalogRevision: skill.version ?? null,
    reviewStatus: "first_party",
    installationStatus: "installed",
    updateStatus: "current",
    upstreamStatus: "available",
    lastSeenAt: now,
    lastSynchronizedAt: now,
    detailCheckedAt: now,
    files: null,
    audits: null,
    classification: {
      classification: skill.classification,
      category: skill.category,
      reasons: [],
    },
    availability: skill.availability,
    reasons: skill.unavailableReasons,
    contract: skill.capabilityContract,
    requirements: skill.compatibilityRequirements,
    requiresOpenCode:
      skill.classification === "eligible_coding_conditional",
  };
}

function parseSurface(value: string | null): HermesSurface {
  return value === "garden_chat" || value === "quartz_ai" || value === "dashboard_terminal"
    ? value
    : "dashboard_terminal";
}

function withCompatibility<T extends {
  name: string;
  slug: string;
  source: string;
  description: string | null;
  files: Array<{ path: string; contents?: string }> | null;
}>(
  skill: T,
  surface: HermesSurface,
  connectedMcpServers: Iterable<string>,
) {
  const manifest = skill.files?.find((file) => /^SKILL\.md$/i.test(file.path))?.contents ?? "";
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
    reviewedLocalSource: isReviewedLocalSource(skill.source),
  });
  return {
    ...skill,
    classification,
    ...compatibility,
    requiresOpenCode:
      classification.classification === "eligible_coding_conditional",
  };
}

export async function POST() {
  await requireUserId();
  requireEnabled();
  const store = getSkillsCatalogStore();
  try {
    const sync = await synchronizeSkillsCatalog({ store, force: true, includeLocalSources: true });
    return NextResponse.json({ sync, status: store.status() });
  } catch (error) {
    const status = store.status();
    return NextResponse.json({
      error: "catalog_sync_failed",
      message: error instanceof Error ? error.message : "The skills.sh catalog refresh failed.",
      status,
    }, { status: status.hasSnapshot ? 502 : 503 });
  }
}

function publicSkill<T extends {
  installedPath?: string | null;
  files: Array<{ path: string; contents?: string }> | null;
  slashCommand: string;
  description: string | null;
  detailCheckedAt: string | null;
}>(skill: T) {
  return {
    ...skill,
    installedPath: undefined,
    files: skill.files?.map((file) => ({ path: file.path })) ?? null,
    command: `/${skill.slashCommand}`,
    description: skill.description ?? (skill.detailCheckedAt ? "No description was provided by the publisher." : ""),
    descriptionLoaded: Boolean(skill.description || skill.detailCheckedAt),
  };
}
