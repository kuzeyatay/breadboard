import {
  requireReadableClusterFromSlug,
  requireUserId,
  routeErrorResponse,
} from '@/lib/server-auth';
import { scanClusterKnowledgeCooperatively } from '@/lib/knowledge';
import { ensureDocumentSource, shouldDistill } from '@/lib/document-skills/service';
import type { DocumentSkillOrigin } from '@/lib/document-skills/types';
import { createDocumentSkillProgressStream } from '@/lib/document-skills/progress-stream';

export const dynamic = 'force-dynamic';

/**
 * The text of a garden document the caller is allowed to read.
 *
 * `requireReadableClusterFromSlug` is the authorization: a slug in a request
 * body decides nothing on its own, and a document that is not a source document
 * is available through the existing garden readers as well.
 */
async function resolveGardenDocument(
  clusterSlug: string,
  documentSlug: string,
): Promise<{ text: string; title: string; fileName: string; clusterSlug: string } | null> {
  const { cluster } = await requireReadableClusterFromSlug(clusterSlug);
  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) return null;
  const knowledge = await scanClusterKnowledgeCooperatively(contentPath, cluster.slug);
  const node = knowledge.nodes.find((candidate) => candidate.slug === documentSlug);
  if (!node?.content) return null;
  return {
    text: node.content,
    title: node.title || documentSlug,
    fileName: node.sourceFile || node.fileName || documentSlug,
    clusterSlug: cluster.slug,
  };
}

/**
 * Prepare exact document chunks and their index. Keep the NDJSON contract for
 * existing composers, without putting model distillation before a chat turn.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json()) as {
      text?: unknown;
      title?: unknown;
      fileName?: unknown;
      clusterSlug?: unknown;
      documentSlug?: unknown;
      model?: unknown;
    };

    const clusterSlug = typeof body.clusterSlug === 'string' ? body.clusterSlug.trim() : '';
    const documentSlug = typeof body.documentSlug === 'string' ? body.documentSlug.trim() : '';

    // A garden document is named, not uploaded: the browser has no copy of its
    // text and must not be trusted with one anyway, so the server reads it from
    // the garden the user is authorized for.
    const garden =
      !body.text && clusterSlug && documentSlug
        ? await resolveGardenDocument(clusterSlug, documentSlug)
        : null;

    const text = garden?.text ?? (typeof body.text === 'string' ? body.text : '');
    if (!text.trim()) {
      return Response.json({ error: 'text is required' }, { status: 400 });
    }
    const fileName = garden?.fileName
      ?? (typeof body.fileName === 'string' && body.fileName.trim()
        ? body.fileName.trim().slice(0, 240)
        : 'document');
    const title = garden?.title
      ?? (typeof body.title === 'string' && body.title.trim()
        ? body.title.trim().slice(0, 240)
        : fileName.replace(/\.[a-z0-9]+$/i, ''));

    const origin: DocumentSkillOrigin = garden
      ? { kind: 'garden', clusterSlug: garden.clusterSlug, documentSlug, fileName }
      : { kind: 'upload', fileName };

    if (!shouldDistill(text)) {
      // Small enough to send verbatim; distilling it would lose fidelity for no
      // saving. Reported as a normal outcome, not an error.
      return Response.json({ skipped: true, reason: 'below_threshold' });
    }

    const stream = createDocumentSkillProgressStream(async () => ({
      record: ensureDocumentSource({ userId, text, title, origin }),
      cached: false,
      warnings: [],
    }));

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
