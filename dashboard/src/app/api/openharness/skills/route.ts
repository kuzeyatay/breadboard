import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { requireEnabled } from "@/lib/openharness/route-helpers.ts";
import {
  getSkillsCatalogStore,
  type CatalogFilter,
} from "@/lib/openharness/skills-catalog-store.ts";
import {
  catalogSyncInProgress,
  revalidateSkillsCatalogInBackground,
  synchronizeSkillsCatalog,
} from "@/lib/openharness/skills-catalog-sync.ts";
import { classifySkill } from "@/lib/openharness/skills.ts";
import { resolveSkillCompatibility } from "@/lib/openharness/skill-compatibility.ts";
import type { OpenHarnessSurface } from "@/lib/openharness/config.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FILTERS = new Set<CatalogFilter>([
  "all", "trending", "hot", "official", "installed", "updates", "audited", "unreviewed",
]);

export async function GET(request: Request) {
  await requireUserId();
  requireEnabled();
  const store = getSkillsCatalogStore();
  let status = store.status();
  if (!status.hasSnapshot) {
    try {
      await synchronizeSkillsCatalog({ store });
      status = store.status();
    } catch (error) {
      status = store.status();
      return NextResponse.json({
        error: "catalog_unavailable",
        message: error instanceof Error ? error.message : "The skills.sh catalog could not be synchronized.",
        status,
        skills: [],
        pagination: { page: 0, perPage: 50, total: 0, hasMore: false },
      }, { status: 503 });
    }
  } else if (status.stale) {
    revalidateSkillsCatalogInBackground();
  }
  const url = new URL(request.url);
  const surface = parseSurface(url.searchParams.get("surface"));
  const requestedFilter = url.searchParams.get("filter") as CatalogFilter | null;
  const filter = requestedFilter && FILTERS.has(requestedFilter) ? requestedFilter : "all";
  const result = store.list({
    filter,
    query: url.searchParams.get("q") ?? undefined,
    page: Number(url.searchParams.get("page") ?? 0),
    perPage: Number(url.searchParams.get("perPage") ?? 50),
  });
  status = store.status();
  const visible = result.skills
    .map((skill) => withCompatibility(skill, surface))
    .filter((skill) =>
      skill.classification.classification === "eligible_general" &&
      skill.availability === "ready"
    );
  return NextResponse.json({
    skills: visible.map(publicSkill),
    pagination: {
      page: result.page,
      perPage: result.perPage,
      total: visible.length,
      hasMore: result.hasMore,
    },
    status: { ...status, synchronizing: catalogSyncInProgress() },
    filter,
  });
}

function parseSurface(value: string | null): OpenHarnessSurface {
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
}>(skill: T, surface: OpenHarnessSurface) {
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
  });
  return { ...skill, classification, ...compatibility };
}

export async function POST() {
  await requireUserId();
  requireEnabled();
  const store = getSkillsCatalogStore();
  try {
    const sync = await synchronizeSkillsCatalog({ store, force: true });
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

function publicSkill(skill: ReturnType<typeof getSkillsCatalogStore>["get"] extends (...args: never[]) => infer R ? NonNullable<R> : never) {
  return {
    ...skill,
    installedPath: undefined,
    files: skill.files?.map((file) => ({ path: file.path })) ?? null,
    command: `/${skill.slashCommand}`,
    description: skill.description ?? "Open to load skill details",
    descriptionLoaded: Boolean(skill.description),
  };
}
