import { systemPromptText } from "../../../lib/system-prompts/service.ts";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { createChatmockClient } from "@/lib/chatmock-client";
import { DEFAULT_MODEL } from "@/lib/ai-models";
import { chatTokenUsageFromResponse } from "@/lib/chat-token-usage";
import { refreshClusterIndex, resolveClusterNoteFile } from "@/lib/knowledge";
import { updateLearnerPageConcepts } from "@/lib/garden-semantics";
import { publishQuartzAfterMutation } from "@/lib/quartz-publish";
import { acquireGardenMutationLease } from "@/lib/garden-mutation-lease";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { withCouncil } from "@/lib/system-prompts/council.ts";
import { normalizeDocumentPath } from "@/lib/garden-document-path";
import { repairMarkdownMathFormatting, wantsMathFormattingOnly } from "@/lib/markdown-math-edit";
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
    const parsed: unknown = JSON.parse(stripped);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as JsonRecord;
    const content =
      typeof record.content === "string" ? record.content : "";
    const summary =
      typeof record.summary === "string" ? record.summary.trim() : "";
    if (content.trim() && typeof record.summary === "string") return { content, summary };
  } catch {
    // A malformed response or refusal is never replacement document content.
  }
  return null;
}

function backupBeforeEdit(gardenDir: string, filePath: string, content: string): void {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const relativePath = path.relative(gardenDir, filePath).replace(/\\/g, "/");
  const directory = path.join(gardenDir, ".breadboard", "markdown-edit-history", hash(relativePath));
  fs.mkdirSync(directory, { recursive: true });
  const backup = path.join(directory, `${hash(content)}.md`);
  if (fs.existsSync(backup)) {
    if (fs.readFileSync(backup, "utf8") !== content) throw new Error("The note backup could not be verified. The note was not changed.");
    return;
  }
  fs.writeFileSync(backup, content, { encoding: "utf8", flag: "wx" });
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

    const slug = normalizeDocumentPath(cluster.slug, slugInput);
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
    request.signal.throwIfAborted();

    const formatted = wantsMathFormattingOnly(instruction)
      ? repairMarkdownMathFormatting(currentContent)
      : currentContent;
    const formattingOnly = formatted !== currentContent;
    let parsed = formattingOnly
      ? { content: formatted, summary: "Fixed the LaTeX delimiters so the note's math renders correctly." }
      : null;
    let usage: ReturnType<typeof chatTokenUsageFromResponse> = null;
    if (!parsed) {
      const { baseURL } = resolveChatmockBaseUrl(request);
      const client = createChatmockClient(baseURL);

      const response = await client.chat.completions.create(
        withCouncil(
          {
            model: selectedModel,
            messages: [
              {
                role: "system",
                content:
                  systemPromptText("markdown-rewrite", userId),
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
          {
            taskType: "small_revision",
            gardenId: cluster.slug,
            pageId: slug,
            // A requested edit to one note does not need a draft/review/rewrite
            // council. Keep this interactive path to one model invocation.
            councilModeOverride: "direct_council",
          }, userId,
        ),
        { signal: request.signal },
      );

      const choice = response.choices[0];
      parsed = !choice?.message?.refusal && (!choice?.finish_reason || choice.finish_reason === "stop")
        ? parseEditResponse(choice?.message?.content ?? "")
        : null;
      usage = chatTokenUsageFromResponse(response);
    }
    if (!parsed) {
      return NextResponse.json(
        { error: "The assistant did not return a complete Markdown edit. Your note was not changed." },
        { status: 502 },
      );
    }
    const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
    if (frontmatter.test(currentContent) && (!frontmatter.test(parsed.content) ||
      (frontmatterTitle(currentContent, "") && !frontmatterTitle(parsed.content, "")))) {
      return NextResponse.json(
        { error: "The assistant omitted the note's metadata or title. Your note was not changed." },
        { status: 502 },
      );
    }

    // Stop must prevent a late model response from changing the document.
    request.signal.throwIfAborted();
    const gardenDir = path.join(contentPath, cluster.slug);
    const lease = acquireGardenMutationLease(gardenDir, "ai-edit-markdown");
    let nextContent = parsed.content;
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
      // Keep the exact previous bytes before either writer can replace the note.
      // If the backup cannot be saved, fail without touching the original.
      backupBeforeEdit(gardenDir, filePath, currentContent);
      const shouldUpdateTags =
        !formattingOnly && (wantsTagEdit(instruction) || hasFrontmatterTags(parsed.content));
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
        if (!formattingOnly) nextContent = nextContent.endsWith("\n") ? nextContent : `${nextContent}\n`;
        fs.writeFileSync(filePath, nextContent, "utf-8");
      }
      refreshClusterIndex(contentPath, cluster.slug, { migrateSources: false });
    } finally {
      lease.release();
    }

    // The reader consumes the saved Markdown immediately. The derived site
    // build can take minutes or queue behind other Gardens; it must neither
    // delay this response nor keep the Garden locked after the canonical save.
    void publishQuartzAfterMutation(
      `AI edit markdown ${cluster.slug}/${slug}`,
      { userId, gardenSlug: cluster.slug },
    ).catch(error => console.error("[garden] Markdown edit saved; publication failed:", error));

    return NextResponse.json({
      success: true,
      slug,
      title: frontmatterTitle(nextContent, slug),
      summary: parsed.summary || "Updated the open page.",
      content: nextContent,
      tags: parseFrontmatterTags(nextContent),
      ...(usage ? { usage } : {}),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
