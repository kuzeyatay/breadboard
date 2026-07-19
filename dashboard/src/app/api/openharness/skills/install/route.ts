import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
} from "@/lib/openharness/route-helpers.ts";
import {
  classifySkill,
  quarantineSkill,
  skillStorageKey,
  type SkillCandidate,
} from "@/lib/openharness/skills.ts";
import { SkillsShClient } from "@/lib/openharness/skills-sh-client.ts";
import { getSkillsCatalogStore } from "@/lib/openharness/skills-catalog-store.ts";
import { recordAuditEvent, recordSkillDecision } from "@/lib/openharness/runtime-store.ts";

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
    const catalogSkill = store.get(upstreamId);
    if (!catalogSkill) {
      throw new ApiError(404, "catalog_skill_not_found", "That stable skill id is not present in the synchronized skills.sh catalog.");
    }
    if (catalogSkill.upstreamStatus !== "available") {
      throw new ApiError(409, "skill_unlisted_upstream", "This skill is no longer listed upstream. Existing approved content is retained, but a new install cannot be prepared.");
    }
    const client = new SkillsShClient();
    const detail = await client.detail(catalogSkill.source, catalogSkill.slug);
    if (!detail.hash || !detail.files) {
      throw new ApiError(409, "skill_snapshot_unavailable", "skills.sh has not published an installable content snapshot for this skill yet.");
    }
    let audits = catalogSkill.audits ?? [];
    let auditError: string | null = null;
    try {
      audits = await client.audits(catalogSkill.source, catalogSkill.slug);
    } catch (error) {
      auditError = error instanceof Error ? error.message : "Upstream audits are unavailable.";
    }
    store.saveDetail(upstreamId, detail, audits);
    const skillMarkdown = detail.files.find((file) => /^SKILL\.md$/i.test(file.path))?.contents ?? "";
    const description = descriptionFromMarkdown(skillMarkdown) ?? catalogSkill.description ?? "";
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
      installs: String(detail.installs),
      description,
      version: detail.hash,
      installCommand: `npx skills add ${catalogSkill.source} --skill ${catalogSkill.slug}`,
      requestedPermissions: [],
      provider: "api",
      classification,
      slashCommand: catalogSkill.slashCommand,
      storageKey: skillStorageKey(upstreamId, catalogSkill.slug),
    };
    const report = quarantineSkill({
      candidate,
      files: Object.fromEntries(detail.files.map((file) => [file.path, file.contents])),
    });
    store.markQuarantined(upstreamId, detail.hash, report.name);
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
