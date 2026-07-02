import { NextResponse } from 'next/server';
import fs from 'fs';
import { DEFAULT_MODEL, createChatmockClient, resolveClusterNoteFile } from '@/lib/knowledge';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { publishQuartzAfterMutation } from '@/lib/quartz-publish';
import { requireOwnedClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';
import { validateVisualSpec } from '@/lib/visual-spec';
import {
  appendGardenEvent,
  findVisualBlockById,
  generateVisualSpec,
  listGardenMarkdownFiles,
  replaceVisualBlock,
  saveVisualSpec,
} from '@/lib/visuals';

export const dynamic = 'force-dynamic';

// The regenerate button lives on the Quartz garden origin (localhost:8081 /
// garden.<host>), which is same-site but cross-origin — so cookies flow with
// credentials: "include", and we must reflect the origin instead of using *.
function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const url = new URL(origin);
    const allowed =
      /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0)$/i.test(url.hostname) ||
      /^garden\./i.test(url.hostname);
    if (allowed) {
      return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        Vary: 'Origin',
      };
    }
  } catch {
    // no CORS headers for unknown origins
  }
  return {};
}

export async function OPTIONS(request: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gardenId: string; visualId: string }> },
) {
  const headers = corsHeaders(request);
  try {
    const { gardenId, visualId } = await params;
    const { cluster } = await requireOwnedClusterFromSlug(gardenId);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500, headers });
    }

    const body = await request.json().catch(() => ({}));
    const pageSlug = typeof body.pageSlug === 'string' ? body.pageSlug.trim() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    // Locate the markdown file carrying this visual block.
    let filePath: string | null = null;
    let content = '';
    let block: ReturnType<typeof findVisualBlockById> = null;
    if (pageSlug) {
      const resolved = resolveClusterNoteFile(contentPath, cluster.slug, pageSlug);
      if (resolved && fs.existsSync(resolved.filePath)) {
        const candidate = fs.readFileSync(resolved.filePath, 'utf-8');
        const found = findVisualBlockById(candidate, visualId);
        if (found) {
          filePath = resolved.filePath;
          content = candidate;
          block = found;
        }
      }
    }
    if (!filePath) {
      for (const candidatePath of listGardenMarkdownFiles(contentPath, cluster.slug)) {
        const candidate = fs.readFileSync(candidatePath, 'utf-8');
        if (!candidate.includes(visualId)) continue;
        const found = findVisualBlockById(candidate, visualId);
        if (found) {
          filePath = candidatePath;
          content = candidate;
          block = found;
          break;
        }
      }
    }
    if (!filePath || !block) {
      return NextResponse.json(
        { error: `Visual ${visualId} was not found in this garden` },
        { status: 404, headers },
      );
    }

    const existingSpec = validateVisualSpec(block.json).spec;
    const oldVersion = existingSpec?.version ?? 1;
    const surrounding = content.slice(
      Math.max(0, block.index - 2500),
      block.index + block.fullMatch.length + 1200,
    );

    const { baseURL } = resolveChatmockBaseUrl(request);
    const client = createChatmockClient(baseURL);
    const { spec, errors } = await generateVisualSpec(client, DEFAULT_MODEL, {
      gardenId: cluster.slug,
      pageId: pageSlug || undefined,
      pageMarkdown: surrounding,
      visualOpportunity:
        reason || existingSpec?.regenerationPrompt || `Regenerate the visual "${visualId}".`,
      existingSpec,
    });
    if (!spec) {
      appendGardenEvent(contentPath, cluster.slug, 'visualization_failed', {
        pageId: pageSlug || undefined,
        visualId,
        error: errors.join('; ') || 'generation failed',
      });
      return NextResponse.json(
        { error: 'The regenerated visual spec was invalid. Try again.' },
        { status: 502, headers },
      );
    }

    const nextContent = replaceVisualBlock(content, block, spec);
    fs.writeFileSync(filePath, nextContent, 'utf-8');
    saveVisualSpec(contentPath, cluster.slug, spec, pageSlug || undefined);
    appendGardenEvent(contentPath, cluster.slug, 'visualization_regenerated', {
      visualId: spec.id,
      pageId: pageSlug || spec.pageId,
      oldVersion,
      newVersion: spec.version,
      reason: reason || existingSpec?.regenerationPrompt,
      sourceAnchors: spec.sourceAnchors,
    });
    await publishQuartzAfterMutation(`regenerate visual ${spec.id} in ${cluster.slug}`);

    return NextResponse.json({ success: true, visual: spec }, { headers });
  } catch (error) {
    const response = routeErrorResponse(error);
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
    return response;
  }
}
