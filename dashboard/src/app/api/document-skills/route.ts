import { requireUserId, routeErrorResponse } from '@/lib/server-auth';
import { deleteSkill, listSkillFiles, listSkills, readSkillFile } from '@/lib/document-skills/store';

export const dynamic = 'force-dynamic';

/** The user's document skills, or one skill's files/content. */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug')?.trim();
    const file = url.searchParams.get('file')?.trim();

    if (!slug) {
      return Response.json({
        skills: listSkills(userId).map((record) => ({
          slug: record.slug,
          title: record.title,
          author: record.author,
          status: record.status,
          chapterCount: record.chapterCount,
          sourceTokens: record.sourceTokens,
          origin: record.origin,
          error: record.error,
          updatedAt: record.updatedAt,
        })),
      });
    }

    const record = listSkills(userId).find((entry) => entry.slug === slug);
    if (!record) return Response.json({ error: 'Skill not found' }, { status: 404 });

    if (file) {
      const content = readSkillFile(slug, file);
      if (content === null) return Response.json({ error: 'File not found' }, { status: 404 });
      return Response.json({ slug, file, content });
    }

    return Response.json({
      skill: {
        slug: record.slug,
        title: record.title,
        author: record.author,
        status: record.status,
        chapterCount: record.chapterCount,
        sourceTokens: record.sourceTokens,
        origin: record.origin,
        error: record.error,
        updatedAt: record.updatedAt,
      },
      files: listSkillFiles(slug),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const slug = new URL(request.url).searchParams.get('slug')?.trim();
    if (!slug) return Response.json({ error: 'slug is required' }, { status: 400 });
    if (!deleteSkill(userId, slug)) {
      return Response.json({ error: 'Skill not found' }, { status: 404 });
    }
    return Response.json({ deleted: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
