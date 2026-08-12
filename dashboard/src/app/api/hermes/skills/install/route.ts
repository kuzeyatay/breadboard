import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
} from "@/lib/hermes/route-helpers.ts";
import {
  classifySkill,
  quarantineCatalogSkillSnapshot,
  quarantineSkill,
  skillStorageKey,
  type SkillCandidate,
} from "@/lib/hermes/skills.ts";
import { SkillsShClient } from "@/lib/hermes/skills-sh-client.ts";
import { getSkillsCatalogStore } from "@/lib/hermes/skills-catalog-store.ts";
import { recordAuditEvent, recordSkillDecision } from "@/lib/hermes/runtime-store.ts";
import {
  getLocalReviewedSkill,
  readLocalReviewedSkillFiles,
  synchronizeLocalSkillsCatalogs,
} from "@/lib/hermes/local-skills-sources.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "Install" prepares one immutable revision in inactive quarantine. The user
// still has to review and approve it before it enters the command registry.
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const body = await readJsonBody(request);
    const upstreamId = requireString(body.upstreamId ?? body.id, "upstreamId", 500);
    const store = getSkillsCatalogStore();
    synchronizeLocalSkillsCatalogs({ store });
    let catalogSkill = store.get(upstreamId);
    if (!catalogSkill) {
      throw new ApiError(404, "catalog_skill_not_found", "That stable skill id is not present in the synchronized catalog.");
    }
    if (catalogSkill.upstreamStatus !== "available") {
      throw new ApiError(409, "skill_unlisted_upstream", "This skill is no longer listed upstream. Existing approved content is retained, but a new install cannot be prepared.");
    }
    let local = getLocalReviewedSkill(upstreamId);
    if (local) {
      synchronizeLocalSkillsCatalogs({ store, force: true });
      catalogSkill = store.get(upstreamId)!;
      local = getLocalReviewedSkill(upstreamId);
    }
    const client = local ? null : new SkillsShClient();
    const detail = local?.detail ?? await client!.detail(catalogSkill.source, catalogSkill.slug);
    if (!detail.hash || !detail.files?.length) {
      throw new ApiError(409, "skill_snapshot_unavailable", "An installable skill snapshot is unavailable.");
    }
    let audits = catalogSkill.audits ?? [];
    let auditError: string | null = null;
    if (client) {
      try {
        audits = await client.audits(catalogSkill.source, catalogSkill.slug);
      } catch (error) {
        auditError = error instanceof Error ? error.message : "Upstream audits are unavailable.";
      }
    }
    store.saveDetail(upstreamId, detail, audits);
    const skillMarkdown = detail.files.find((file) => /^SKILL\.md$/i.test(file.path))?.contents ?? "";
    const description = local?.description ?? descriptionFromMarkdown(skillMarkdown) ?? catalogSkill.description ?? "";
    const classification = classifySkill({
      name: catalogSkill.slug,
      description,
      repository: catalogSkill.source,
      manifest: skillMarkdown,
    });
    const candidate: SkillCandidate = {
      id: upstreamId,
      upstreamId,
      name: catalogSkill.slug,
      package: `${catalogSkill.source}@${catalogSkill.slug}`,
      publisher: catalogSkill.source.split("/")[0],
      repository: catalogSkill.source,
      source: catalogSkill.installUrl ?? `https://github.com/${catalogSkill.source}`,
      detailsUrl: catalogSkill.pageUrl ?? `https://skills.sh/${catalogSkill.source}/${catalogSkill.slug}`,
      installs: String(catalogSkill.installs),
      description,
      version: detail.hash,
      installCommand: "Catalog snapshot via Breadboard proxy",
      requestedPermissions: [],
      provider: local ? "local-git" : "api",
      classification,
      slashCommand: catalogSkill.slashCommand,
      storageKey: skillStorageKey(upstreamId, catalogSkill.slug),
    };
    const localFiles = local ? readLocalReviewedSkillFiles(upstreamId) : null;
    if (local && (!localFiles || localFiles.hash !== detail.hash)) {
      throw new ApiError(409, "local_skill_changed", "The local skill changed while its review snapshot was being prepared. Try again to review the latest files.");
    }
    const report = localFiles
      ? quarantineSkill({ candidate, files: localFiles.files })
      : quarantineCatalogSkillSnapshot({
          candidate,
          files: detail.files,
          catalogRevision: detail.hash,
        });
    store.markQuarantined({
      upstreamId,
      upstreamHash: detail.hash,
      localHash: report.localHash,
      catalogRevision: report.catalogRevision ?? detail.hash,
      revisionKey: report.name,
    });
    recordSkillDecision({
      skillName: report.name,
      sourceUrl: report.source,
      version: detail.hash,
      decision: "quarantined",
      decidedBy: userId,
      manifest: { ...report, upstreamAudits: audits, auditError },
      notes: catalogSkill.approvedHash ? "A changed upstream revision entered quarantine; prior approval was not inherited." : null,
    });
    recordAuditEvent({
      eventType: catalogSkill.approvedHash ? "skill.update_quarantined" : "skill.quarantined",
      userId,
      payload: {
        upstreamId,
        upstreamHash: detail.hash,
        localHash: report.localHash,
        catalogRevision: report.catalogRevision,
        previousApprovedHash: catalogSkill.approvedHash,
        fileHashes: report.fileHashes,
        classification: report.classification,
        auditProviders: audits.map((audit) => audit.provider),
      },
    });
    const state = store.get(upstreamId);
    return NextResponse.json({
      report,
      audits,
      auditError,
      skill: state ? {
        upstreamId: state.upstreamId,
        reviewStatus: state.reviewStatus,
        installationStatus: state.installationStatus,
        updateStatus: state.updateStatus,
        upstreamHash: state.upstreamHash,
        approvedHash: state.approvedHash,
      } : null,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function descriptionFromMarkdown(markdown: string): string | null {
  const frontmatter = markdown.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---/)?.[1] ?? "";
  const match = frontmatter.match(/^description:\s*(?:["']([^"']+)["']|(.+))\s*$/mi);
  return (match?.[1] ?? match?.[2])?.trim() || null;
}
