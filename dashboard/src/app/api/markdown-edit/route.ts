import { NextResponse } from "next/server";
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import OpenAI from "openai";
import { DEFAULT_MODEL } from "@/lib/ai-models";
import { chatTokenUsageFromResponse } from "@/lib/chat-token-usage";
import { refreshClusterIndex, resolveClusterNoteFile } from "@/lib/knowledge";
import { updateLearnerPageConcepts } from "@/lib/garden-semantics";
import { publishQuartzAfterMutation } from "@/lib/quartz-publish";
import { acquireGardenMutationLease } from "@/lib/garden-mutation-lease";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { withCouncil } from "@/lib/council";
import {
  requireOwnedClusterFromSlug,
  routeErrorResponse,
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;
type ChatMessage = { role: "user" | "assistant"; content: string };

function stripMarkdownFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function normalizeDocumentSlug(
  clusterSlug: string,
  slug: string,
): string | null {
  const cleaned = slug
    .replace(/\\/g, "/")
    .replace(/[?#].*$/, "")
    .replace(/\.md$/i, "")
    .trim();
  let segments = cleaned
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const clusterIndex = segments.findIndex((segment) => segment === clusterSlug);
  if (clusterIndex >= 0) segments = segments.slice(clusterIndex + 1);
  if (segments[0] === "garden" && segments[1] === clusterSlug)
    segments = segments.slice(2);
  if (segments.length === 0) return null;
  const noteSlug = segments.join("/");
  if (/^(?:index|_index)$/i.test(noteSlug) || noteSlug.includes(".."))
    return null;
  return noteSlug;
}

function documentPath(
  contentPath: string,
  clusterSlug: string,
  slug: string,
): string | null {
  const clusterDir = path.resolve(contentPath, clusterSlug);
  // Notes may live in sub-folders (sources/, generated/), so resolve by slug
  // across the cluster; fall back to the root path for not-yet-created notes.
  const resolved = resolveClusterNoteFile(contentPath, clusterSlug, slug);
  const filePath = resolved
    ? path.resolve(resolved.filePath)
    : path.resolve(clusterDir, `${slug}.md`);
  if (
    filePath !== clusterDir &&
    filePath.startsWith(`${clusterDir}${path.sep}`)
  )
    return filePath;
  return null;
}

function frontmatterTitle(content: string, fallback: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const titleLine = match?.[1]
    ?.split(/\r?\n/)
    .find((line) => line.trimStart().startsWith("title:"));
  if (!titleLine) return fallback;
  return (
    titleLine
      .slice(titleLine.indexOf(":") + 1)
      .trim()
      .replace(/^["']|["']$/g, "") || fallback
  );
}

function parseYamlArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function yamlListItemValue(line: string): string | null {
  const match = line.match(/^\s*-\s*(.+?)\s*$/);
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function parseFrontmatterTags(content: string): string[] {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return [];
  const lines = match[1].split(/\r?\n/);
  const tagIndex = lines.findIndex((line) =>
    line.trimStart().startsWith("tags:"),
  );
  if (tagIndex < 0) return [];
  const tagsLine = lines[tagIndex];
  const value = tagsLine.slice(tagsLine.indexOf(":") + 1).trim();
  const blockTags: string[] = [];
  for (const line of lines.slice(tagIndex + 1)) {
    const tag = yamlListItemValue(line);
    if (!tag) break;
    blockTags.push(tag);
  }
  if (value.startsWith("[")) return [...parseYamlArray(value), ...blockTags];
  return value
    ? value
        .split(/\s+/)
        .map((tag) => tag.trim().replace(/^-/, ""))
        .filter(Boolean)
    : blockTags;
}

function hasFrontmatterTags(content: string): boolean {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return Boolean(
    match?.[1]
      ?.split(/\r?\n/)
      .some((line) => line.trimStart().startsWith("tags:")),
  );
}

function wantsTagEdit(instruction: string): boolean {
  return /\b(tags?|tagging|frontmatter|yaml|metadata)\b/i.test(instruction);
}

function wantsTagReplacement(instruction: string): boolean {
  return /\b(replace|overwrite|reset|set\s+tags\s+to)\b/i.test(instruction);
}

function parseEditResponse(
  rawContent: string,
): { content: string; summary: string } | null {
  const stripped = stripMarkdownFence(rawContent);
  try {
    const parsed = JSON.parse(stripped) as JsonRecord;
    const content =
      typeof parsed.content === "string" ? parsed.content.trim() : "";
    const summary =
      typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    if (content) return { content, summary };
  } catch {
    // Fall through and accept raw markdown only when it looks like a complete note.
  }
  return stripped
    ? { content: stripped, summary: "Updated the open page." }
    : null;
}

function parseChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as JsonRecord;
      const role = record.role;
      const content = record.content;
      if (
        (role !== "user" && role !== "assistant") ||
        typeof content !== "string"
      )
        return null;
      return { role, content: content.trim() };
    })
    .filter((message): message is ChatMessage => Boolean(message?.content))
    .slice(-8);
}

export async function POST(request: Request) {
  try {
    const { baseURL } = resolveChatmockBaseUrl(request);
    const body = await request.json().catch(() => ({}));
    const clusterSlug =
      typeof body.clusterSlug === "string" ? body.clusterSlug.trim() : "";
    const slugInput = typeof body.slug === "string" ? body.slug.trim() : "";
    const instruction =
      typeof body.instruction === "string" ? body.instruction.trim() : "";
    const chatMessages = parseChatMessages(body.messages);
    const selectedModel =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : DEFAULT_MODEL;

    if (!clusterSlug || !slugInput || !instruction) {
      return NextResponse.json(
        { error: "clusterSlug, slug, and instruction are required" },
        { status: 400 },
      );
    }

    const { cluster, userId } = await requireOwnedClusterFromSlug(clusterSlug);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json(
        { error: "QUARTZ_CONTENT_PATH not configured" },
        { status: 500 },
      );
    }

    const slug = normalizeDocumentSlug(cluster.slug, slugInput);
    if (!slug) {
      return NextResponse.json(
        { error: "Document path is not editable" },
        { status: 400 },
      );
    }

    const filePath = documentPath(contentPath, cluster.slug, slug);
    if (!filePath || !fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    const currentContent = fs.readFileSync(filePath, "utf-8");
    const client = new OpenAI({
      baseURL,
      apiKey: process.env.OPENAI_API_KEY || "local",
    });

    const response = await client.chat.completions.create(
      withCouncil(
        {
          model: selectedModel,
          messages: [
            {
              role: "system",
              content:
                'You rewrite an existing Markdown note exactly as requested. Return only JSON with keys "summary" and "content". ' +
                'The "content" value must be the complete updated Markdown file, including YAML frontmatter if present. ' +
                "Preserve all useful existing content unless the user explicitly asks to remove or rewrite it. " +
                'If the user asks to use "this version", "the version above", "your previous version", or similar, use the recent chat context as the replacement source. ' +
                'When editing tags, suggest only canonical reusable concepts: normalized lower-case kebab-case identities such as "restoring-force", "angular-frequency", or "simple-harmonic-motion". Never use a complete claim, page summary, broad category, source filename, or organizational label as a tag. ' +
                "When fixing math or LaTeX, use $...$ for inline math and $$...$$ for display math, and avoid corrupting prose.",
            },
            {
              role: "user",
              content: [
                `Instruction: ${instruction}`,
                `Cluster: ${cluster.name}`,
                `Slug: ${slug}`,
                chatMessages.length > 0
                  ? `Recent chat context:\n${chatMessages
                      .map(
                        (message) =>
                          `${message.role.toUpperCase()}:\n${message.content}`,
                      )
                      .join("\n\n---\n\n")}`
                  : "",
                "Current Markdown:",
                "```markdown",
                currentContent,
                "```",
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          ],
        },
        { taskType: "small_revision", gardenId: cluster.slug, pageId: slug },
      ),
    );

    const parsed = parseEditResponse(
      response.choices[0]?.message?.content ?? "",
    );
    if (!parsed) {
      return NextResponse.json(
        { error: "Could not parse the rewritten markdown." },
        { status: 500 },
      );
    }

    const gardenDir = path.join(contentPath, cluster.slug);
    const lease = acquireGardenMutationLease(gardenDir, "ai-edit-markdown");
    try {
      if (
        !fs.existsSync(filePath) ||
        fs.readFileSync(filePath, "utf-8") !== currentContent
      ) {
        return NextResponse.json(
          {
            error:
              "The document changed while the edit was being prepared. Please try again.",
          },
          { status: 409 },
        );
      }
      const shouldUpdateTags =
        wantsTagEdit(instruction) || hasFrontmatterTags(parsed.content);
      let nextContent = parsed.content;
      if (shouldUpdateTags) {
        const requestedTerms = parseFrontmatterTags(parsed.content);
        const assignment = updateLearnerPageConcepts({
          gardenDir: path.join(contentPath, cluster.slug),
          pageRelPath: path
            .relative(path.join(contentPath, cluster.slug), filePath)
            .replace(/\\/g, "/"),
          requestedTerms,
          primaryTerms: requestedTerms.slice(0, 1),
          mode:
            wantsTagEdit(instruction) && wantsTagReplacement(instruction)
              ? "replace"
              : "merge",
          provenance: "markdown-ai-edit",
          contentOverride: parsed.content,
        });
        void assignment;
        nextContent = fs.readFileSync(filePath, "utf8");
      } else {
        fs.writeFileSync(
          filePath,
          nextContent.endsWith("\n") ? nextContent : `${nextContent}\n`,
          "utf-8",
        );
      }
      const responseTags = parseFrontmatterTags(nextContent);
      const usage = chatTokenUsageFromResponse(response);
      refreshClusterIndex(contentPath, cluster.slug);
      await publishQuartzAfterMutation(
        `AI edit markdown ${cluster.slug}/${slug}`,
        {
          userId,
          gardenSlug: cluster.slug,
        },
      );

      return NextResponse.json({
        success: true,
        slug,
        title: frontmatterTitle(nextContent, slug),
        summary: parsed.summary || "Updated the open page.",
        content: nextContent,
        tags: responseTags,
        ...(usage ? { usage } : {}),
      });
    } finally {
      lease.release();
    }
  } catch (error) {
    return routeErrorResponse(error);
  }
}
