import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  ApiError,
} from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import {
  findSkillBySlug,
  listSkillFiles,
  readSkillFile,
} from "@/lib/document-skills/store.ts";

export const dynamic = "force-dynamic";

/** Bound on one tool result, so a chapter can never blow out the context. */
const MAX_FILE_CHARS = 24_000;

// Model-invoked reader for a distilled document skill.
//
// The skill's SKILL.md is already in the turn's system prompt; this is how the
// model opens the rest — one chapter, the glossary, the cheatsheet — when the
// question needs detail the index does not carry. That on-demand read is the
// whole point of distilling the document instead of pasting it.
//
// Authority comes from the capability token minted for this runtime session,
// and the owning user is resolved from the session row: a model-supplied slug
// can only ever reach a skill built by the user whose turn this is.
export async function POST(request: Request) {
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: "document_skill_read" })) {
      throw new ApiError(
        403,
        "document_skill_capability_denied",
        "Reading document skills is not authorized.",
      );
    }
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    if (
      !session ||
      session.user_id === null ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId
    ) {
      throw new ApiError(
        403,
        "document_skill_session_scope_mismatch",
        "Document skill session scope is invalid.",
      );
    }

    const body = await readJsonBody(request, 16 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const slug = typeof args.slug === "string" ? args.slug.trim() : "";
    if (!slug) {
      throw new ApiError(400, "document_skill_slug_required", "slug is required.");
    }

    const record = findSkillBySlug(session.user_id, slug);
    if (!record || record.status !== "ready") {
      return NextResponse.json({
        ok: false,
        tool: "document_skill_read",
        error: `No ready document skill named "${slug}". Only the skills listed in this turn's context can be read.`,
      });
    }

    const files = listSkillFiles(slug);
    const requested = typeof args.file === "string" ? args.file.trim() : "";
    if (!requested) {
      // No file named: answer with the map rather than guessing which one the
      // model wanted.
      return NextResponse.json({
        ok: true,
        tool: "document_skill_read",
        data: { slug, title: record.title, files: files.map((file) => file.path) },
      });
    }

    const content = readSkillFile(slug, requested);
    if (content === null) {
      return NextResponse.json({
        ok: false,
        tool: "document_skill_read",
        error: `"${requested}" is not a file in this skill.`,
        data: { files: files.map((file) => file.path) },
      });
    }

    const truncated = content.length > MAX_FILE_CHARS;
    recordAuditEvent({
      eventType: "document_skill.read",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { slug, file: requested, truncated },
    });

    return NextResponse.json({
      ok: true,
      tool: "document_skill_read",
      data: {
        slug,
        file: requested,
        title: record.title,
        truncated,
        content: truncated ? `${content.slice(0, MAX_FILE_CHARS)}\n\n[…truncated…]` : content,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
