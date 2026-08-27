import { NextResponse } from "next/server";
import {
  InvalidLearnRouteBodyError,
  readLearnRouteJsonObject,
} from "@/lib/learn-route-errors";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import {
  createChatmockClient,
  scanClusterKnowledge,
  writeDocumentKnowledge,
} from "@/lib/knowledge";
import {
  parseGeneratedSyllabus,
  renderSyllabusMarkdown,
  syllabusDraftMessages,
  SYLLABUS_PROMPT_MAX_CHARS,
  type SyllabusGardenContextDocument,
} from "@/lib/learn-syllabus-authoring";
import {
  requireOwnedClusterFromSlug,
  routeErrorResponse,
} from "@/lib/server-auth";
import { selectedModelForUser } from "@/lib/selected-model";

export const dynamic = "force-dynamic";

/**
 * Write a syllabus from a prompt ("I want to learn everything introductory
 * about electronics") and land it in the garden as an ordinary source document,
 * so the Learn panel can designate it exactly like an uploaded study guide.
 *
 * It goes in through the same writer the ingest route uses, with no concept
 * extraction: a syllabus is an outline to plan against, not material to mine.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const { userId, cluster } = await requireOwnedClusterFromSlug(gardenId);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json(
        { error: "QUARTZ_CONTENT_PATH not configured" },
        { status: 500 },
      );
    }

    const body = await readLearnRouteJsonObject(request);
    const prompt =
      typeof body.prompt === "string"
        ? body.prompt.trim().slice(0, SYLLABUS_PROMPT_MAX_CHARS)
        : "";
    if (!prompt) {
      return NextResponse.json(
        { error: "Describe what you want to learn." },
        { status: 400 },
      );
    }

    // Plan against what this garden can actually teach from, so the course does
    // not open with units no uploaded document supports.
    let gardenDocuments: SyllabusGardenContextDocument[] = [];
    try {
      gardenDocuments = scanClusterKnowledge(contentPath, cluster.slug)
        .nodes.filter((node) => node.type === "source-document")
        .map((node) => ({ title: node.title, description: node.description }));
    } catch {
      // A garden with nothing in it yet still gets a syllabus.
    }

    const { baseURL } = resolveChatmockBaseUrl(request);
    const client = createChatmockClient(baseURL);
    let raw = "";
    try {
      const response = await client.chat.completions.create({
        model: selectedModelForUser(userId),
        messages: syllabusDraftMessages(prompt, gardenDocuments),
      });
      raw = response.choices[0]?.message?.content ?? "";
    } catch {
      return NextResponse.json(
        {
          error:
            "The model that writes syllabi is unavailable right now. Try again, or upload a syllabus instead.",
        },
        { status: 502 },
      );
    }

    const syllabus = parseGeneratedSyllabus(raw);
    if (!syllabus) {
      return NextResponse.json(
        {
          error:
            "The generated syllabus came back unreadable. Try again, or describe what you want to learn in more detail.",
        },
        { status: 502 },
      );
    }

    const markdown = renderSyllabusMarkdown(syllabus);
    const saved = await writeDocumentKnowledge({
      contentPath,
      clusterSlug: cluster.slug,
      sourceTitle: syllabus.courseTitle,
      sourceFileName: `${syllabus.courseTitle}.md`,
      sourceType: "md",
      sourceLabel: "Syllabus",
      markdownText: markdown,
      plainText: markdown,
      extraction: {
        documentTitle: syllabus.courseTitle,
        summary:
          syllabus.overview ||
          `A generated syllabus covering ${syllabus.units.length} unit${syllabus.units.length === 1 ? "" : "s"}.`,
        topics: [],
        relationships: [],
        suggestedTags: [],
      },
      publicationUserId: userId,
      sourceMetadata: {
        syllabus_generated: "true",
        syllabus_prompt: prompt,
      },
      abortSignal: request.signal,
    });

    return NextResponse.json({
      success: true,
      slug: saved.sourceSlug,
      relPath: saved.sourceRelPath,
      courseTitle: syllabus.courseTitle,
      unitCount: syllabus.units.length,
    });
  } catch (error) {
    if (error instanceof InvalidLearnRouteBodyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return routeErrorResponse(error);
  }
}
