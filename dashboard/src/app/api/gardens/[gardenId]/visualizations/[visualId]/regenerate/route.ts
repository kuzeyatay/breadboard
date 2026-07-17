import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
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
import {
  createGeneratedVisualization,
  findGeneratedVisualBlockById,
  loadGeneratedVisualManifest,
  replaceGeneratedVisualBlock,
  rollbackGeneratedVisualization,
} from '@/lib/generated-visuals';
import { loadVisualizationPlan } from '@/lib/visualization-opportunities';

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

    // Generated modules have an explicit version reference in Markdown. Build
    // and validate a replacement artifact first; the current page stays on the
    // old version until every generation, AST, browser, and critic gate passes.
    const gardenDir = path.join(contentPath, cluster.slug);
    let generatedFilePath: string | null = null;
    let generatedContent = '';
    let generatedBlock: ReturnType<typeof findGeneratedVisualBlockById> = null;
    if (pageSlug) {
      const resolved = resolveClusterNoteFile(contentPath, cluster.slug, pageSlug);
      if (resolved && fs.existsSync(resolved.filePath)) {
        const candidate = fs.readFileSync(resolved.filePath, 'utf-8');
        const found = findGeneratedVisualBlockById(candidate, visualId);
        if (found) {
          generatedFilePath = resolved.filePath;
          generatedContent = candidate;
          generatedBlock = found;
        }
      }
    }
    if (!generatedFilePath) {
      for (const candidatePath of listGardenMarkdownFiles(contentPath, cluster.slug)) {
        const candidate = fs.readFileSync(candidatePath, 'utf-8');
        if (!candidate.includes(visualId)) continue;
        const found = findGeneratedVisualBlockById(candidate, visualId);
        if (found) {
          generatedFilePath = candidatePath;
          generatedContent = candidate;
          generatedBlock = found;
          break;
        }
      }
    }
    if (generatedFilePath && generatedBlock) {
      const requestedCurrentVersion = Number(body.currentVersion ?? generatedBlock.version);
      if (requestedCurrentVersion !== generatedBlock.version) {
        return NextResponse.json(
          { error: `Visualization changed from v${requestedCurrentVersion} to v${generatedBlock.version}; reload before regenerating.` },
          { status: 409, headers },
        );
      }
      const currentManifest = loadGeneratedVisualManifest(gardenDir, visualId, generatedBlock.version);
      const plan = loadVisualizationPlan(gardenDir);
      const plannedOpportunity = plan?.opportunities.find((candidate) => candidate.id === visualId);
      if (!currentManifest || !plannedOpportunity) {
        return NextResponse.json(
          { error: 'The generated visualization manifest or opportunity plan is missing.' },
          { status: 409, headers },
        );
      }
      const relativePage = path.relative(gardenDir, generatedFilePath).replace(/\\/g, '/');
      const opportunity = {
        ...plannedOpportunity,
        targetPage: relativePage,
        targetHeading: currentManifest.targetHeading,
        insertionAnchor: currentManifest.insertionAnchor,
      };
      const surrounding = generatedContent.slice(
        Math.max(0, generatedBlock.index - 4000),
        generatedBlock.index + generatedBlock.fullMatch.length + 2500,
      );
      const { baseURL } = resolveChatmockBaseUrl(request);
      const client = createChatmockClient(baseURL);
      const result = await createGeneratedVisualization({
        client,
        model: DEFAULT_MODEL,
        gardenDir,
        opportunity,
        pageMarkdown: surrounding,
        availableSourceAnchorIds: new Set(opportunity.sourceAnchorIds),
        onEvent: (event) => appendGardenEvent(contentPath, cluster.slug, event.type, {
          ...event.data,
          pageId: relativePage.replace(/\.md$/i, ''),
          regenerationReason: reason || 'Learner requested regeneration',
        }),
      });
      if (!result.manifest) {
        return NextResponse.json(
          { error: `Replacement did not pass validation; v${generatedBlock.version} remains active.`, details: result.errors },
          { status: 422, headers },
        );
      }
      const nextContent = replaceGeneratedVisualBlock(
        generatedContent,
        generatedBlock,
        visualId,
        result.manifest.version,
      );
      const temporaryPath = `${generatedFilePath}.visual-${process.pid}-${Date.now()}.tmp`;
      try {
        fs.writeFileSync(temporaryPath, nextContent, 'utf-8');
        fs.renameSync(temporaryPath, generatedFilePath);
        await publishQuartzAfterMutation(`regenerate generated visual ${visualId} in ${cluster.slug}`);
      } catch (error) {
        fs.rmSync(temporaryPath, { force: true });
        fs.writeFileSync(generatedFilePath, generatedContent, 'utf-8');
        rollbackGeneratedVisualization({ gardenDir, id: visualId, version: generatedBlock.version });
        throw error;
      }
      appendGardenEvent(contentPath, cluster.slug, 'visualization_regenerated', {
        visualId,
        pageId: relativePage.replace(/\.md$/i, ''),
        kind: 'generated_module',
        oldVersion: generatedBlock.version,
        newVersion: result.manifest.version,
        reason,
        sourceAnchors: result.manifest.sourceAnchorIds,
      });
      return NextResponse.json({ success: true, visual: result.manifest }, { headers });
    }

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
